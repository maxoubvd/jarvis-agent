import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, IModelProvider, ProviderUsage } from '../../models/abstract.js';
import { extractJson } from '../utils/json-cleaner.js';
import { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { ChangeTracker } from '../../services/change-tracker.js';
import { operationLogger } from '../../services/logger.js';

export interface GateResult {
  granted: boolean;
  reason: string;
  /** Instructions de l'utilisateur données lors d'un refus. */
  feedback?: string;
}

export interface ApprovalGate {
  checkApproval(actionType: string, params: Record<string, unknown>): Promise<GateResult>;
  /** Confirmation inconditionnelle (politique d'outil « ask first »). */
  askApproval?(actionType: string, params: Record<string, unknown>): Promise<GateResult>;
}

/** Politique par outil (voir config-manager.ToolPolicy) ; `excluded` est géré en amont, au registre. */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

export interface AgentEvents {
  /** Chaîne de pensée du modèle à chaque itération. */
  onThinking?(text: string): void;
  onToolCall?(name: string, args: Record<string, unknown>): void;
  onToolResult?(name: string, result: string, success: boolean, args?: Record<string, unknown>): void;
  /** Texte final complet (à la fin). */
  onFinal?(text: string): void;
  /** Chunk de pensée en streaming. */
  onThinkingChunk?(text: string): void;
  /** Chunk de texte final en streaming. */
  onFinalChunk?(text: string): void;
}

export interface AgentStep {
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  success: boolean;
}

export interface AgentResult {
  success: boolean;
  finalText: string;
  steps: AgentStep[];
  iterations: number;
  error?: string;
  /** Cumul des stats de tokens renvoyées par l'API sur la boucle (dont le cache). */
  usage?: ProviderUsage;
}

/** Détecte un refus d'API lié au mode JSON forcé (`response_format`/`format`). */
function isJsonModeError(message: string): boolean {
  return /response_format|json_object|json mode|json_schema|does not support|not supported/i.test(message);
}

/** Additionne les stats de tokens d'un appel dans le cumul de la boucle. */
function accumulateUsage(total: ProviderUsage, next: ProviderUsage | undefined): void {
  if (!next) return;
  total.promptTokens = (total.promptTokens ?? 0) + (next.promptTokens ?? 0);
  total.completionTokens = (total.completionTokens ?? 0) + (next.completionTokens ?? 0);
  total.cachedTokens = (total.cachedTokens ?? 0) + (next.cachedTokens ?? 0);
}

export interface OrchestratorOptions {
  maxIterations?: number;
  systemPrompt?: string;
  hitl?: ApprovalGate;
  /** Filtrage des secrets appliqué aux messages sortants (providers cloud). */
  scrub?: (text: string) => string;
  /** Troncature des résultats d'outils injectés dans le contexte. */
  maxToolResultChars?: number;
  /** Politique par nom d'outil : `auto` court-circuite le HITL, `ask` le force. */
  toolPolicies?: Record<string, ToolPolicy>;
  /** Tracker pour l'enregistrement des diffs de fichiers modifiés. */
  changeTracker?: ChangeTracker;
  /** Racine du workspace pour résoudre les chemins relatifs. */
  workspaceFolder?: string;
  /** Signal d'annulation pour arrêter la génération en cours. */
  abortSignal?: AbortSignal;
}

/** Réponse structurée attendue du modèle (JSON Mode, spec §8.2). */
interface AgentAction {
  thought?: string;
  action?: { tool?: string; args?: Record<string, unknown> };
  final?: string;
}

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_MAX_RESULT_CHARS = 6000;

/** Adaptations du prompt système au profil du modèle (spec §7 — petits modèles). */
export interface AgentPromptOptions {
  /** Phrase(s) ajoutée(s) à la persona (ex. profil devstral). */
  personaExtra?: string;
  /** Prompt resserré + few-shot supplémentaire (petits modèles locaux type Qwen 7B). */
  compact?: boolean;
}

export function buildAgentSystemPrompt(
  tools: ToolRegistry,
  persona?: string,
  rulesText?: string,
  options: AgentPromptOptions = {}
): string {
  return [
    persona ??
      'Tu es Jarvis, un ingénieur logiciel autonome intégré à VS Code. ' +
      'Tu accomplis les tâches de manière incrémentale en utilisant les outils disponibles.',
    ...(options.personaExtra ? [options.personaExtra] : []),
    ...(rulesText ? ['', rulesText] : []),
    '',
    'OUTILS DISPONIBLES:',
    tools.describeForPrompt(),
    '',
    'FORMAT DE RÉPONSE — Tu DOIS répondre avec UN SEUL objet JSON, sans texte autour:',
    'Pour utiliser un outil:',
    '{"thought": "raisonnement court", "action": {"tool": "nom_outil", "args": {"param_string": "valeur", "param_array": ["item1"]}}}',
    'IMPORTANT: Respecte les types des arguments (string, number, boolean, array). Par exemple, pour un tableau (array), utilise bien `["val1", "val2"]` et non une chaîne `"[\\"val1\\"]"`.',
    'Pour terminer et répondre à l\'utilisateur:',
    '{"thought": "raisonnement court", "final": "réponse en Markdown"}',
    '',
    'EXEMPLE:',
    'Utilisateur: Quels fichiers TypeScript existent dans src ?',
    'Toi: {"thought": "Je liste les fichiers .ts", "action": {"tool": "file_glob_search", "args": {"pattern": "src/**/*.ts"}}}',
    'Résultat: src/index.ts',
    'Toi: {"thought": "J\'ai la liste", "final": "Un seul fichier TypeScript : `src/index.ts`"}',
    ...(options.compact
      ? [
          '',
          'EXEMPLE 2 (modification de fichier):',
          'Utilisateur: Corrige le titre du README',
          'Toi: {"thought": "Je lis le fichier", "action": {"tool": "read_file", "args": {"path": "README.md"}}}',
          'Résultat: # Ancien titre…',
          'Toi: {"thought": "Je remplace le titre", "action": {"tool": "single_find_and_replace", "args": {"path": "README.md", "old_string": "# Ancien titre", "new_string": "# Nouveau titre"}}}',
          'Résultat: Remplacement effectué',
          'Toi: {"thought": "Terminé", "final": "Titre corrigé dans `README.md`."}',
          '',
          'IMPORTANT: réponds UNIQUEMENT avec l\'objet JSON — aucun texte avant ou après, pas de bloc markdown autour.'
        ]
      : []),
    '',
    'RÈGLES:',
    '- Une seule action par réponse.',
    '- AGIS avec tes outils, ne décris pas : pour créer/modifier un fichier utilise create_new_file/edit_existing_file, pour exécuter une commande utilise run_terminal_command. Ne donne JAMAIS de script ou de commande à copier-coller à l\'utilisateur quand un outil peut le faire.',
    '- Décompose les tâches complexes en micro-tâches (une étape atomique à la fois).',
    '- Vérifie le résultat de chaque outil avant de continuer.',
    '- Si un outil échoue, analyse l\'erreur et adapte ta stratégie.',
    '- Pour un processus long (serveur de dev, watcher), utilise run_in_background puis check_background_process.',
    '- Ne réécris JAMAIS le contenu complet d\'un fichier dans ta réponse finale. Contente-toi de confirmer succinctement tes modifications.'
  ].join('\n');
}

/**
 * Boucle agentique (spec §4) : le modèle choisit des outils, l'orchestrateur
 * les exécute (avec approbation HITL) et renvoie les résultats jusqu'à la
 * réponse finale ou le nombre max d'itérations.
 */
export class AgentOrchestrator {
  /**
   * Providers (par `name`) ayant rejeté le mode JSON forcé : on n'y renvoie plus
   * `response_format`, on retombe sur le prompt + json-cleaner. Mémorisé au niveau
   * du process pour ne pas retenter à chaque requête.
   */
  private static jsonModeUnsupported = new Set<string>();

  constructor(
    public provider: IModelProvider,
    private tools: ToolRegistry,
    private options: OrchestratorOptions = {}
  ) {}

  public async run(task: string, history: ChatMessage[] = [], events: AgentEvents = {}): Promise<AgentResult> {
    const maxIterations = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxResultChars = this.options.maxToolResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    const scrub = this.options.scrub ?? ((s: string) => s);

    const systemPrompt = this.options.systemPrompt ?? buildAgentSystemPrompt(this.tools);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: scrub(task) }
    ];

    const steps: AgentStep[] = [];
    let retryCount = 0;
    // Structured Outputs : on force un JSON parsable via l'API tant que le provider l'accepte.
    let useJsonMode = !AgentOrchestrator.jsonModeUnsupported.has(this.provider.name);
    const totalUsage: ProviderUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.options.abortSignal?.throwIfAborted();

      if (iteration === maxIterations) {
        const msg = `J'ai atteint la limite de ${maxIterations} itérations. Souhaitez-vous que je continue ?`;
        events.onFinal?.(msg);
        steps.push({ success: true, result: msg });
        return { success: true, finalText: msg, steps, iterations: iteration, usage: totalUsage };
      }

      let raw = '';
      let nativeToolCalls: import('../../models/abstract.js').NativeToolCall[] | undefined = undefined;
      let lastThoughtLength = 0;
      let lastFinalLength = 0;
      const sendOptions = useJsonMode ? ({ responseFormat: 'json_object' } as const) : undefined;
      try {
        if (this.provider.sendPromptStream) {
          await this.provider.sendPromptStream(
            messages,
            chunk => {
              raw += chunk;
              // Extraction streaming de <thinking>
              const thinkingMatch = raw.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/i);
              if (thinkingMatch) {
                const thinkingText = thinkingMatch[1];
                const newText = thinkingText.slice(lastThoughtLength);
                if (newText) {
                  events.onThinkingChunk?.(newText);
                  lastThoughtLength = thinkingText.length;
                }
              } else {
                // Extraction rudimentaire de la "thought" pour streaming partiel
                const thoughtMatch = raw.match(/"thought"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)/);
                if (thoughtMatch) {
                  try {
                    const thoughtText = JSON.parse(`"${thoughtMatch[1]}"`);
                    const newText = thoughtText.slice(lastThoughtLength);
                    if (newText) {
                      events.onThinkingChunk?.(newText);
                      lastThoughtLength = thoughtText.length;
                    }
                  } catch { /* Ignore */ }
                }
              }

              // Extraction rudimentaire de la "final" pour streaming partiel
              const finalMatch = raw.match(/"final"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)/);
              if (finalMatch) {
                try {
                  const finalText = JSON.parse(`"${finalMatch[1]}"`);
                  const newText = finalText.slice(lastFinalLength);
                  if (newText) {
                    events.onFinalChunk?.(newText);
                    lastFinalLength = finalText.length;
                  }
                } catch { /* Ignore */ }
              }
            },
            (toolCalls, usage) => { nativeToolCalls = toolCalls; accumulateUsage(totalUsage, usage); },
            err => { throw err; },
            this.tools.list(),
            this.options.abortSignal,
            sendOptions
          );
        } else {
          const res = await this.provider.sendPrompt(messages, this.tools.list(), this.options.abortSignal, sendOptions);
          if (typeof res === 'string') {
            raw = res;
          } else {
            raw = res.text;
            nativeToolCalls = res.toolCalls;
            accumulateUsage(totalUsage, res.usage);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Fallback Structured Outputs : le provider refuse `response_format` → on
        // désactive le mode JSON (mémorisé) et on rejoue l'itération sans lui.
        if (useJsonMode && isJsonModeError(msg)) {
          useJsonMode = false;
          AgentOrchestrator.jsonModeUnsupported.add(this.provider.name);
          operationLogger.log('agent', `Mode JSON non supporté par ${this.provider.name} — repli sur le prompt (${msg.slice(0, 120)})`, 'error');
          iteration--; // le for(...) réincrémente : on rejoue la même itération
          continue;
        }
        return { success: false, finalText: '', steps, iterations: iteration, error: `Erreur du modèle: ${msg}`, usage: totalUsage };
      }

      const parsed = extractJson<AgentAction>(raw);

      let action: Partial<AgentAction> = parsed.value || {};
      let isNativeTool = false;

      if (nativeToolCalls && nativeToolCalls.length > 0) {
        const tc = nativeToolCalls[0];
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          action = {
            thought: parsed.surroundingText || raw,
            action: {
              tool: tc.function.name,
              args
            }
          };
          isNativeTool = true;
          parsed.ok = true;
        } catch {
          // Args parse error -> will trigger retry or error
        }
      }

      // Système de Retry
      if (!isNativeTool && (!parsed.ok || (!action.action?.tool && action.final === undefined))) {
        if (retryCount < 3) {
          retryCount++;
          messages.push({ role: 'assistant', content: raw });
          messages.push({ role: 'user', content: "Erreur : Format inattendu. Tu dois utiliser un appel d'outil natif ou fournir un objet JSON valide avec 'action' ou 'final'. Refais ta réponse." });
          events.onThinkingChunk?.('\n\n*(Nouvelle tentative suite à une erreur de format)*\n\n');
          continue;
        } else {
          // Pas de JSON exploitable → on considère la réponse brute comme finale.
          const finalText = (parsed.surroundingText ?? raw).trim();
          events.onFinal?.(finalText);
          steps.push({ success: true, result: finalText });
          return { success: true, finalText, steps, iterations: iteration, usage: totalUsage };
        }
      }

      retryCount = 0;
      const thoughtText = action.thought || parsed.surroundingText;

      // On ne renvoie pas onThinking ici si on a déjà streamé
      if (thoughtText && lastThoughtLength === 0) {
        events.onThinking?.(thoughtText);
      }

      if (action.final !== undefined || !action.action?.tool) {
        const finalText = action.final ?? thoughtText ?? raw;
        if (lastFinalLength === 0) events.onFinal?.(finalText);
        steps.push({ thought: thoughtText, success: true, result: finalText });
        return { success: true, finalText, steps, iterations: iteration, usage: totalUsage };
      }

      const assistantMsg: ChatMessage = { role: 'assistant', content: raw };
      if (nativeToolCalls) {
        assistantMsg.tool_calls = nativeToolCalls;
      }
      messages.push(assistantMsg);

      const toolsToExecute: Array<{ toolName: string; args: Record<string, unknown>; id?: string }> = [];
      if (isNativeTool && nativeToolCalls) {
        for (const tc of nativeToolCalls) {
          let tcArgs = {};
          try { tcArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}
          toolsToExecute.push({ toolName: tc.function.name, args: tcArgs, id: tc.id });
        }
      } else {
        toolsToExecute.push({ toolName: action.action!.tool, args: action.action!.args ?? {} });
      }

      for (const t of toolsToExecute) {
        const toolName = t.toolName;
        const args = t.args;
        const tool = this.tools.get(toolName);

        if (!tool) {
          const errText = `Outil inconnu: "${toolName}". Outils disponibles: ${this.tools.list().map(td => td.name).join(', ')}`;
          steps.push({ thought: thoughtText, tool: toolName, args, result: errText, success: false });
          messages.push({ 
            role: isNativeTool ? 'tool' : 'user', 
            content: errText,
            tool_call_id: t.id 
          });
          continue;
        }

        events.onToolCall?.(toolName, args);

        const gate = await this.gate(tool, toolName, args);
        if (!gate.granted) {
          steps.push({ thought: thoughtText, tool: toolName, args, result: gate.refusal, success: false });
          events.onToolResult?.(toolName, gate.refusal, false, args);
          messages.push({ 
            role: isNativeTool ? 'tool' : 'user', 
            content: gate.refusal,
            tool_call_id: t.id 
          });
          continue;
        }

        let result: string;
        let success = true;
        try {
          result = await this.executeWithTracking(tool, toolName, args);
        } catch (err) {
          result = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
          success = false;
        }

        if (result.length > maxResultChars) {
          result = result.slice(0, maxResultChars) + `\n… (tronqué, ${result.length} caractères au total)`;
        }

        steps.push({ thought: thoughtText, tool: toolName, args, result, success });
        events.onToolResult?.(toolName, result, success, args);

        messages.push({
          role: isNativeTool ? 'tool' : 'user',
          content: isNativeTool ? scrub(result) : scrub(`Résultat de l'outil ${toolName}:\n${result}\n\nContinue (JSON ou appel d'outil natif uniquement).`),
          tool_call_id: t.id
        });
      }
    }

    const error = `Nombre maximum d'itérations atteint (${maxIterations})`;
    return { success: false, finalText: '', steps, iterations: maxIterations, error, usage: totalUsage };
  }

  /** Contrôle HITL d'un appel d'outil (partagé par les deux boucles). */
  private async gate(
    tool: ToolDefinition,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ granted: true } | { granted: false; refusal: string }> {
    const policy = this.options.toolPolicies?.[toolName] ?? this.options.toolPolicies?.[tool.hitlAction];
    if (!this.options.hitl || policy === 'auto') return { granted: true };

    const hitlArgs = { ...args, _toolName: toolName, _serverName: toolName.split('__')[1] };
    const approval =
      policy === 'ask' && this.options.hitl.askApproval
        ? await this.options.hitl.askApproval(tool.hitlAction, hitlArgs)
        : await this.options.hitl.checkApproval(tool.hitlAction, hitlArgs);
    if (approval.granted) return { granted: true };

    const refusal = approval.feedback
      ? `Action refusée par l'utilisateur. Ses instructions : « ${approval.feedback} ». Suis ces instructions.`
      : `Action refusée par l'utilisateur (${approval.reason}). N'insiste pas, propose une alternative ou termine.`;
    return { granted: false, refusal };
  }

  /** Exécute un outil et enregistre le diff des fichiers modifiés (change-tracker). */
  private async executeWithTracking(
    tool: ToolDefinition,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const isFileEdit =
      toolName.includes('write_file') ||
      toolName.includes('edit_file') ||
      toolName.includes('replace_file_content') ||
      toolName.includes('create_new_file') ||
      toolName.includes('find_and_replace') ||
      tool.hitlAction === 'write_file' ||
      tool.hitlAction === 'edit_file' ||
      tool.hitlAction === 'edit_existing_file';

    let filePath = '';
    let beforeContent: string | null = null;

    if (isFileEdit && this.options.changeTracker) {
      // Extraire le chemin (souvent "path", "file", "TargetFile" ou "AbsolutePath").
      const possiblePath = args.path ?? args.file ?? args.TargetFile ?? args.AbsolutePath;
      if (possiblePath && typeof possiblePath === 'string') {
        filePath = path.isAbsolute(possiblePath)
          ? possiblePath
          : this.options.workspaceFolder
            ? path.resolve(this.options.workspaceFolder, possiblePath)
            : possiblePath;
        try {
          beforeContent = await fs.promises.readFile(filePath, 'utf8');
        } catch {
          beforeContent = null;
        }
      }
    }

    const result = await tool.execute(args);

    if (isFileEdit && this.options.changeTracker && filePath) {
      try {
        const afterContent = await fs.promises.readFile(filePath, 'utf8');
        this.options.changeTracker.record(filePath, beforeContent, afterContent);
      } catch {
        // Lecture possiblement en échec si le fichier a été supprimé — on ignore.
      }
    }

    return result;
  }
}

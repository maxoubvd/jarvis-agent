import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, IModelProvider } from '../../models/abstract.js';
import { extractJson } from '../utils/json-cleaner.js';
import { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { ChangeTracker } from '../../services/change-tracker.js';

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
}

/** Réponse structurée attendue du modèle (JSON Mode, spec §8.2). */
interface AgentAction {
  thought?: string;
  action?: { tool?: string; args?: Record<string, unknown> };
  final?: string;
}

const DEFAULT_MAX_ITERATIONS = 25;
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
  constructor(
    private provider: IModelProvider,
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

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (iteration === maxIterations) {
        const msg = `J'ai atteint la limite de ${maxIterations} itérations. Souhaitez-vous que je continue ?`;
        events.onFinal?.(msg);
        steps.push({ success: true, result: msg });
        return { success: true, finalText: msg, steps, iterations: iteration };
      }

      let raw = '';
      let lastThoughtLength = 0;
      let lastFinalLength = 0;
      try {
        if (this.provider.sendPromptStream) {
          await this.provider.sendPromptStream(
            messages,
            chunk => {
              raw += chunk;
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
            () => {},
            err => { throw err; }
          );
        } else {
          raw = await this.provider.sendPrompt(messages);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, finalText: '', steps, iterations: iteration, error: `Erreur du modèle: ${msg}` };
      }

      const parsed = extractJson<AgentAction>(raw);

      // Pas de JSON exploitable → on considère la réponse brute comme finale.
      if (!parsed.ok || !parsed.value) {
        const finalText = (parsed.surroundingText ?? raw).trim();
        events.onFinal?.(finalText);
        steps.push({ success: true, result: finalText });
        return { success: true, finalText, steps, iterations: iteration };
      }

      const action = parsed.value;
      // On ne renvoie pas onThinking ici si on a déjà streamé
      if (action.thought && lastThoughtLength === 0) {
        events.onThinking?.(action.thought);
      }

      if (action.final !== undefined || !action.action?.tool) {
        const finalText = action.final ?? action.thought ?? raw;
        if (lastFinalLength === 0) events.onFinal?.(finalText);
        steps.push({ thought: action.thought, success: true, result: finalText });
        return { success: true, finalText, steps, iterations: iteration };
      }

      const toolName = action.action.tool;
      const args = action.action.args ?? {};
      const tool = this.tools.get(toolName);

      messages.push({ role: 'assistant', content: raw });

      if (!tool) {
        const errText = `Outil inconnu: "${toolName}". Outils disponibles: ${this.tools.list().map(t => t.name).join(', ')}`;
        steps.push({ thought: action.thought, tool: toolName, args, result: errText, success: false });
        messages.push({ role: 'user', content: errText });
        continue;
      }

      events.onToolCall?.(toolName, args);

      const gate = await this.gate(tool, toolName, args);
      if (!gate.granted) {
        // Avec des instructions de l'utilisateur, l'agent repart dessus au lieu
        // d'abandonner (option « Refuser et décrire les étapes »).
        steps.push({ thought: action.thought, tool: toolName, args, result: gate.refusal, success: false });
        events.onToolResult?.(toolName, gate.refusal, false, args);
        messages.push({ role: 'user', content: gate.refusal });
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

      steps.push({ thought: action.thought, tool: toolName, args, result, success });
      events.onToolResult?.(toolName, result, success, args);

      messages.push({
        role: 'user',
        content: scrub(`Résultat de l'outil ${toolName}:\n${result}\n\nContinue (JSON uniquement).`)
      });
    }

    const error = `Nombre maximum d'itérations atteint (${maxIterations})`;
    return { success: false, finalText: '', steps, iterations: maxIterations, error };
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

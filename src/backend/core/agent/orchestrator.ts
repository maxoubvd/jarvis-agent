import { ChatMessage, IModelProvider } from '../../models/abstract.js';
import { extractJson } from '../utils/json-cleaner.js';
import { ToolRegistry } from './tool-registry.js';

export interface ApprovalGate {
  checkApproval(actionType: string, params: Record<string, unknown>): Promise<{ granted: boolean; reason: string }>;
}

export interface AgentEvents {
  /** Chaîne de pensée du modèle à chaque itération. */
  onThinking?(text: string): void;
  onToolCall?(name: string, args: Record<string, unknown>): void;
  onToolResult?(name: string, result: string, success: boolean): void;
  /** Texte final de l'agent. */
  onFinal?(text: string): void;
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
}

/** Réponse structurée attendue du modèle (JSON Mode, spec §8.2). */
interface AgentAction {
  thought?: string;
  action?: { tool?: string; args?: Record<string, unknown> };
  final?: string;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_RESULT_CHARS = 6000;

export function buildAgentSystemPrompt(tools: ToolRegistry, persona?: string, rulesText?: string): string {
  return [
    persona ??
      'Tu es Jarvis, un ingénieur logiciel autonome intégré à VS Code. ' +
      'Tu accomplis les tâches de manière incrémentale en utilisant les outils disponibles.',
    ...(rulesText ? ['', rulesText] : []),
    '',
    'OUTILS DISPONIBLES:',
    tools.describeForPrompt(),
    '',
    'FORMAT DE RÉPONSE — Tu DOIS répondre avec UN SEUL objet JSON, sans texte autour:',
    'Pour utiliser un outil:',
    '{"thought": "raisonnement court", "action": {"tool": "nom_outil", "args": {"param": "valeur"}}}',
    'Pour terminer et répondre à l\'utilisateur:',
    '{"thought": "raisonnement court", "final": "réponse en Markdown"}',
    '',
    'EXEMPLE:',
    'Utilisateur: Quels fichiers TypeScript existent dans src ?',
    'Toi: {"thought": "Je liste les fichiers .ts", "action": {"tool": "file_glob_search", "args": {"pattern": "src/**/*.ts"}}}',
    'Résultat: src/index.ts',
    'Toi: {"thought": "J\'ai la liste", "final": "Un seul fichier TypeScript : `src/index.ts`"}',
    '',
    'RÈGLES:',
    '- Une seule action par réponse.',
    '- Décompose les tâches complexes en micro-tâches (une étape atomique à la fois).',
    '- Vérifie le résultat de chaque outil avant de continuer.',
    '- Si un outil échoue, analyse l\'erreur et adapte ta stratégie.'
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
      let raw: string;
      try {
        raw = await this.provider.sendPrompt(messages);
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
      if (action.thought) {
        events.onThinking?.(action.thought);
      }

      if (action.final !== undefined || !action.action?.tool) {
        const finalText = action.final ?? action.thought ?? raw;
        events.onFinal?.(finalText);
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

      if (this.options.hitl) {
        const approval = await this.options.hitl.checkApproval(tool.hitlAction, args);
        if (!approval.granted) {
          const refusal = `Action refusée par l'utilisateur (${approval.reason}). N'insiste pas, propose une alternative ou termine.`;
          steps.push({ thought: action.thought, tool: toolName, args, result: refusal, success: false });
          events.onToolResult?.(toolName, refusal, false);
          messages.push({ role: 'user', content: refusal });
          continue;
        }
      }

      let result: string;
      let success = true;
      try {
        result = await tool.execute(args);
      } catch (err) {
        result = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
        success = false;
      }

      if (result.length > maxResultChars) {
        result = result.slice(0, maxResultChars) + `\n… (tronqué, ${result.length} caractères au total)`;
      }

      steps.push({ thought: action.thought, tool: toolName, args, result, success });
      events.onToolResult?.(toolName, result, success);

      messages.push({
        role: 'user',
        content: scrub(`Résultat de l'outil ${toolName}:\n${result}\n\nContinue (JSON uniquement).`)
      });
    }

    const error = `Nombre maximum d'itérations atteint (${maxIterations})`;
    return { success: false, finalText: '', steps, iterations: maxIterations, error };
  }
}

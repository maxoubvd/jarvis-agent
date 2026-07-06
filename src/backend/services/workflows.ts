import { AgentOrchestrator, AgentEvents, AgentResult } from '../core/agent/orchestrator.js';

export interface WorkflowStep {
  name: string;
  /** Prompt de l'étape — `{task}` est remplacé par la tâche, `{previous}` par le résumé précédent. */
  prompt: string;
}

export interface Workflow {
  id: string;
  label: string;
  description: string;
  steps: WorkflowStep[];
}

/** Workflows prédéfinis (spec §5.2). */
export const WORKFLOWS: Workflow[] = [
  {
    id: 'dev-feature',
    label: 'Dev Feature',
    description: 'Planifier → Coder → Tester → Commiter',
    steps: [
      { name: 'Planifier', prompt: 'Analyse la tâche suivante et produis un plan d\'implémentation concis (fichiers à créer/modifier, étapes): {task}' },
      { name: 'Coder', prompt: 'Implémente le plan suivant pour la tâche "{task}". Plan:\n{previous}' },
      { name: 'Tester', prompt: 'Exécute les tests du projet et corrige les échecs liés aux changements de la tâche "{task}". Contexte:\n{previous}' },
      { name: 'Commiter', prompt: 'Vérifie le diff (view_diff) puis crée un commit git avec un message clair décrivant la fonctionnalité "{task}".' }
    ]
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    description: 'Analyser → Reproduire → Corriger → Tester',
    steps: [
      { name: 'Analyser', prompt: 'Analyse ce bug et identifie sa cause probable dans le code: {task}' },
      { name: 'Reproduire', prompt: 'Écris ou identifie un test qui reproduit le bug "{task}". Analyse:\n{previous}' },
      { name: 'Corriger', prompt: 'Corrige la cause racine du bug "{task}". Contexte:\n{previous}' },
      { name: 'Tester', prompt: 'Exécute la suite de tests complète et vérifie que le bug "{task}" est corrigé sans régression.' }
    ]
  },
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Lire Code → Exécuter Tests → Analyser Coverage → Suggérer Améliorations',
    steps: [
      { name: 'Lire le code', prompt: 'Examine le diff en cours (view_diff) et les fichiers concernés par: {task}' },
      { name: 'Exécuter les tests', prompt: 'Exécute les tests du projet et note les échecs éventuels.' },
      { name: 'Analyser', prompt: 'Analyse la qualité du code revu (bugs potentiels, cas limites, lisibilité). Contexte:\n{previous}' },
      { name: 'Suggérer', prompt: 'Produis un rapport de revue final avec des suggestions concrètes classées par priorité. Contexte:\n{previous}' }
    ]
  },
  {
    id: 'refactor',
    label: 'Refactor',
    description: 'Analyser → Planifier → Appliquer Changements → Tester',
    steps: [
      { name: 'Analyser', prompt: 'Analyse le code visé par ce refactoring et identifie les problèmes: {task}' },
      { name: 'Planifier', prompt: 'Propose un plan de refactoring par petites étapes sûres. Analyse:\n{previous}' },
      { name: 'Appliquer', prompt: 'Applique le plan de refactoring pour "{task}". Plan:\n{previous}' },
      { name: 'Tester', prompt: 'Exécute les tests pour vérifier que le refactoring "{task}" ne change pas le comportement.' }
    ]
  },
  {
    id: 'setup-project',
    label: 'Setup Project',
    description: 'Initialiser → Configurer → Installer Dépendances → Créer Structure',
    steps: [
      { name: 'Initialiser', prompt: 'Initialise le projet demandé (package.json, git si nécessaire): {task}' },
      { name: 'Configurer', prompt: 'Crée les fichiers de configuration adaptés (tsconfig, lint, etc.) pour: {task}' },
      { name: 'Dépendances', prompt: 'Installe les dépendances nécessaires pour: {task}' },
      { name: 'Structure', prompt: 'Crée la structure de dossiers et les fichiers de départ pour: {task}. Contexte:\n{previous}' }
    ]
  }
];

/** Alias explicite : les workflows codés en dur servent de défauts. */
export const DEFAULT_WORKFLOWS = WORKFLOWS;

/** Workflows effectifs : ceux de la config s'ils existent, sinon les défauts. */
export function getWorkflows(config?: { workflows?: Workflow[] }): Workflow[] {
  const fromConfig = config?.workflows;
  return fromConfig && fromConfig.length > 0 ? fromConfig : DEFAULT_WORKFLOWS;
}

export function getWorkflow(id: string, list: Workflow[] = DEFAULT_WORKFLOWS): Workflow | undefined {
  return list.find(w => w.id === id);
}

export interface WorkflowStepResult {
  step: string;
  result: AgentResult;
}

export interface WorkflowRunResult {
  success: boolean;
  workflowId: string;
  steps: WorkflowStepResult[];
  summary: string;
  error?: string;
}

export interface WorkflowEvents extends AgentEvents {
  onStepStart?(stepName: string, index: number, total: number): void;
  onStepDone?(stepName: string, result: AgentResult): void;
}

/** Exécution séquentielle d'un workflow, chaque étape recevant le résumé de la précédente. */
export class WorkflowRunner {
  constructor(
    private orchestrator: AgentOrchestrator,
    private beforeRun?: () => Promise<void>,
    private workflows: Workflow[] = DEFAULT_WORKFLOWS
  ) {}

  public async run(workflowId: string, task: string, events: WorkflowEvents = {}): Promise<WorkflowRunResult> {
    const workflow = getWorkflow(workflowId, this.workflows);
    if (!workflow) {
      return {
        success: false,
        workflowId,
        steps: [],
        summary: '',
        error: `Workflow inconnu: ${workflowId}. Disponibles: ${this.workflows.map(w => w.id).join(', ')}`
      };
    }

    // Checkpoint avant le workflow complet (spec §6.2)
    await this.beforeRun?.();

    const results: WorkflowStepResult[] = [];
    let previous = '(première étape)';

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      events.onStepStart?.(step.name, i + 1, workflow.steps.length);

      const prompt = step.prompt.replace(/\{task\}/g, task).replace(/\{previous\}/g, previous);
      const result = await this.orchestrator.run(prompt, [], events);
      results.push({ step: step.name, result });
      events.onStepDone?.(step.name, result);

      if (!result.success) {
        return {
          success: false,
          workflowId,
          steps: results,
          summary: previous,
          error: `Étape "${step.name}" échouée: ${result.error ?? 'erreur inconnue'}`
        };
      }
      previous = result.finalText.slice(0, 3000);
    }

    return { success: true, workflowId, steps: results, summary: previous };
  }
}

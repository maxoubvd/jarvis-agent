import { AgentOrchestrator, AgentEvents, AgentResult } from '../core/agent/orchestrator.js';
import { TaskDecomposer } from './task-decomposer.js';

export interface WorkflowStep {
  name: string;
  /** Step prompt — `{task}` is replaced by the task, `{previous}` by the previous summary. */
  prompt: string;
}

export interface Workflow {
  id: string;
  label: string;
  description: string;
  steps: WorkflowStep[];
}

/** Predefined workflows (spec §5.2). */
export const WORKFLOWS: Workflow[] = [
  {
    id: 'dynamic',
    label: 'Auto (Micro-Tasks)',
    description: 'AI-optimized dynamic decomposition (Recommended)',
    steps: []
  },
  {
    id: 'dev-feature',
    label: 'Dev Feature',
    description: 'Plan → Code → Test → Commit',
    steps: [
      { name: 'Plan', prompt: 'Analyze the following task and produce a concise implementation plan (files to create/modify, steps): {task}' },
      { name: 'Code', prompt: 'Implement the following plan for the task "{task}". Plan:\n{previous}' },
      { name: 'Test', prompt: 'Run the project tests and fix failures related to the changes for the task "{task}". Context:\n{previous}' },
      { name: 'Commit', prompt: 'Check the diff (view_diff) then create a git commit using the Conventional Commits standard (feat, fix, chore, etc.) describing the feature "{task}"' }
    ]
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    description: 'Analyse → Reproduce → Fix → Test',
    steps: [
      { name: 'Analyse', prompt: 'Analyse this bug and identify its likely root cause in the code: {task}' },
      { name: 'Reproduce', prompt: 'Write or identify a test that reproduces the bug "{task}". Analysis:\n{previous}' },
      { name: 'Fix', prompt: 'Fix the root cause of the bug "{task}". Context:\n{previous}' },
      { name: 'Test', prompt: 'Run the full test suite and verify that bug "{task}" is fixed without regression.' }
    ]
  },
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Read Code → Run Tests → Analyse Coverage → Suggest Improvements',
    steps: [
      { name: 'Read code', prompt: 'Examine the current diff (view_diff) and files related to: {task}' },
      { name: 'Run tests', prompt: 'Run the project tests and note any failures.' },
      { name: 'Analyse', prompt: 'Analyse the quality of the reviewed code (potential bugs, edge cases, readability). Context:\n{previous}' },
      { name: 'Suggest', prompt: 'Produce a final review report with concrete suggestions ranked by priority. Context:\n{previous}' }
    ]
  },
  {
    id: 'refactor',
    label: 'Refactor',
    description: 'Analyse → Plan → Apply Changes → Test',
    steps: [
      { name: 'Analyse', prompt: 'Analyse the code targeted by this refactoring and identify the issues: {task}' },
      { name: 'Plan', prompt: 'Propose a refactoring plan in small, safe steps. Output the plan strictly as a Markdown checklist. Analysis:\n{previous}' },
      { name: 'Apply', prompt: 'Apply the refactoring plan for "{task}". Plan:\n{previous}' },
      { name: 'Test', prompt: 'Run the tests to verify that the refactoring "{task}" does not change behaviour.' }
    ]
  },
  {
    id: 'setup-project',
    label: 'Setup Project',
    description: 'Init → Configure → Install Dependencies → Create Structure',
    steps: [
      { name: 'Init', prompt: 'Initialise the requested project (package.json, git if needed): {task}' },
      { name: 'Configure', prompt: 'Create appropriate config files (tsconfig, lint, etc.) for: {task}' },
      { name: 'Dependencies', prompt: 'Install the required dependencies for: {task}' },
      { name: 'Structure', prompt: 'Create the folder structure and starter files for: {task}. Context:\n{previous}' }
    ]
  }
];

/** Explicit alias: the hardcoded workflows act as defaults. */
export const DEFAULT_WORKFLOWS = WORKFLOWS;

/** Effective workflows: those from config if present, otherwise the defaults. */
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

/** Sequential execution of a workflow, each step receiving the summary of the previous one. */
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
        error: `Unknown workflow: ${workflowId}. Available: ${this.workflows.map(w => w.id).join(', ')}`
      };
    }

    // Checkpoint before the full workflow (spec §6.2)
    await this.beforeRun?.();

    let stepsToRun = workflow.steps;
    if (workflow.id === 'dynamic' || workflow.steps.length === 0) {
      events.onStepStart?.('Analyse & Decompose', 1, 1);
      const decomposer = new TaskDecomposer(this.orchestrator.provider);
      stepsToRun = await decomposer.decompose(task);
      events.onStepDone?.('Analyse & Decompose', { success: true, finalText: `Task split into ${stepsToRun.length} steps.`, steps: [], iterations: 1 });
    }

    const results: WorkflowStepResult[] = [];
    let previous = '(first step)';

    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i];
      events.onStepStart?.(step.name, i + 1, stepsToRun.length);

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
          error: `Step "${step.name}" failed: ${result.error ?? 'unknown error'}`
        };
      }
      previous = result.finalText.slice(0, 3000);
    }

    return { success: true, workflowId, steps: results, summary: previous };
  }
}

import { IModelProvider, ChatMessage } from '../models/abstract.js';
import { extractJson } from '../core/utils/json-cleaner.js';
import { WorkflowStep } from './workflows.js';

export interface TaskDecomposition {
  steps: WorkflowStep[];
}

export class TaskDecomposer {
  constructor(private provider: IModelProvider) {}

  public async decompose(task: string): Promise<WorkflowStep[]> {
    const systemPrompt = `You are an expert software architect. Break down the user's complex task into ordered micro-tasks.
Each micro-task must be atomic and executable by an autonomous agent.
You MUST respond ONLY with a JSON object in this format:
{
  "steps": [
    { "name": "Short step name", "prompt": "Precise instructions for the agent for this step. Mention '{task}' to reference the overall task and '{previous}' for previous context." }
  ]
}
Provide between 2 and 8 steps maximum depending on complexity. Do NOT add any text outside the JSON.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ];

    let raw = '';
    try {
      const res = await this.provider.sendPrompt(messages);
      raw = typeof res === 'string' ? res : res.text;
    } catch (err) {
      console.error('Error during task decomposition:', err);
      return this.getFallback(task);
    }

    const parsed = extractJson<TaskDecomposition>(raw);
    if (!parsed.ok || !parsed.value?.steps || parsed.value.steps.length === 0) {
      return this.getFallback(task);
    }
    
    return parsed.value.steps;
  }
  
  private getFallback(task: string): WorkflowStep[] {
    return [
      { name: 'Plan', prompt: `Analyse and plan the task: ${task}` },
      { name: 'Execute', prompt: `Implement the plan for the task: ${task}\nPrevious plan:\n{previous}` },
      { name: 'Test & Verify', prompt: `Verify that the task is correctly implemented.\nContext:\n{previous}` }
    ];
  }
}

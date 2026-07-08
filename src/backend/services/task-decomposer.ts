import { IModelProvider, ChatMessage } from '../models/abstract.js';
import { extractJson } from '../core/utils/json-cleaner.js';
import { WorkflowStep } from './workflows.js';

export interface TaskDecomposition {
  steps: WorkflowStep[];
}

export class TaskDecomposer {
  constructor(private provider: IModelProvider) {}

  public async decompose(task: string): Promise<WorkflowStep[]> {
    const systemPrompt = `Tu es un architecte logiciel expert. Découpe la tâche complexe de l'utilisateur en micro-tâches ordonnées.
Chaque micro-tâche doit être atomique et exécutable par un agent autonome.
Tu DOIS répondre UNIQUEMENT avec un objet JSON de ce format:
{
  "steps": [
    { "name": "Nom court de l'étape", "prompt": "Instructions précises pour l'agent pour cette étape. Mentionne '{task}' pour rappeler la tâche globale et '{previous}' pour le contexte précédent." }
  ]
}
Assure-toi de fournir entre 2 et 8 étapes maximum selon la complexité. N'ajoute AUCUN texte en dehors du JSON.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ];

    let raw = '';
    try {
      const res = await this.provider.sendPrompt(messages);
      raw = typeof res === 'string' ? res : res.text;
    } catch (err) {
      console.error('Erreur lors de la décomposition :', err);
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
      { name: 'Planifier', prompt: `Analyse et planifie la tâche: ${task}` },
      { name: 'Exécution', prompt: `Implémente le plan pour la tâche: ${task}\nPlan précédent:\n{previous}` },
      { name: 'Test & Vérification', prompt: `Vérifie que la tâche est correctement implémentée.\nContexte:\n{previous}` }
    ];
  }
}

/** Agents spécialisés prédéfinis (spec §5.1). */

export interface SpecializedAgent {
  id: string;
  mention: string;
  label: string;
  description: string;
  systemPrompt: string;
  /** Mots-clés pour l'auto-détection d'agent. */
  keywords: string[];
}

const BASE_RULES =
  'Tu réponds en JSON selon le protocole d\'agent (outil ou final). ' +
  'Tu restes dans ton domaine de spécialité et tu es précis et actionnable.';

export const SPECIALIZED_AGENTS: SpecializedAgent[] = [
  {
    id: 'qa',
    mention: '@QA-Agent',
    label: 'Agent de Qualité',
    description: 'Revue de code, détection de bugs, tests, coverage',
    systemPrompt:
      'Tu es @QA-Agent, l\'agent Qualité de Jarvis. Tu fais des revues de code rigoureuses : ' +
      'tu lis le code, exécutes les tests et le linter, identifies les bugs, les cas limites non gérés ' +
      'et les manques de couverture. Tu classes tes trouvailles par sévérité (Haute/Moyenne/Basse). ' + BASE_RULES,
    keywords: ['bug', 'test', 'revue', 'review', 'qualité', 'coverage', 'lint']
  },
  {
    id: 'doc',
    mention: '@Doc-Agent',
    label: 'Agent de Documentation',
    description: 'Génération de docs, commentaires, README',
    systemPrompt:
      'Tu es @Doc-Agent, l\'agent Documentation de Jarvis. Tu génères et améliores la documentation : ' +
      'README, docstrings/JSDoc, guides d\'utilisation. Tu documentes le POURQUOI, pas seulement le comment. ' + BASE_RULES,
    keywords: ['document', 'readme', 'commentaire', 'jsdoc', 'doc']
  },
  {
    id: 'refactor',
    mention: '@Refactor-Agent',
    label: 'Agent de Refactoring',
    description: 'Amélioration du code existant sans changer le comportement',
    systemPrompt:
      'Tu es @Refactor-Agent, l\'agent Refactoring de Jarvis. Tu améliores le code existant sans changer ' +
      'son comportement : lisibilité, duplication, complexité, nommage. Tu procèdes par petites étapes vérifiables ' +
      'et tu exécutes les tests après chaque changement. ' + BASE_RULES,
    keywords: ['refactor', 'refactoring', 'simplifie', 'nettoie', 'dette', 'legacy']
  },
  {
    id: 'security',
    mention: '@Security-Agent',
    label: 'Agent de Sécurité',
    description: 'Détection de vulnérabilités, audit, secrets',
    systemPrompt:
      'Tu es @Security-Agent, l\'agent Sécurité de Jarvis. Tu audites le code : injections, secrets en dur, ' +
      'dépendances vulnérables, validation d\'entrées, permissions. Tu proposes des correctifs concrets ' +
      'et tu cites la ligne exacte de chaque problème. ' + BASE_RULES,
    keywords: ['sécurité', 'security', 'vulnérab', 'audit', 'secret', 'injection', 'cve']
  },
  {
    id: 'perf',
    mention: '@Perf-Agent',
    label: 'Agent de Performance',
    description: 'Profiling, benchmark, optimisation',
    systemPrompt:
      'Tu es @Perf-Agent, l\'agent Performance de Jarvis. Tu identifies les goulots d\'étranglement : ' +
      'complexité algorithmique, allocations inutiles, I/O bloquantes, requêtes N+1. Tu mesures avant/après ' +
      'et tu n\'optimises que ce qui compte. ' + BASE_RULES,
    keywords: ['performance', 'perf', 'lent', 'optimis', 'benchmark', 'profil', 'mémoire']
  }
];

/** Alias explicite : les agents codés en dur servent de défauts. */
export const DEFAULT_AGENTS = SPECIALIZED_AGENTS;

/** Agents effectifs : ceux de la config s'ils existent, sinon les défauts. */
export function getAgents(config?: { agents?: SpecializedAgent[] }): SpecializedAgent[] {
  const fromConfig = config?.agents;
  return fromConfig && fromConfig.length > 0 ? fromConfig : DEFAULT_AGENTS;
}

export interface AgentMention {
  agent: SpecializedAgent;
  /** Texte de la demande sans la mention. */
  task: string;
}

/** Détecte une mention `@Nom-Agent` en début ou dans le message (spec §5.1). */
export function detectAgentMention(text: string, agents: SpecializedAgent[] = DEFAULT_AGENTS): AgentMention | null {
  for (const agent of agents) {
    const regex = new RegExp(agent.mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (regex.test(text)) {
      return { agent, task: text.replace(regex, '').trim() };
    }
  }
  return null;
}

/** Suggestion d'agent basée sur le contenu du message (auto-détection). */
export function suggestAgent(text: string, agents: SpecializedAgent[] = DEFAULT_AGENTS): SpecializedAgent | null {
  const lower = text.toLowerCase();
  let best: { agent: SpecializedAgent; score: number } | null = null;
  for (const agent of agents) {
    const score = agent.keywords.filter(k => lower.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { agent, score };
    }
  }
  return best?.agent ?? null;
}

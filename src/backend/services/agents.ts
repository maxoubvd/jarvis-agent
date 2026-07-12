/** Predefined specialized agents (spec §5.1). */

export interface SpecializedAgent {
  id: string;
  mention: string;
  label: string;
  description: string;
  systemPrompt: string;
  /** Keywords for agent auto-detection. */
  keywords: string[];
  /**
   * Subset of allowed tools (exact names or prefixes, see ToolRegistry.restrictTo).
   * Absent/empty = full registry (historical behavior, notably for custom agents
   * defined in config that don't set this field). Never restricts
   * MCP/custom tools, only builtin tools.
   */
  allowedToolPrefixes?: string[];
}

const READ_TOOLS = ['read_file', 'read_currently_open_file', 'grep_search', 'ls', 'file_glob_search'];
const GIT_READ_TOOLS = ['git_status', 'git_log', 'view_diff'];
const TERMINAL_TOOLS = ['run_terminal_command', 'run_in_background', 'check_background_process', 'stop_background_process'];
const EDIT_TOOLS = ['create_new_file', 'edit_existing_file', 'single_find_and_replace'];

const BASE_RULES =
  'You respond in JSON following the agent protocol (tool or final). ' +
  'You stay within your area of specialty and you are precise and actionable.';

export const SPECIALIZED_AGENTS: SpecializedAgent[] = [
  {
    id: 'qa',
    mention: '@QA-Agent',
    label: 'QA Agent',
    description: 'Code review, bug detection, tests, coverage',
    systemPrompt:
      'You are @QA-Agent, Jarvis\'s QA agent. You perform rigorous code reviews: ' +
      'you read the code, run the tests and the linter, identify bugs, unhandled edge cases, ' +
      'and coverage gaps. You rank your findings by severity (High/Medium/Low). ' + BASE_RULES,
    keywords: ['bug', 'test', 'review', 'quality', 'coverage', 'lint'],
    // Reads, runs tests/linter — never edits code.
    allowedToolPrefixes: [...READ_TOOLS, ...TERMINAL_TOOLS, ...GIT_READ_TOOLS]
  },
  {
    id: 'doc',
    mention: '@Doc-Agent',
    label: 'Documentation Agent',
    description: 'Docs, comments, and README generation',
    systemPrompt:
      'You are @Doc-Agent, Jarvis\'s Documentation agent. You generate and improve documentation: ' +
      'READMEs, docstrings/JSDoc, usage guides. You document the WHY, not just the how. ' + BASE_RULES,
    keywords: ['document', 'readme', 'comment', 'jsdoc', 'doc'],
    // Writes docs, may check terminology on the web — no terminal.
    allowedToolPrefixes: [...READ_TOOLS, ...EDIT_TOOLS, 'search_web']
  },
  {
    id: 'refactor',
    mention: '@Refactor-Agent',
    label: 'Refactoring Agent',
    description: 'Improving existing code without changing behavior',
    systemPrompt:
      'You are @Refactor-Agent, Jarvis\'s Refactoring agent. You improve existing code without changing ' +
      'its behavior: readability, duplication, complexity, naming. You proceed in small, verifiable steps ' +
      'and run the tests after each change. ' + BASE_RULES,
    keywords: ['refactor', 'refactoring', 'simplify', 'cleanup', 'debt', 'legacy'],
    // Edits code and revalidates via tests.
    allowedToolPrefixes: [...READ_TOOLS, ...EDIT_TOOLS, ...TERMINAL_TOOLS, ...GIT_READ_TOOLS]
  },
  {
    id: 'security',
    mention: '@Security-Agent',
    label: 'Security Agent',
    description: 'Vulnerability detection, audit, secrets',
    systemPrompt:
      'You are @Security-Agent, Jarvis\'s Security agent. You audit the code: injections, hardcoded secrets, ' +
      'vulnerable dependencies, input validation, permissions. You propose concrete fixes ' +
      'and cite the exact line of each issue. ' +
      'You do not have terminal access: you cannot run npm audit or equivalent. ' +
      'For dependencies, limit yourself to examining package.json (never lockfiles, which are too large and not meant ' +
      'for manual reading) and flag versions that look outdated or risky, explicitly recommending ' +
      'that the user run npm audit themselves for an exhaustive CVE check. ' + BASE_RULES,
    keywords: ['security', 'vulnerab', 'audit', 'secret', 'injection', 'cve'],
    // Read-only audit by design — no editing, no command execution.
    allowedToolPrefixes: [...READ_TOOLS, ...GIT_READ_TOOLS]
  },
  {
    id: 'perf',
    mention: '@Perf-Agent',
    label: 'Performance Agent',
    description: 'Profiling, benchmarking, optimization',
    systemPrompt:
      'You are @Perf-Agent, Jarvis\'s Performance agent. You identify bottlenecks: ' +
      'algorithmic complexity, unnecessary allocations, blocking I/O, N+1 queries. You measure before/after ' +
      'and only optimize what matters. ' + BASE_RULES,
    keywords: ['performance', 'perf', 'slow', 'optimiz', 'benchmark', 'profil', 'memory'],
    // Profiling/reporting — does not modify code directly (reports the optimizations).
    allowedToolPrefixes: [...READ_TOOLS, ...TERMINAL_TOOLS, ...GIT_READ_TOOLS]
  }
];

/** Explicit alias: the hardcoded agents act as defaults. */
export const DEFAULT_AGENTS = SPECIALIZED_AGENTS;

/** Effective agents: those from config if present, otherwise the defaults. */
export function getAgents(config?: { agents?: SpecializedAgent[] }): SpecializedAgent[] {
  const fromConfig = config?.agents;
  return fromConfig && fromConfig.length > 0 ? fromConfig : DEFAULT_AGENTS;
}

export interface AgentMention {
  agent: SpecializedAgent;
  /** Request text with the mention removed. */
  task: string;
}

/** Detects an `@Agent-Name` mention at the start of or within the message (spec §5.1). */
export function detectAgentMention(text: string, agents: SpecializedAgent[] = DEFAULT_AGENTS): AgentMention | null {
  for (const agent of agents) {
    const regex = new RegExp(agent.mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (regex.test(text)) {
      return { agent, task: text.replace(regex, '').trim() };
    }
  }
  return null;
}

/** Agent suggestion based on message content (auto-detection). */
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

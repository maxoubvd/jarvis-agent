/**
 * @jarvis/core — public API of the shared Jarvis engine.
 *
 * This barrel is **vscode-free**: it re-exports the agentic orchestrator, model
 * providers, tools, services, config and utilities that both the VS Code extension
 * and the Jarvis CLI consume. The vscode-coupled host classes (JarvisExtension,
 * JarvisInlineCompletionProvider, CodeLens/decoration providers) are deliberately
 * NOT re-exported here — they live behind the separate `@jarvis/core/vscode` entry
 * so importing `@jarvis/core` never pulls `vscode` into a bundle.
 */

// Models & providers
export * from './models/index.js';

// Config
export * from './config/config-manager.js';

// MCP (client + tools + manager + built-in servers)
export * from './core/mcp/index.js';
export * from './core/mcp/manager.js';
export * from './core/mcp/builtin.js';
export * from './core/mcp/in-process.js';

// Agentic core
export * from './core/agent/orchestrator.js';
export * from './core/agent/tool-registry.js';
export * from './core/agent/todo.js';
export * from './core/agent/custom-tools.js';
export * from './core/agent/builtin-dedup.js';

// Autocomplete (pure prompt builder — the vscode provider stays in @jarvis/core/vscode)
export * from './core/autocomplete/prompt.js';

// Utils
export * from './core/utils/glob.js';
export * from './core/utils/json-cleaner.js';
export * from './core/utils/sandbox.js';
export * from './core/utils/scrubber.js';
export * from './core/utils/event.js';
export * from './core/utils/workspace.js';

// Services
export * from './services/agents.js';
export * from './services/analytics.js';
export * from './services/background-processes.js';
export * from './services/change-tracker.js';
export * from './services/checkpoint.js';
export * from './services/diff.js';
export * from './services/hitl.js';
export * from './services/jarvis-md.js';
export * from './services/logger.js';
export * from './services/model-profiles.js';
export * from './services/prompts.js';
export * from './services/response-cache.js';
export * from './services/rules.js';
export * from './services/sessions.js';
export * from './services/task-decomposer.js';
export * from './services/tdd-loop.js';
export * from './services/token-counter.js';
export * from './services/workflows.js';
export * from './services/workspaces.js';

// Context (RAG, docs, indexing, pruning, mentions)
export * from './services/context/docs.js';
export * from './services/context/indexer.js';
export * from './services/context/mentions.js';
export * from './services/context/pruner.js';
export * from './services/context/rag.js';

// Disambiguate the two symbols exported by more than one module above.
// (Explicit named re-exports take precedence over the wildcard re-exports.)
export type { ToolPolicy } from './config/config-manager.js';
export { estimateTokens } from './services/token-counter.js';

/**
 * Jarvis CLI host — wires the shared @jarvis/core engine to a terminal session.
 *
 * This is the CLI counterpart of the extension's JarvisSidebarProvider: it owns the
 * config, model providers, tool registry, HITL manager, token counter and checkpoints,
 * and hands the REPL fully-built AgentOrchestrators. All heavy logic lives in core;
 * here we only supply terminal-flavored host implementations (inquirer approvals, cwd
 * workspace root, etc.).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { confirm, input, select } from '@inquirer/prompts';
import {
  getConfigManager,
  ModelConfigManager,
  HITLManager,
  SecretScrubber,
  TokenCounter,
  CheckpointManager,
  ToolRegistry,
  createBuiltinTools,
  loadCustomTools,
  buildAgentSystemPrompt,
  loadRules,
  renderRules,
  renderJarvisMd,
  getWorkspaceRoot,
  type IModelProvider,
  type JarvisConfig,
  type ToolPolicy,
  type ApprovalPromptRequest,
  type ApprovalPromptDecision
} from '@jarvis/core';
import { accent, gold, dim, bold } from './theme.js';

export interface ActiveModel {
  provider: IModelProvider;
  model: string;
}

export class JarvisCliHost {
  readonly workspace: string;
  readonly hitl: HITLManager;
  readonly scrubber = new SecretScrubber();
  readonly tokenCounter = new TokenCounter();
  readonly checkpoints = new CheckpointManager();
  private modelConfig: ModelConfigManager;

  constructor() {
    // The core resolves "the current project" from JARVIS_WORKSPACE (falling back to
    // cwd). The CLI runs inside the target project, so cwd is the workspace.
    process.env.JARVIS_WORKSPACE = process.cwd();
    this.workspace = getWorkspaceRoot();

    const optimization = this.config().optimization ?? {};
    const mode = optimization.hitlMode ?? 'moderate';
    this.hitl = new HITLManager(mode === 'strict' || mode === 'moderate' || mode === 'free' ? mode : 'moderate');

    // Terminal approval prompt (inquirer). Returned as the primary handler so the
    // core never falls back to a (non-existent) native dialog in the CLI.
    this.hitl.setPromptHandler(req => this.promptApproval(req));

    this.modelConfig = new ModelConfigManager();
    const model = this.effectiveModel();
    this.tokenCounter.setLimit(model ? this.modelConfig.getContextLength(model) : null);
  }

  config(): JarvisConfig {
    return getConfigManager().getConfig();
  }

  reloadModels(): void {
    this.modelConfig = new ModelConfigManager();
  }

  effectiveModel(): string | null {
    return this.modelConfig.getEffectiveModel();
  }

  providerName(model: string | null): string | null {
    return this.modelConfig.getProviderNameForModel(model) ?? null;
  }

  /** The active chat model + its provider, or null when nothing is configured. */
  activeModel(): ActiveModel | null {
    const model = this.effectiveModel();
    if (!model) return null;
    const provider = this.modelConfig.getProvider(model);
    if (!provider) return null;
    return { provider, model };
  }

  availableModelNames(): string[] {
    return this.modelConfig.getAvailableModels().map(m => m.name);
  }

  setDefaultModel(name: string): void {
    void this.modelConfig.setDefaultModel(name);
    const model = this.effectiveModel();
    this.tokenCounter.setLimit(model ? this.modelConfig.getContextLength(model) : null);
  }

  /** Secret scrubbing is applied only to cloud providers (mirrors the extension). */
  scrubFor(model: string): ((text: string) => string) | undefined {
    if (!this.modelConfig.isCloudProvider(model)) return undefined;
    return text => this.scrubber.scrub(text).cleaned;
  }

  private toolPolicies(): Record<string, ToolPolicy> {
    return this.config().toolPolicies ?? {};
  }

  /** Builds a fresh tool registry: built-ins (minus excluded) + workspace custom tools. */
  async buildRegistry(): Promise<ToolRegistry> {
    const policies = this.toolPolicies();
    const registry = new ToolRegistry();
    for (const tool of createBuiltinTools()) {
      if (policies[tool.name] === 'excluded') continue;
      tool.origin = 'builtin';
      registry.register(tool);
    }
    try {
      for (const tool of await loadCustomTools(this.workspace)) {
        if (policies[tool.name] === 'excluded') continue;
        tool.origin = 'custom';
        registry.register(tool);
      }
    } catch {
      /* no custom tools */
    }
    return registry;
  }

  /** System prompt = persona + user rules + JARVIS.md (à la the extension). */
  buildSystemPrompt(registry: ToolRegistry, persona?: string, planOnly = false): string {
    const rules = renderRules(loadRules(this.config()));
    const jarvisMd = this.loadProjectInstructions();
    const extras = [rules, jarvisMd].filter(Boolean).join('\n\n');
    return buildAgentSystemPrompt(registry, persona, extras || undefined, { planOnly });
  }

  private loadProjectInstructions(): string {
    const file = join(this.workspace, 'JARVIS.md');
    if (!existsSync(file)) return '';
    try {
      return renderJarvisMd(readFileSync(file, 'utf-8'));
    } catch {
      return '';
    }
  }

  /** Inquirer approval card — the CLI equivalent of the webview ApprovalCard. */
  private async promptApproval(req: ApprovalPromptRequest): Promise<ApprovalPromptDecision | null> {
    process.stdout.write('\n' + accent('● Approval required') + '  ' + bold(req.description) + '\n');
    if (req.detail) {
      for (const line of req.detail.split('\n')) process.stdout.write(dim('    ' + line) + '\n');
    }
    const choice = await select({
      message: gold('Allow this action?'),
      choices: [
        { name: 'Allow once', value: 'allow' },
        { name: 'Allow for this session', value: 'allow-session' },
        { name: 'Deny (and tell the agent what to do instead)', value: 'deny' }
      ]
    });
    if (choice === 'allow') return { decision: 'allow' };
    if (choice === 'allow-session') return { decision: 'allow-session' };
    const wantFeedback = await confirm({ message: 'Add guidance for the agent?', default: false });
    const feedback = wantFeedback ? await input({ message: 'Instructions:' }) : undefined;
    return { decision: 'deny', feedback };
  }
}

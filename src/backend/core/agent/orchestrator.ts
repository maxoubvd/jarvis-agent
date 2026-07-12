import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, IModelProvider, ProviderUsage } from '../../models/abstract.js';
import { extractJson } from '../utils/json-cleaner.js';
import { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { ChangeTracker } from '../../services/change-tracker.js';
import { operationLogger } from '../../services/logger.js';
import { sanitizeTodoItems, type TodoItem } from './todo.js';

export interface GateResult {
  granted: boolean;
  reason: string;
  /** User instructions given when refusing. */
  feedback?: string;
}

export interface ApprovalGate {
  checkApproval(actionType: string, params: Record<string, unknown>): Promise<GateResult>;
  /** Unconditional confirmation ("ask first" tool policy). */
  askApproval?(actionType: string, params: Record<string, unknown>): Promise<GateResult>;
}

/** Per-tool policy (see config-manager.ToolPolicy); `excluded` is handled upstream, at the registry. */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

export interface AgentEvents {
  /** The model's chain of thought at each iteration. */
  onThinking?(text: string): void;
  onToolCall?(name: string, args: Record<string, unknown>): void;
  onToolResult?(name: string, result: string, success: boolean, args?: Record<string, unknown>): void;
  /** Full final text (at the end). */
  onFinal?(text: string): void;
  /** Streaming thought chunk. */
  onThinkingChunk?(text: string): void;
  /** Streaming final-text chunk. */
  onFinalChunk?(text: string): void;
  /** The TODO checklist was replaced (`update_todo_list` tool, or a workflow's synthesis). */
  onTodoUpdate?(items: TodoItem[]): void;
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
  /** Cumulative token stats returned by the API over the loop (including cache). */
  usage?: ProviderUsage;
}

/** Detects an API refusal related to forced JSON mode (`response_format`/`format`). */
function isJsonModeError(message: string): boolean {
  return /response_format|json_object|json mode|json_schema|does not support|not supported/i.test(message);
}

/** Adds a call's token stats to the loop's running total. */
function accumulateUsage(total: ProviderUsage, next: ProviderUsage | undefined): void {
  if (!next) return;
  total.promptTokens = (total.promptTokens ?? 0) + (next.promptTokens ?? 0);
  total.completionTokens = (total.completionTokens ?? 0) + (next.completionTokens ?? 0);
  total.cachedTokens = (total.cachedTokens ?? 0) + (next.cachedTokens ?? 0);
}

export interface OrchestratorOptions {
  maxIterations?: number;
  systemPrompt?: string;
  hitl?: ApprovalGate;
  /** Secret scrubbing applied to outgoing messages (cloud providers). */
  scrub?: (text: string) => string;
  /** Truncation of tool results injected into the context. */
  maxToolResultChars?: number;
  /** Policy per tool name: `auto` bypasses HITL, `ask` forces it. */
  toolPolicies?: Record<string, ToolPolicy>;
  /** Tracker for recording diffs of modified files. */
  changeTracker?: ChangeTracker;
  /** Workspace root for resolving relative paths. */
  workspaceFolder?: string;
  /** Abort signal to stop the ongoing generation. */
  abortSignal?: AbortSignal;
  /** Notified after successfully recording a file edit (UI auto-open). */
  onFileEdited?: (filePath: string) => void;
}

/** Structured response expected from the model (JSON Mode, spec §8.2). */
interface AgentAction {
  thought?: string;
  action?: { tool?: string; args?: Record<string, unknown> };
  final?: string;
}

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_MAX_RESULT_CHARS = 6000;

/** System prompt adaptations based on the model profile (spec §7 — small models). */
export interface AgentPromptOptions {
  /** Extra sentence(s) appended to the persona (e.g. devstral profile). */
  personaExtra?: string;
  /** Tightened prompt + extra few-shot (small local models like Qwen 7B). */
  compact?: boolean;
  /**
   * Plan mode: removes the rules that push the model to act with its tools
   * (they contradict the persona instruction to write nothing to disk)
   * and replaces them with rules suited to producing a read-only plan.
   */
  planOnly?: boolean;
}

export function buildAgentSystemPrompt(
  tools: ToolRegistry,
  persona?: string,
  rulesText?: string,
  options: AgentPromptOptions = {}
): string {
  return [
    persona ??
      'You are Jarvis, an autonomous software engineer embedded in VS Code. ' +
      'You accomplish tasks incrementally using the tools available to you.',
    ...(options.personaExtra ? [options.personaExtra] : []),
    ...(rulesText ? ['', rulesText] : []),
    '',
    'AVAILABLE TOOLS:',
    tools.describeForPrompt(),
    '',
    'RESPONSE FORMAT — You MUST respond with a SINGLE JSON object, with no surrounding text:',
    'To use a tool:',
    '{"thought": "short reasoning", "action": {"tool": "tool_name", "args": {"string_param": "value", "array_param": ["item1"]}}}',
    'IMPORTANT: Respect argument types (string, number, boolean, array). For example, for an array, use `["val1", "val2"]` and not a string `"[\\"val1\\"]"`.',
    'To finish and answer the user:',
    '{"thought": "short reasoning", "final": "answer in Markdown"}',
    '',
    'EXAMPLE:',
    'User: What TypeScript files exist under src?',
    'You: {"thought": "Listing the .ts files", "action": {"tool": "file_glob_search", "args": {"pattern": "src/**/*.ts"}}}',
    'Result: src/index.ts',
    'You: {"thought": "Got the list", "final": "Only one TypeScript file: `src/index.ts`"}',
    ...(options.compact
      ? [
          '',
          'EXAMPLE 2 (editing a file):',
          'User: Fix the README title',
          'You: {"thought": "Reading the file", "action": {"tool": "read_file", "args": {"path": "README.md"}}}',
          'Result: # Old title…',
          'You: {"thought": "Replacing the title", "action": {"tool": "single_find_and_replace", "args": {"path": "README.md", "old_string": "# Old title", "new_string": "# New title"}}}',
          'Result: Replacement done',
          'You: {"thought": "Done", "final": "Fixed the title in `README.md`."}',
          '',
          'IMPORTANT: respond ONLY with the JSON object — no text before or after, no surrounding markdown block.'
        ]
      : []),
    '',
    'RULES:',
    '- One action per response.',
    ...(options.planOnly
      ? [
          '- You MUST NOT create or modify anything on disk and must not run any command: use only your read-only tools (read_file, grep_search, ls, file_glob_search...) to explore the project.',
          '- Once your exploration is complete, respond with `final` containing the full implementation plan in Markdown. Never stop on a write action: those tools are not provided to you in this mode.',
          '- Just before (or with) that final response, call update_todo_list EXACTLY ONCE with the plan\'s implementation steps (all "pending"): this checklist is the one that will be followed live later, when the plan is executed. Do not call it during exploration.'
        ]
      : [
          '- ACT with your tools, don\'t describe: to create/modify a file use create_new_file/edit_existing_file, to run a command use run_terminal_command. NEVER give the user a script or command to copy-paste when a tool can do it.',
          '- For a long-running process (dev server, watcher), use run_in_background then check_background_process.',
          '- NEVER rewrite a file\'s full content in your final response. Just briefly confirm your changes.',
          '- If you\'re following a checklist with update_todo_list (yours, or one inherited from an approved plan), keep it up to date live: call the tool again ' +
            'on every status change (a task moves to "in_progress" when you start it, "completed" ' +
            'as soon as it\'s done) rather than setting it once and forgetting about it.'
        ]),
    '- Break complex tasks down into micro-tasks (one atomic step at a time).',
    '- Check the result of each tool before continuing.',
    '- If a tool fails, analyze the error and adapt your strategy.'
  ].join('\n');
}

/**
 * Agentic loop (spec §4): the model chooses tools, the orchestrator executes
 * them (with HITL approval) and feeds back the results until the final
 * response or the max number of iterations.
 */
export class AgentOrchestrator {
  /**
   * Providers (by `name`) that have rejected forced JSON mode: we stop sending
   * them `response_format` and fall back to the prompt + json-cleaner. Remembered
   * at the process level so we don't retry on every request.
   */
  private static jsonModeUnsupported = new Set<string>();

  constructor(
    public provider: IModelProvider,
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
    let retryCount = 0;
    let loopCount = 0;
    let lastToolSignature = '';
    // Structured Outputs: force parsable JSON via the API for as long as the provider accepts it.
    let useJsonMode = !AgentOrchestrator.jsonModeUnsupported.has(this.provider.name);
    const totalUsage: ProviderUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.options.abortSignal?.throwIfAborted();

      if (iteration === maxIterations) {
        const msg = `I've reached the limit of ${maxIterations} iterations. Would you like me to continue?`;
        events.onFinal?.(msg);
        steps.push({ success: true, result: msg });
        return { success: true, finalText: msg, steps, iterations: iteration, usage: totalUsage };
      }

      let raw = '';
      let nativeToolCalls: import('../../models/abstract.js').NativeToolCall[] | undefined = undefined;
      let lastThoughtLength = 0;
      let lastFinalLength = 0;
      const sendOptions = useJsonMode ? ({ responseFormat: 'json_object' } as const) : undefined;
      try {
        if (this.provider.sendPromptStream) {
          await this.provider.sendPromptStream(
            messages,
            chunk => {
              raw += chunk;
              // Streaming extraction of <thinking>
              const thinkingMatch = raw.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/i);
              if (thinkingMatch) {
                const thinkingText = thinkingMatch[1];
                const newText = thinkingText.slice(lastThoughtLength);
                if (newText) {
                  events.onThinkingChunk?.(newText);
                  lastThoughtLength = thinkingText.length;
                }
              } else {
                // Rudimentary extraction of "thought" for partial streaming
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
              }

              // Rudimentary extraction of "final" for partial streaming
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
            (toolCalls, usage) => { nativeToolCalls = toolCalls; accumulateUsage(totalUsage, usage); },
            err => { throw err; },
            this.tools.list(),
            this.options.abortSignal,
            sendOptions
          );
        } else {
          const res = await this.provider.sendPrompt(messages, this.tools.list(), this.options.abortSignal, sendOptions);
          if (typeof res === 'string') {
            raw = res;
          } else {
            raw = res.text;
            nativeToolCalls = res.toolCalls;
            accumulateUsage(totalUsage, res.usage);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Structured Outputs fallback: the provider refuses `response_format` -
        // disable JSON mode (remembered) and replay the iteration without it.
        if (useJsonMode && isJsonModeError(msg)) {
          useJsonMode = false;
          AgentOrchestrator.jsonModeUnsupported.add(this.provider.name);
          operationLogger.log('agent', `JSON mode not supported by ${this.provider.name} - falling back to prompt (${msg.slice(0, 120)})`, 'error');
          iteration--; // the for(...) re-increments: we replay the same iteration
          continue;
        }
        if (msg.includes('aborted')) {
          return { success: false, finalText: '', steps, iterations: iteration, error: 'Generation canceled by the user.', usage: totalUsage };
        }
        return { success: false, finalText: '', steps, iterations: iteration, error: `Model error: ${msg}`, usage: totalUsage };
      }

      const parsed = extractJson<AgentAction>(raw);

      let action: Partial<AgentAction> = parsed.value || {};
      let isNativeTool = false;

      if (nativeToolCalls && nativeToolCalls.length > 0) {
        const tc = nativeToolCalls[0];
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          action = {
            thought: parsed.surroundingText || raw,
            action: {
              tool: tc.function.name,
              args
            }
          };
          isNativeTool = true;
          parsed.ok = true;
        } catch {
          // Args parse error -> will trigger retry or error
        }
      }

      // Fallback for models outputting native tool format directly in text JSON
      if (!isNativeTool && parsed.ok) {
        const asAny = action as any;
        if (!action.action?.tool && !action.final) {
          if (asAny.name && asAny.arguments !== undefined) {
             let parsedArgs = asAny.arguments;
             if (typeof parsedArgs === 'string') {
               try { parsedArgs = JSON.parse(parsedArgs); } catch { /* keep raw string arg */ }
             }
             action = {
               thought: parsed.surroundingText || raw,
               action: { tool: asAny.name, args: parsedArgs }
             };
          } else if (asAny.tool && asAny.args !== undefined) {
             action = {
               thought: parsed.surroundingText || raw,
               action: { tool: asAny.tool, args: asAny.args }
             };
          }
        }
      }

      // Retry system
      if (!isNativeTool && (!parsed.ok || (!action.action?.tool && action.final === undefined))) {
        if (retryCount < 3) {
          retryCount++;
          messages.push({ role: 'assistant', content: raw });
          messages.push({ role: 'user', content: "Error: Unexpected format. You must use a native tool call or provide a valid JSON object with 'action' or 'final'. Redo your response." });
          events.onThinkingChunk?.('\n\n*(Retrying after a format error)*\n\n');
          continue;
        } else {
          // No usable JSON - treat the raw response as final.
          const finalText = (parsed.surroundingText ?? raw).trim();
          events.onFinal?.(finalText);
          steps.push({ success: true, result: finalText });
          return { success: true, finalText, steps, iterations: iteration, usage: totalUsage };
        }
      }

      retryCount = 0;
      const thoughtText = action.thought || parsed.surroundingText;

      // Don't emit onThinking here if we already streamed it
      if (thoughtText && lastThoughtLength === 0) {
        events.onThinking?.(thoughtText);
      }

      if (action.final !== undefined || !action.action?.tool) {
        const finalText = action.final ?? thoughtText ?? raw;
        if (lastFinalLength === 0) events.onFinal?.(finalText);
        steps.push({ thought: thoughtText, success: true, result: finalText });
        return { success: true, finalText, steps, iterations: iteration, usage: totalUsage };
      }

      const assistantMsg: ChatMessage = { role: 'assistant', content: raw };
      if (nativeToolCalls) {
        assistantMsg.tool_calls = nativeToolCalls;
      }
      messages.push(assistantMsg);

      const toolsToExecute: Array<{ toolName: string; args: Record<string, unknown>; id?: string }> = [];
      if (isNativeTool && nativeToolCalls) {
        for (const tc of nativeToolCalls) {
          let tcArgs = {};
          try { tcArgs = JSON.parse(tc.function.arguments || '{}'); } catch { /* fall back to empty args */ }
          toolsToExecute.push({ toolName: tc.function.name, args: tcArgs, id: tc.id });
        }
      } else {
        toolsToExecute.push({ toolName: action.action!.tool, args: action.action!.args ?? {} });
      }

      for (const t of toolsToExecute) {
        const toolName = t.toolName;
        const args = t.args;
        const tool = this.tools.get(toolName);

        const currentSignature = JSON.stringify({ toolName, args });
        if (currentSignature === lastToolSignature) {
          loopCount++;
        } else {
          loopCount = 0;
          lastToolSignature = currentSignature;
        }

        if (loopCount >= 3) {
          const errMsg = `LOOP DETECTED: You called the tool "${toolName}" with the same arguments 4 times in a row. This is not allowed. Change your strategy, use another tool, or finish with "final".`;
          steps.push({ thought: thoughtText, tool: toolName, args, result: errMsg, success: false });
          events.onToolResult?.(toolName, errMsg, false, args);
          messages.push({
            role: isNativeTool ? 'tool' : 'user',
            content: errMsg,
            tool_call_id: t.id
          });
          continue;
        }

        if (!tool) {
          const errText = `Unknown tool: "${toolName}". Available tools: ${this.tools.list().map(td => td.name).join(', ')}`;
          steps.push({ thought: thoughtText, tool: toolName, args, result: errText, success: false });
          messages.push({ 
            role: isNativeTool ? 'tool' : 'user', 
            content: errText,
            tool_call_id: t.id 
          });
          continue;
        }

        events.onToolCall?.(toolName, args);

        const gate = await this.gate(tool, toolName, args);
        if (!gate.granted) {
          steps.push({ thought: thoughtText, tool: toolName, args, result: gate.refusal, success: false });
          events.onToolResult?.(toolName, gate.refusal, false, args);
          messages.push({ 
            role: isNativeTool ? 'tool' : 'user', 
            content: gate.refusal,
            tool_call_id: t.id 
          });
          continue;
        }

        let result: string;
        let success = true;
        try {
          result = await this.executeWithTracking(tool, toolName, args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          success = false;
        }

        if (result.length > maxResultChars) {
          result = result.slice(0, maxResultChars) + `\n... (truncated, ${result.length} characters total)`;
        }

        steps.push({ thought: thoughtText, tool: toolName, args, result, success });
        events.onToolResult?.(toolName, result, success, args);

        if (success && toolName === 'update_todo_list') {
          events.onTodoUpdate?.(sanitizeTodoItems(args.items));
        }

        messages.push({
          role: isNativeTool ? 'tool' : 'user',
          content: isNativeTool ? scrub(result) : scrub(`Result of tool ${toolName}:\n${result}\n\nContinue (JSON or native tool call only).`),
          tool_call_id: t.id
        });
      }
    }

    const error = `Maximum number of iterations reached (${maxIterations})`;
    return { success: false, finalText: '', steps, iterations: maxIterations, error, usage: totalUsage };
  }

  /** HITL check for a tool call, shared by both loops. */
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
      ? `Action refused by the user. Their instructions: "${approval.feedback}". Follow these instructions.`
      : `Action refused by the user (${approval.reason}). Don't insist, suggest an alternative or stop.`;
    return { granted: false, refusal };
  }

  /** Executes a tool and records the diff of modified files (change-tracker). */
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
      // Extract the path (often "path", "file", "TargetFile" or "AbsolutePath").
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

    const result = await tool.execute(args, this.options.abortSignal);

    if (isFileEdit && this.options.changeTracker && filePath) {
      try {
        const afterContent = await fs.promises.readFile(filePath, 'utf8');
        this.options.changeTracker.record(filePath, beforeContent, afterContent);
        this.options.onFileEdited?.(filePath);
      } catch {
        // Read may fail if the file was deleted - ignore.
      }
    }

    return result;
  }
}

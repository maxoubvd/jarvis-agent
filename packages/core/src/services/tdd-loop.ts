import { ChatMessage, IModelProvider } from '../models/abstract.js';
import { extractJson } from '../core/utils/json-cleaner.js';

export interface GeneratedFile {
  path: string;
  content: string;
}

interface GenerationResponse {
  files?: GeneratedFile[];
  explanation?: string;
  testCommand?: string;
}

export interface TestRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TDDDeps {
  writeFile(path: string, content: string): Promise<void>;
  runCommand(command: string, timeout: number): Promise<TestRunResult>;
}

export interface TDDOptions {
  maxAttempts?: number;
  testCommand?: string;
  /** Initial timeout in ms — doubled after each timeout (spec §3.3). */
  timeout?: number;
}

export interface TDDCallbacks {
  onAttemptStart?(attempt: number, maxAttempts: number): void;
  onFilesGenerated?(files: GeneratedFile[], explanation?: string): void;
  onTestResult?(result: TestRunResult, attempt: number): void;
}

export interface TDDResult {
  success: boolean;
  attempts: number;
  filesWritten: string[];
  lastTestOutput: string;
  explanation?: string;
  error?: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT = 30000;

const TDD_SYSTEM_PROMPT = [
  'You are Jarvis in Auto-TDD mode: you write code that must make tests pass.',
  'You MUST respond with A SINGLE JSON object, no text around:',
  '{"explanation": "brief summary", "files": [{"path": "relative/path.ts", "content": "full file content"}]}',
  'Rules:',
  '- Provide the COMPLETE content of each file (no fragments).',
  '- Only modify necessary files.',
  '- Fix the root cause of test failures, not the symptoms.'
].join('\n');

/** Truncates test output to keep only the end (where errors are). */
export function summarizeTestOutput(stdout: string, stderr: string, maxChars = 4000): string {
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.length <= maxChars) return combined;
  return '... (start truncated)\n' + combined.slice(combined.length - maxChars);
}

/**
 * Auto-TDD loop (spec §3.3):
 * generate code → write files → run tests → analyze → fix,
 * maximum `maxAttempts` attempts.
 */
export class AutoTDDLoop {
  constructor(
    private provider: IModelProvider,
    private deps: TDDDeps
  ) {}

  public async run(task: string, options: TDDOptions = {}, callbacks: TDDCallbacks = {}): Promise<TDDResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const testCommand = options.testCommand ?? 'npm test';
    let timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const messages: ChatMessage[] = [
      { role: 'system', content: TDD_SYSTEM_PROMPT },
      { role: 'user', content: `Task: ${task}\nTest command: ${testCommand}` }
    ];

    const filesWritten = new Set<string>();
    let lastTestOutput = '';
    let lastExplanation: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      callbacks.onAttemptStart?.(attempt, maxAttempts);

      // 1-2. Generate the code
      let raw: string;
      try {
        const res = await this.provider.sendPrompt(messages);
        raw = typeof res === 'string' ? res : res.text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          attempts: attempt,
          filesWritten: [...filesWritten],
          lastTestOutput,
          error: `Model error: ${msg}`
        };
      }

      const parsed = extractJson<GenerationResponse>(raw);
      if (!parsed.ok || !parsed.value?.files?.length) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({
          role: 'user',
          content: 'Invalid response. RESPOND ONLY with the requested JSON: {"explanation": "...", "files": [{"path": "...", "content": "..."}]}'
        });
        continue;
      }

      const { files, explanation } = parsed.value;
      lastExplanation = explanation;
      callbacks.onFilesGenerated?.(files!, explanation);

      // 3. Write/edit the files
      try {
        for (const file of files!) {
          await this.deps.writeFile(file.path, file.content);
          filesWritten.add(file.path);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: `Write failure: ${msg}. Adjust the paths and retry.` });
        continue;
      }

      // 4. Run the tests
      const result = await this.deps.runCommand(testCommand, timeout);
      lastTestOutput = summarizeTestOutput(result.stdout, result.stderr);
      callbacks.onTestResult?.(result, attempt);

      // 5. Analyze
      if (result.success) {
        return {
          success: true,
          attempts: attempt,
          filesWritten: [...filesWritten],
          lastTestOutput,
          explanation: lastExplanation
        };
      }

      if (result.timedOut) {
        // Progressive timeout increase (spec §3.3)
        timeout *= 2;
      }

      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: [
          `Tests are failing (attempt ${attempt}/${maxAttempts})${result.timedOut ? ' — TIMEOUT' : ''}.`,
          'Test output:',
          '```',
          lastTestOutput,
          '```',
          'Analyze the cause of the failure and generate a targeted correction (JSON only).'
        ].join('\n')
      });
    }

    return {
      success: false,
      attempts: maxAttempts,
      filesWritten: [...filesWritten],
      lastTestOutput,
      explanation: lastExplanation,
      error: `Failure after ${maxAttempts} attempts`
    };
  }
}

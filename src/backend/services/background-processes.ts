import { spawn, type ChildProcess } from 'child_process';

/** Max output size retained per process (we keep the tail end). */
const MAX_OUTPUT_CHARS = 20_000;

export interface BackgroundProcessStatus {
  id: string;
  command: string;
  pid: number | undefined;
  running: boolean;
  exitCode: number | null;
  startedAt: string;
  /** Tail end of the combined stdout+stderr output. */
  output: string;
}

interface BackgroundProcessEntry {
  id: string;
  command: string;
  child: ChildProcess;
  output: string;
  exitCode: number | null;
  running: boolean;
  startedAt: Date;
}

/**
 * Processes launched in the background by the agent (`run_in_background` tool):
 * dev servers, watchers, long-running tasks. Output is buffered (tail end
 * retained) and can be inspected via `check_background_process`.
 */
export class BackgroundProcessManager {
  private processes = new Map<string, BackgroundProcessEntry>();
  private counter = 0;

  public start(command: string, cwd: string): BackgroundProcessStatus {
    const id = `bg-${++this.counter}`;
    const isWindows = process.platform === 'win32';
    const child = isWindows
      ? spawn('cmd.exe', ['/c', command], { cwd })
      : spawn('/bin/sh', ['-c', command], { cwd });

    const entry: BackgroundProcessEntry = {
      id,
      command,
      child,
      output: '',
      exitCode: null,
      running: true,
      startedAt: new Date()
    };

    const append = (data: Buffer) => {
      entry.output = (entry.output + data.toString()).slice(-MAX_OUTPUT_CHARS);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', err => {
      entry.output = (entry.output + `\n[error] ${err.message}`).slice(-MAX_OUTPUT_CHARS);
      entry.running = false;
    });
    child.on('close', code => {
      entry.exitCode = code;
      entry.running = false;
    });

    this.processes.set(id, entry);
    return this.toStatus(entry);
  }

  public status(id: string): BackgroundProcessStatus | null {
    const entry = this.processes.get(id);
    return entry ? this.toStatus(entry) : null;
  }

  public list(): BackgroundProcessStatus[] {
    return [...this.processes.values()].map(e => this.toStatus(e));
  }

  /** Kills the process (full tree on Windows via taskkill). */
  public stop(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry || !entry.running) return false;
    const pid = entry.child.pid;
    if (process.platform === 'win32' && pid) {
      // child.kill() would only kill cmd.exe, not its children (dev server…).
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      entry.child.kill('SIGTERM');
    }
    entry.running = false;
    return true;
  }

  /** Stops everything (extension deactivation). */
  public dispose(): void {
    for (const id of this.processes.keys()) {
      try {
        this.stop(id);
      } catch {
        /* best-effort */
      }
    }
    this.processes.clear();
  }

  private toStatus(entry: BackgroundProcessEntry): BackgroundProcessStatus {
    return {
      id: entry.id,
      command: entry.command,
      pid: entry.child.pid,
      running: entry.running,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt.toISOString(),
      output: entry.output
    };
  }
}

/** Instance shared by the registry's tools. */
export const backgroundProcesses = new BackgroundProcessManager();

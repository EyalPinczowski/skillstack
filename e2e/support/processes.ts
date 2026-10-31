import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Small process helpers for the global setup. TEST INFRASTRUCTURE. */

export interface Service {
  name: string;
  child: ChildProcess;
  logFile: string;
}

export function startService(
  name: string,
  dir: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Service {
  const logFile = join(dir, `${name}.log`);
  const fd = openSync(logFile, 'a');
  // detached: its own process group, so stopping it also stops anything it started.
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  closeSync(fd);
  return { name, child, logFile };
}

/** Runs a command to completion; on failure the error carries the end of its output. */
export async function runToCompletion(
  name: string,
  dir: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  const service = startService(name, dir, command, args, options);
  const code = await new Promise<number | null>((resolve) => {
    service.child.once('exit', (c) => resolve(c));
  });
  if (code !== 0) throw new Error(`${name} failed (exit ${code}):\n${tail(service.logFile)}`);
}

export function tail(file: string, lines = 40): string {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

export async function waitForHttp(
  url: string,
  service: Service,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new Error(`${service.name} exited early:\n${tail(service.logFile)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${service.name} did not answer ${url} in time:\n${tail(service.logFile)}`);
}

export function stopService(service: Service): void {
  const pid = service.child.pid;
  if (!pid || service.child.exitCode !== null) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

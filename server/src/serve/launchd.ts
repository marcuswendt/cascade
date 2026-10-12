/**
 * Optional macOS launchd job for `cascade serve install`.
 *
 * launchd runs the same `cascade serve run` supervisor that `serve start`
 * detaches, so the two paths share one stop, one restart and one status. The
 * job restarts the supervisor only if it exits unsuccessfully (it gave up
 * after repeated crashes), and starts at login.
 */
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface LaunchdJob {
  readonly label: string;
  readonly programArguments: readonly string[];
  readonly workingDirectory: string;
  readonly logFile: string;
  readonly environment: Readonly<Record<string, string>>;
}

export function launchdLabel(id: string): string {
  return `io.field.cascade.${id}`;
}

export function launchAgentsDir(): string {
  return process.env.CASCADE_LAUNCH_AGENTS_DIR ?? path.join(os.homedir(), 'Library', 'LaunchAgents');
}

export function plistPath(label: string): string {
  return path.join(launchAgentsDir(), `${label}.plist`);
}

export function renderPlist(job: LaunchdJob): string {
  const string = (value: string) => `<string>${escapeXml(value)}</string>`;
  const env = Object.entries(job.environment)
    .map(([key, value]) => `      <key>${escapeXml(key)}</key>\n      ${string(value)}`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    ${string(job.label)}
    <key>ProgramArguments</key>
    <array>
${job.programArguments.map((argument) => `      ${string(argument)}`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    ${string(job.workingDirectory)}
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>StandardOutPath</key>
    ${string(job.logFile)}
    <key>StandardErrorPath</key>
    ${string(job.logFile)}
  </dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `gui/<uid>`: the per-user domain a LaunchAgent belongs to. */
export function guiDomain(): string {
  return `gui/${process.getuid?.() ?? os.userInfo().uid}`;
}

/** Run launchctl; returns stderr on failure instead of throwing. */
export function launchctl(...args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    return { ok: false, output: (failure.stderr || failure.message).trim() };
  }
}

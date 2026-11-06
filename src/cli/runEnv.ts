/**
 * `--env NAME=value` for `cascade run` and `cascade render`: a variable for
 * the run's Python stages and render workers, set without a shell prefix
 * (`NAME=1 cascade run …`), which agent shells often refuse. The run trace
 * records the names, never the values.
 */

/** Every `--env` pair on a command line, to a record. A malformed pair is an error, not a guess. */
export function parseEnvArgs(args: readonly string[]): Record<string, string> | undefined {
  const pairs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--env') continue;
    const pair = args[index + 1];
    if (pair === undefined) throw new Error('--env takes NAME=value');
    pairs.push(pair);
  }
  if (!pairs.length) return undefined;
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const name = at > 0 ? pair.slice(0, at) : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`--env takes NAME=value (got "${pair}")`);
    env[name] = pair.slice(at + 1);
  }
  return env;
}

/** Set `env` on this process; returns what puts the previous values back. */
export function applyEnv(env: Readonly<Record<string, string>> | undefined): () => void {
  if (!env) return () => {};
  const previous = Object.keys(env).map((name) => [name, process.env[name]] as const);
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

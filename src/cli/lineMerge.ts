/**
 * Carry an edit over to a file whose formatting the editor cannot reproduce.
 *
 * Python's `json.dump` writes `1.0` where JavaScript writes `1`, so a graph an
 * agent once wrote from Python re-serialises with a handful of lines changed
 * that the edit never touched. Rewriting them would be churn. Instead: diff
 * the re-serialised original against the re-serialised edit, and rebuild the
 * file from the ORIGINAL text for every line the edit left alone.
 *
 * Only possible when the re-serialised original lines up with the file line
 * for line (same indentation, same line breaks), which the caller checks.
 */

/**
 * For each line of `after`, the index of the equal line in `before` it
 * corresponds to, or -1 for an inserted or changed line. A longest common
 * subsequence by Myers' algorithm, which is fast when the edit is small.
 */
export function matchLines(before: readonly string[], after: readonly string[], limit = 2000): number[] | null {
  const n = before.length;
  const m = after.length;
  const max = Math.min(n + m, limit);
  const offset = max + 1;
  const frontier = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(frontier.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!)
        ? frontier[offset + k + 1]!
        : frontier[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  // Walk the trace back from the end, recording the diagonal (equal) moves.
  const match = new Array<number>(m).fill(-1);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
    const previousK = down ? k + 1 : k - 1;
    const previousX = v[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      match[y] = x;
    }
    if (d > 0) {
      x = previousX;
      y = previousY;
    }
  }
  return match;
}

/**
 * The edited file: `after` line by line, except that a line equal to one in
 * `serializedBefore` is taken from the original text at the same position.
 */
export function mergeLines(original: readonly string[], serializedBefore: readonly string[], after: readonly string[]): string[] | null {
  // Most of a file is untouched by one edit: match the common ends directly
  // and run the diff on the middle only.
  let prefix = 0;
  while (prefix < serializedBefore.length && prefix < after.length && serializedBefore[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < serializedBefore.length - prefix && suffix < after.length - prefix &&
    serializedBefore[serializedBefore.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const middle = matchLines(
    serializedBefore.slice(prefix, serializedBefore.length - suffix),
    after.slice(prefix, after.length - suffix),
  );
  if (!middle) return null;
  return after.map((line, index) => {
    if (index < prefix) return original[index]!;
    if (index >= after.length - suffix) return original[serializedBefore.length - (after.length - index)]!;
    const matched = middle[index - prefix]!;
    return matched >= 0 ? original[matched + prefix]! : line;
  });
}

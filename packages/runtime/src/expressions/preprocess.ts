/**
 * Expression preprocessing: Houdini-style `$` time variables.
 *
 * Expressions compile to raw JS (`return (<expr>)`) evaluated against a context
 * object, so `$F` is not valid input. This pass rewrites the `$` spellings to
 * the plain identifiers the context carries, before compilation. The bare
 * identifiers remain valid aliases — `time`, `frame`, `fframe`, `fps` — so
 * nothing already authored breaks.
 *
 *   $F    -> frame    integer frame
 *   $FF   -> fframe   fractional frame
 *   $T    -> time     seconds
 *   $FPS  -> fps      rate
 *
 * `$` is rewritten only in code position: occurrences inside string or template
 * literals are left alone, so `chs("$F")` stays a string.
 */

/** The `$` time tokens, longest first so `$FPS` wins over `$F`. */
export const TIME_TOKENS: ReadonlyArray<readonly [token: string, identifier: string]> = [
  ["$FPS", "fps"],
  ["$FF", "fframe"],
  ["$F", "frame"],
  ["$T", "time"]
];

/** Bare identifiers that carry time, kept as aliases for the `$` spellings. */
export const TIME_IDENTIFIERS: readonly string[] = ["time", "frame", "fframe", "fps"];

const DOLLAR_TIME_PATTERN = /\$(FPS|FF|F|T)\b/g;
const BARE_TIME_PATTERN = /\b(?:time|frame|fframe|fps)\b/;

const DOLLAR_TO_IDENTIFIER: Record<string, string> = {
  FPS: "fps",
  FF: "fframe",
  F: "frame",
  T: "time"
};

/**
 * Split an expression into code and literal spans, so a rewrite can skip
 * string and template literals. Deliberately small: it handles quotes and
 * escapes, which is all an expression field contains.
 */
function codeSpans(source: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let spanStart = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      spans.push({ start: spanStart, end: index });
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      spanStart = index;
      continue;
    }
    index += 1;
  }

  spans.push({ start: spanStart, end: source.length });
  return spans;
}

/**
 * Rewrite `$` time variables to their plain identifiers.
 * Returns the source unchanged when it contains no `$`.
 */
export function preprocessExpression(source: string): string {
  if (!source.includes("$")) return source;

  let out = "";
  let cursor = 0;

  for (const span of codeSpans(source)) {
    // Literal text between spans is copied verbatim.
    if (span.start > cursor) out += source.slice(cursor, span.start);
    out += source
      .slice(span.start, span.end)
      .replace(DOLLAR_TIME_PATTERN, (_match, key: string) => DOLLAR_TO_IDENTIFIER[key]);
    cursor = span.end;
  }

  if (cursor < source.length) out += source.slice(cursor);
  return out;
}

/**
 * True if an expression references any time variable, in either spelling.
 * This is what sets `isTimeDependent`, which is what lets a per-frame cook
 * recompute only the time-dependent subgraph.
 */
export function hasTimeReference(source: string): boolean {
  if (BARE_TIME_PATTERN.test(source)) return true;
  DOLLAR_TIME_PATTERN.lastIndex = 0;
  return DOLLAR_TIME_PATTERN.test(source);
}

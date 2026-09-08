/**
 * Whatever was thrown, as an `Error` that says something.
 *
 * `Error executing node volume: {}` is what Marcus saw when a WebGPU node
 * failed, and the empty object is the whole problem: **`GPUPipelineError`,
 * `GPUValidationError` and `DOMException` carry `message` on the prototype and
 * have no enumerable own properties**, so anything that serialises them —
 * `JSON.stringify`, a log panel, a console forwarder — produces `{}` and the
 * reason is gone. A WebGPU failure was invisible by construction, which was
 * going to matter for every GPU node from here on.
 *
 * The other half is that a node's `error` field was assigned the raw thrown
 * value and typed `Error`. Anything reading `.message` off a string, a plain
 * object or a `GPUPipelineError` got `undefined`, so the fault propagated
 * silently past the log line into every consumer.
 *
 * So: normalise once, at the throw site, and keep the original on `cause` for
 * anyone who wants to inspect it.
 */
export function asError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;

  const described = describeThrown(thrown);
  const error = new Error(described);
  // Not lost, just not the message: a caller that knows what it is looking at
  // can still reach the original.
  (error as Error & { cause?: unknown }).cause = thrown;
  return error;
}

/**
 * A one-line description of a non-`Error` throw.
 *
 * The constructor name is included because for a `DOMException` or a
 * `GPUPipelineError` it is often the most informative part — `AbortError` and
 * `GPUPipelineError` each say more than their message sometimes does. `reason`
 * is read because that is where `GPUPipelineError` puts the useful half.
 */
export function describeThrown(thrown: unknown): string {
  if (thrown === null) return 'null was thrown';
  if (thrown === undefined) return 'undefined was thrown';
  if (typeof thrown === 'string') return thrown || 'an empty string was thrown';
  if (typeof thrown !== 'object') return `${String(thrown)} was thrown`;

  const value = thrown as { constructor?: { name?: string }; message?: unknown; reason?: unknown; name?: unknown };
  const kind = typeof value.name === 'string' && value.name
    ? value.name
    : value.constructor?.name || 'object';
  const parts: string[] = [];
  if (typeof value.message === 'string' && value.message) parts.push(value.message);
  if (typeof value.reason === 'string' && value.reason) parts.push(`reason: ${value.reason}`);

  // Last resort: a plain object with no message at all is worth printing
  // rather than reporting as an empty one, which is the state this replaces.
  if (!parts.length) {
    try {
      const json = JSON.stringify(thrown);
      if (json && json !== '{}') parts.push(json);
    } catch {
      // Circular or otherwise unserialisable; the kind alone will have to do.
    }
  }
  return parts.length ? `${kind}: ${parts.join(', ')}` : `${kind} was thrown with no message`;
}

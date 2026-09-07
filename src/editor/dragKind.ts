/**
 * Whether a drag is carrying files.
 *
 * The canvas accepts file drops, so it claimed every drag that crossed it:
 * `dragover` and `drop` both called `preventDefault` and `stopPropagation`
 * unconditionally, and `drop` then bailed out when there were no files. But a
 * dockview panel drag is an HTML5 drag too, and its handlers live on the
 * canvas's ancestors — so dragging a second viewer over the graph was
 * swallowed: dockview never saw the drop, the panel never moved, and the drop
 * indicator it had already shown was never cleared, with no error anywhere.
 *
 * So the canvas claims a drag only when it is one it can actually use. The test
 * is `types`, not `files`: during `dragover` the browser withholds the file
 * list for security and only advertises the kinds, so `dataTransfer.files` is
 * empty until the drop and cannot be used to decide.
 */
export function isFileDrag(event: Pick<DragEvent, 'dataTransfer'>): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

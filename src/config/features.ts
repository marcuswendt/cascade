/**
 * The embedded code editor.
 *
 * Switched off when node code moved to being written by Claude Code rather than
 * hand-edited in the app. Back on 2026-09-07 at Marcus's request, alongside the
 * right-click "View source" item — a menu entry that opens a surface the app has
 * disabled is worse than either having it or not.
 *
 * Re-enabling this also restores double-click-to-open-code in GraphPanel, which
 * reads the same flag.
 */
export const ENABLE_CODE_EDITOR = true;

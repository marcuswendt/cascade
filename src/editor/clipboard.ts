let sessionClipboard = '';

/**
 * Returns whether the text reached the **system** clipboard.
 *
 * The distinction matters for anything meant to leave the page. Node copy and
 * paste is happy with the session copy above — it only needs to survive from
 * one keystroke to the next inside Studio — but copying a transcript to paste
 * into a bug report is useless if it only ever reached a variable. Callers who
 * do not care can keep ignoring the result, which is why this widened rather
 * than gaining a second function.
 */
export async function writeCascadeClipboard(text: string): Promise<boolean> {
  sessionClipboard = text;

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Hostname-based HTTP is not a secure context, so keep the session copy.
    }
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function readCascadeClipboard(): Promise<string> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.readText) {
    try {
      const text = await clipboard.readText();
      if (text) return text;
    } catch {
      // Fall through to the in-page clipboard used on non-secure hosts.
    }
  }

  return sessionClipboard;
}

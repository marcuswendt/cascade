let sessionClipboard = '';

export async function writeCascadeClipboard(text: string): Promise<void> {
  sessionClipboard = text;

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Hostname-based HTTP is not a secure context, so keep the session copy.
    }
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
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

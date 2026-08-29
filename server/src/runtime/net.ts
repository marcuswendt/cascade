let capability: Promise<string> | null = null;

export async function authorizedFetch(credential: string, url: string, init: RequestInit = {}): Promise<Response> {
  capability ??= fetch('/api/net/capability').then(async (response) => {
    if (!response.ok) throw new Error(`Authorized fetch capability failed: HTTP ${response.status}`);
    return (await response.json()).capability as string;
  });
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const response = await fetch('/api/net', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cascade-Net-Capability': await capability },
    body: JSON.stringify({ credential, url, method: init.method ?? 'GET', headers,
      ...(typeof init.body === 'string' ? { body: init.body } : {}) }),
    signal: init.signal,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error ?? `Authorized fetch failed: HTTP ${response.status}`);
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers: result.headers });
}

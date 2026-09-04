/**
 * Notices when the server is serving a newer build than this page is running.
 *
 * A Studio tab is long-lived and never re-requests index.html on its own, so
 * across a rebuild it keeps running old code. The symptom that exposed this
 * was File > Save silently downloading a file instead of writing back to the
 * project, because the code that asks the server for the project graph did
 * not exist yet in the loaded bundle. That is indistinguishable from a
 * missing feature, which is the worst kind of failure to leave in place.
 *
 * Checks on becoming visible again and on a slow interval. Reload is the
 * user's decision: this only reports.
 */
const CHECK_INTERVAL_MS = 120_000;

async function fetchBuildId(): Promise<string | null> {
  try {
    const response = await fetch('/api/build', { cache: 'no-store' });
    if (!response.ok) return null;
    const { id } = await response.json();
    return typeof id === 'string' ? id : null;
  } catch {
    // Offline, or the server is restarting. Not stale — unknown.
    return null;
  }
}

/** Returns a disposer. `onStale` fires once, when a different build appears. */
export function watchBuild(onStale: () => void): () => void {
  let loaded: string | null = null;
  let stopped = false;

  async function check(): Promise<void> {
    if (stopped) return;
    const current = await fetchBuildId();
    if (stopped || !current) return;
    if (loaded === null) {
      // First answer establishes what this page is running. It is the served
      // build at the moment the page asked, which is the closest thing to the
      // bundle's own identity without threading a constant through the build.
      loaded = current;
      return;
    }
    if (current !== loaded) {
      stopped = true;
      onStale();
    }
  }

  void check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

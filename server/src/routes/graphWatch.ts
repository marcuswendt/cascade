/**
 * Tells Studio that a `.cascade` document changed on disk, so the graph window
 * can reload it in place instead of the whole app being reloaded.
 *
 * Its own router rather than a route inside graph.ts: the watcher is lazily
 * created on the first listener, so a headless `cascade run` never opens one,
 * and keeping it separate keeps the document routes free of watcher lifetime.
 *
 * Server-Sent Events, for the same reasons /api/nodes/events uses them: the
 * traffic is one-way and tiny, it needs no dependency, and it inherits the Host
 * and Origin boundary that already guards every project route.
 */
import { Router } from 'express';
import type { ProjectRoot } from '../project.js';
import { createGraphWatcher, type GraphWatcher } from '../graphWatch.js';

export function createGraphWatchRouter(project: ProjectRoot): Router {
  const router = Router();
  let watcher: GraphWatcher | null = null;

  router.get('/', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this a proxy can hold the stream in a buffer and deliver every
      // event at once when the request finally ends.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');

    watcher ??= createGraphWatcher(project);
    const unsubscribe = watcher.subscribe((filename) => {
      res.write(`event: graph-changed\ndata: ${JSON.stringify({ file: filename })}\n\n`);
    });

    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 30_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  return router;
}

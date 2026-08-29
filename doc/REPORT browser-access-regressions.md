# Report: three browser-facing regressions in the 0.2.0 security model

Written 2026-08-29 by the cloud-plots session, for whoever owns Cascade core. Everything below was reproduced against `665a460` / `b9610b0` with the `cloud-plots` project. Nothing here is inferred from reading alone; each item carries the command that produced it.

The common shape: **all three pass from curl and fail from a browser**, which is why the suite is green (715/715) and the app still cannot cook a node.

---

## 1. The capability endpoints are unreachable from the page that needs them

**Symptom.** Every Python-backed node fails with `Cannot acquire exec capability (403)`. Same for `/api/project/capability`.

**Cause.** `createBrowserCapabilityBoundary.guardOrigin` (`server/src/security.ts:67`) rejects any request whose `Origin` header is absent:

```ts
if (!origin || origin === 'null' || !origins.has(origin) || …) → 403
```

Browsers do not send `Origin` on a **same-origin GET**. The capability is fetched exactly that way — `fetch('/api/exec/capability', { cache: 'no-store' })` in `server/src/runtime/shell.ts:14`, `server/src/runtime/net.ts:4`, and each project's own `nodes/_shared/pyexec.ts`. So the page can never authorise itself.

**Reproduction:**

```
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3130/api/exec/capability
→ 403

curl -s -H 'Origin: http://127.0.0.1:3130' http://127.0.0.1:3130/api/exec/capability
→ 200 {"capability":"…"}
```

A fabricated Origin succeeds where a real browser fails, which is the inverse of the intent and the reason no test catches it.

**The fix is already written, forty lines above.** `createProjectRequestBoundary` (`server/src/security.ts:28`) states the correct rule in its own comment:

> Same-origin GET requests do not consistently carry Origin, so an exact Host is always required while Origin is validated whenever present.

`guardOrigin` should do the same: require the exact `Host` unconditionally, validate `Origin` only when present. The DNS-rebinding protection is carried by the Host check, not by Origin's presence.

**The capability token itself is not the weak point** — it is a per-process random 32 bytes checked with `timingSafeEqual`. Only the gate in front of its issuance is wrong.

---

## 2. Hostname access is gone, and silently

**Symptom.** After restarting on the new build, `http://kuro:3030/` fails outright — not just exec, the graph does not load.

**Two independent causes, both needing a decision:**

**(a) The listener is loopback-only.** `HOST` defaults to `127.0.0.1` (`server/src/index.ts:45`) and nothing on the CLI can change it (see item 4). The 3030 process running as I write this, started 14:47 from the previous build, binds `*:3030`; the new build does not.

**(b) A hostname `Host` header is rejected even on loopback.** `allowedAuthorities` admits only `127.0.0.1:<port>` and `localhost:<port>`.

```
PORT=3131 node server/dist/cli.js .

curl -H 'Host: KURO:3131' http://127.0.0.1:3131/api/graph   → 403
curl                      http://127.0.0.1:3131/api/graph   → 200
curl                      http://192.168.1.7:3131/api/graph → connection refused
```

**And a third thing, which is by design and should be confirmed rather than patched:** `exec`, `net` and `projectSettings` all begin with

```ts
if (!isLoopbackHost(security.host)) return router.use((_req, res) => res.status(404).end());
```

(`routes/exec.ts:28`, `routes/net.ts:12`, `routes/projectSettings.ts:9`.) So even if (a) and (b) were relaxed, server-side execution stays off for any non-loopback bind. That may be the correct posture, but it means **Cascade is now a localhost-only application**, and Marcus runs it on `kuro` and reaches it by hostname. Product decision, not a bug — put it to him.

**Whatever is decided, the failure must stop being silent.** From the browser console, a 403 on `/api/graph` and a 404 on `/api/exec` are indistinguishable from a broken build. Refusing a non-loopback Host should log a line naming the reason, at startup and on rejection.

---

## 3. `/api/panels` returns 400 whenever `shared` is a symlink

**Symptom.** `GET /api/panels` → `400` `{"error":"path escapes root through a symbolic link: shared/panels"}`. Panel discovery fails entirely, so no project panel loads.

**Cause.** `listPanels()` (`server/src/project.ts:126`) deliberately reads `shared/panels`, and `this.resolve()` routes through `resolveWithinRoot` (`server/src/pathSafety.ts:45`), which rejects any path whose canonical form leaves the project root. `cloud-plots/shared` is a symlink to `../cloud-shared` — the intended layout for the shared library, used by both `cloud-plots` and `cloud-posters`.

**Two things make it worse than it first looks:**

- The two directory reads are combined with `Promise.all`, so the shared rejection takes the **local** `panels/` directory down with it. A project with a perfectly good local panel gets no panels at all.
- `listPanelDirectory` already handles symlinked *entries* (`entry.isDirectory() || entry.isSymbolicLink()`). The guard rejects the symlinked *parent* before that code is ever reached.

**Reproduction:** any project with `shared -> ../<sibling>`.

```
curl -H 'Origin: http://127.0.0.1:3130' http://127.0.0.1:3130/api/panels
→ 400 path escapes root through a symbolic link: shared/panels
```

**Worth knowing before choosing a fix:** the *node* path already works through this same symlink, but only via a hand-written stub per node. From `cloud-plots/nodes/image-crop/index.ts`, written today:

> A stub rather than a symlink because Cascade lists node modules with readdir and a symlinked directory does not report as one.

That stub then does `export { execute } from '../../shared/nodes/image-crop'` and compiles fine — esbuild follows the symlink, the path guard never sees it. So the project already depends on traversing this symlink; only `listPanels` resolves it through the guard, and only that call fails.

Suggested direction: resolve `shared` once at startup and carry its canonical path as a second permitted root. Failing that, at minimum stop one branch's failure destroying the other.

---

## 4. `--port` and `--host` are silently ignored

`server/src/cliCommands.ts` parses no flags — `process.argv` is read once in `cli.ts:4` and passed through. `cascade . --port 3131` starts on **3030**, reporting `🚀 Cascade running on http://127.0.0.1:3030`. Only `PORT` and `WS_PORT` in the environment work.

This cost real time here: `--port 3131` silently launched a second server against the port Marcus's own session was using. Either parse the flags or reject unknown ones.

---

## What is not broken

Worth stating, so this reads as a list of specific faults rather than an alarm. The graph itself is healthy: 21 nodes and 37 connections load, icons, colour groups and the docked Graph / Viewer / Inspector / Log panels all render, the build is clean and 715 tests pass. Item 1 alone is what stops the pipeline cooking; items 2 and 3 are about reaching the app and extending it.

## Suggested order

1. **Item 1** — one condition, unblocks every Python node.
2. **Item 2** — needs Marcus's answer on localhost-only before any code changes.
3. **Item 3** — blocks the moment browser planned in `doc/PLAN project-panels-and-moment-browser.md`, which puts the panel in `shared/panels/` precisely because both projects symlink it.
4. **Item 4** — small, and a source of confusing failures.

## One test that would have caught items 1 and 3

Neither is visible to a request built by hand, because a hand-built request always carries whatever headers the author chose. A single headless page load asserting **no console error and no HTTP >= 400** is what found all three, in about a minute.

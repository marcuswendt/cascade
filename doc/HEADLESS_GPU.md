# Headless WebGPU with Dawn

The CLI can run definition-v1 nodes declaring `runsOn: 'portable'` or
`'server'` and `capabilities: ['gpu']` through optional `webgpu@0.6.0` (Dawn).
Studio uses browser WebGPU through the same device/cache lifecycle mechanism.
Browser-only declarations remain browser-only; installing Dawn does not supply
DOM, WebGL, canvas presentation, image decoding, or video APIs.

## Decision and release status

Implemented on 2026-09-08 as source version `0.3.2` and included in the 0.5
release; see the [changelog](../CHANGELOG.md). Use the project-local CLI and
record its version when comparing renders. A source checkout may contain
changes beyond the installed npm package.

The decision is to use optional native Dawn for browser-independent GPU
execution and agent image feedback. Browser automation remains useful for
Studio interaction/presentation tests; Skia remains the Canvas2D renderer.
Neither is replaced by Dawn. This first slice shares WGSL/rendering logic and
device/cache ownership without introducing a new graph texture pipeline or
requiring a browser process for production CLI rendering.

## Render for a test or agent

From a compatible project, using a Cascade build containing this feature:

```sh
npx --no-install cascade run index.cascade --frames 1 --json --timeout 60000
npx --no-install cascade run index.cascade --frames 1-24 --fps 24 --out renders --json --timeout 120000
```

`--json` requires a fully definition-v1 frame render; use `--frames 1` for a
still. Stdout contains one success manifest with absolute graph path,
project-relative image `files`, `frames`, actual `fps`, elapsed `durationMs`,
and Dawn adapter metadata when a GPU was used. Logs and failure diagnostics go
to stderr; failures exit nonzero and do not emit a success manifest. This is a
local command contract, not a chat-provider integration or an untrusted-code sandbox.

Illustrative manifest for the `cloud-volumes/dawn.cascade` fixture:

```json
{
  "status": "completed",
  "graph": "/path/to/cloud-volumes/dawn.cascade",
  "frames": [1, 2],
  "files": ["renders/dawn/volume.0001.png", "renders/dawn/volume.0002.png"],
  "aborted": false,
  "fps": 30,
  "durationMs": 115.1,
  "gpu": {
    "renderer": "dawn",
    "adapter": {
      "vendor": "apple",
      "architecture": "metal-3",
      "device": "apple-m3-max",
      "description": "Metal driver on macOS"
    }
  }
}
```

Resolve `files` relative to the directory containing `graph`. `gpu` is omitted
if no GPU node executed. `durationMs` measures the frame-rendering section and
cleanup, excluding CLI startup and module preparation; it is not GPU-pass time.

For agent callers: set a finite timeout, check the exit code, parse stdout only
on success, then attach the listed images to the conversation. Keep stderr for
diagnosis. A manifest records outputs, not a complete reproducibility bundle:
save the graph, code/assets and authored settings separately. The CLI does not
upload images or contact a model provider.

`--timeout` supervises a separate render process and returns exit 124 when its
deadline expires. On POSIX, termination covers that process group; on Windows,
the current supervisor terminates the direct child only. Interrupts are forwarded
with a short grace period before forced termination. A forced stop can leave
partial output files; consumers must check the exit code and manifest. Ordinary
successful runs destroy cached resources and release the native GPU reference.

Dawn loads lazily, only when a GPU node executes. Static `check`/`validate`
inspect the declared host contract without initializing hardware; they do not
prove that a native binary, driver, or adapter is usable. Missing native support
produces an installation diagnostic at execution. Dawn itself may be omitted
for CPU-only environments; retain the compiler's own platform dependencies.
Skia remains the independent Canvas2D path.

## Authoring contract

Use `context.capabilities.gpu.device` and `.cache(key, create, destroy)`.
Cache keys are scoped per node; destroy callbacks release textures and buffers.
The application owns the host's disposal, not an individual graph sharing it.
Use `createRenderPipelineAsync` to surface shader/pipeline validation failures.
`readTexture` captures validation failures within its own operation. Arbitrary
GPU commands issued before it need their own error scopes or async validation;
run-aware routing of all uncaptured device errors is not implemented yet.

Render into a single-sample `rgba8unorm` 2D texture with
`TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC`. Then:

```ts
import { readTexture } from 'cascade/gpu';

const pixels = await readTexture(gpu.device, target, { signal: context.signal });
// pixels: { data: Uint8Array, width, height }, tightly packed top-left RGBA8
```

Readback strips the WebGPU buffer row padding and copies bytes before unmapping.
It releases its staging buffer on success, mapping failure, or cancellation.
It does not encode PNGs or perform colour conversion. Encode through the existing
image/IO host and publish an `image` value. Graph-wide texture transport, HDR
readback, and browser video uploads are outside this first implementation.

## Verification and limits

```sh
CASCADE_TEST_DAWN=1 npx vitest run tests/dawn-native.test.ts
CASCADE_TEST_DAWN=1 npm run test:package
```

These opt-in hardware gates fail if Dawn cannot initialize. The first checks
repeated creation, rendering, padded readback and natural process exit. The
second installs a packed tarball into an empty project, renders animated PNGs
through the CLI and checks decoded pixels and the JSON manifest.
It also removes Dawn from that temporary installation to verify that a CPU
graph still runs and a GPU graph fails with an actionable missing-renderer
diagnostic. No silent CPU or browser fallback is performed.

Recorded implementation verification (2026-09-08):

- Main test suite: 1,322 passed; the opt-in hardware test was skipped there and
  passed separately with `CASCADE_TEST_DAWN=1`.
- Typechecking: zero errors, eight existing Svelte warnings.
- Contracts/runtime package checks and tests, server/Studio/CLI builds, and
  packed-package imports/types and rendering checks passed.
- The real `cloud-volumes/dawn.cascade` fixture passed static checks and wrote
  two distinct animated PNGs with an adapter-bearing JSON manifest.

These are recorded results, not a claim that every future checkout or platform
passes. Rerun the gates after changes; Windows/Linux hardware has not yet been
verified. Windows process-tree cancellation remains follow-up work.

Do not require identical pixels across GPUs/drivers. Pin reference environments,
record adapter information and use measured image tolerances. Agent callers
should set a timeout, cap dimensions/frame counts, and preserve graph/code,
assets, seed and frame settings alongside selected outputs.

Initial proof (2026-09-08): the `cloud-volumes` shader at 130 × 96, 32 steps,
with a fixed opaque 17 × 73 column and 144-byte uniform block produced zero
changed channels across 49,920 channels for both original browser canvas →
migrated browser texture and migrated browser → native Dawn. All outputs were
nonblank. Both hosts used Apple Metal (native: M3 Max). This establishes that
specific migration's parity, not universal GPU bit-exactness. The sketch's
`dawn.cascade` additionally exercises the real Aoos input, image IO and animation
through the CLI at 256 × 320.

Native packaging and GPU/driver support vary by platform. The package chooses
its default backend; Cascade does not enable unsafe Dawn toggles or silently
configure software drivers. Software Vulkan requires separate host setup.
See [Dawn Node bindings](https://github.com/dawn-gpu/node-webgpu),
[software backend setup](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md),
and [WGSL floating-point rules](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-evaluation).

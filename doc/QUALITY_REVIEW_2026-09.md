# Quality review — September 2026

This pass covers the 0.5.0 check-in and six active sketch projects.
The package is not published. No packages were published, no sites deployed, and
no paid provider requests made. Existing worktree changes were preserved.

## Architecture decisions

The standalone player uses the existing neutral runtime, contracts, camera
math and CPU scene renderer. It adds a browser host, not another graph engine
or package. Studio and the player share GPU acquisition. Each embed has an
iframe-owned runtime and IO bridge; the editor is absent from static output.

The player build rejects server capabilities and dependencies, confines local
imports and asset paths, and refuses existing output directories. Helpers and
installed dependencies remain trusted code, not sandboxed code. See
[Web player](WEB_PLAYER.md) for launch, embedding and asset rules.

Studio's compatibility engine remains in place. Replacing it wholesale is not
required to publish deterministic graphs and would enlarge this change without
improving the verified export path. No dependencies or workspaces were added.

## Repairs and simplifications

- POP checkpoints now obey the 64-entry limit for a single simulation as well
  as multiple keys. State is copied across the cache boundary; warm rendering
  reconstructs the complete trail window and matches cold rendering.
- Feedback executes nested children in their owning loop, orders inputs and
  consumers across every crossed container boundary, publishes result/history
  together, and clears transient state after failure or cancellation.
- Browser IO correctly decodes bridged images/SVG. Structural runtime abort
  signals are adapted to native browser signals before `fetch`.
- Generated player images use immutable paths, explicit byte/entry limits,
  rooted collection and URL leases. Blob URL outputs remain rooted too.
- Playback, seeks and edits share one execution queue. Seeking resets playback
  timing; failures pause and report. Setup/disposal and failed output selection
  have regression tests.
- Removed duplicated GPU-host detection and Studio-only GPU acquisition naming;
  shortened speculative cache commentary into its actual invariants.
- Cloud Volumes' series panel and sheet now use source-owned settings/overrides.
  Sheet layout and palette follow those settings; an executable Skia regression
  checks dimensions, paper pixels and instance overrides. Duplicate sheet render
  props were removed; older values must move to the source. Cloud Shared's tests
  correctly compare labeled select-option values.

## Verification

- Core: **1,604 tests passed**, one hardware-gated test skipped in the default
  suite. Contracts: 20 passed. Neutral runtime: 135 passed.
- Typechecks, server build, Studio build, CLI build and diff checks pass.
  Five existing accessibility warnings and Studio's large-chunk warning remain
  visible; the follow-up cleanup removed five unused-prop warnings.
- Packed-consumer verification exercises public imports/types, static export,
  real Chrome embeds and optional Dawn rendering. CPU-only installation and
  missing-Dawn diagnostics are checked separately.
- Real Chrome tests serve a subdirectory from an ordinary static server. They
  check independent embeds, image pixels, geometry, playback, parameter/input
  edits, downloads and disposal, with **zero Cascade API requests**.
- The fixed POP frame-64 fixture measured 2.035 ms cold versus 0.580 ms warm
  median (two warmups, seven serial samples), with equal particles and trails.
  This is a local fixture measurement, not a general frame-rate promise.
- The static geometry player measured about 45 KB gzipped; the FIELD logo
  about 49 KB. Studio's editor bundles are not included.

Do not run package builds concurrently with tests that read generated package
files: the build replaces those directories. A concurrent validation attempt
failed on missing build files; the subsequent isolated full suite passed.

## Sketch outputs

All six active projects typecheck. All nine active graphs pass static checks;
browser-host warnings are expected for browser-only definitions. Actual output
proof is separate from static validation:

| Graph | Output evidence | Input boundary |
| --- | --- | --- |
| Cascade Logo | Nonblank 1024/128/32 px PNGs; opt-in SVG | Local authored graph; SVG write enabled only in scratch copy |
| FIELD Logo | Chrome: distinct 1024 × 1024 frames 1 and 20 | Original browser definitions |
| Cloud Plots | 1050 × 1400 PNGs, 295-path SVG, numeric fields and 7,000 points | Cached photo; paid analyst disabled |
| Cloud Posters | Chrome: 3024 × 4032 composite; inspected screenshot | Original 19 browser nodes; synthetic envelope and disabled server operations |
| Cloud Volumes index | Dawn: nonblank 1098 × 1512 volume/page | Local fixture; Observatory disabled |
| Cloud Volumes measure | CPU: column, cell, volume/page | Local fixture |
| Cloud Volumes dawn | Distinct 256 × 320 frames 1–2 | Apple M3 Max / Metal 3 |
| Cloud Volumes series | Nonblank contact sheet; source density changes decoded pixels | Fixture-only series |
| Cloud Volumes spread | Nonblank 4323 × 3024 spread; numbered/cache output agree | Materialized fixture series |

These proofs do not certify live Observatory/provider integrations or
browser/Skia pixel parity. Test outputs were kept in temporary projects, not
written over authored deliverables.

## DRY follow-up

The player now shares image/SVG decoding and release handling, one MIME
classifier and one collected-error helper. URL statistics use the existing
reverse map. Removed unused Studio props and forwarding arguments; CLI run and
frame export now share their deterministic/dynamic graph-selection rule.

The unreachable WindowManager layout and its private Window, Splitter, GraphTabs
and Tabs components were deleted: 2,589 original source lines. Dockview is the
live layout host; Canvas, Viewer, Inspector, Log and CodeEditor remain. Another
213 lines of block-commented Canvas sample code were removed. Four tests for the
deleted private components were retired; the two live accessibility tests and
Dockview/history tests remain and pass.

Outside that deleted branch, the player simplifications remove 17 implementation
lines and unused Canvas/GraphPanel forwarding removes two more. These counts
exclude retired graph files, shorter comments and added regression tests.
CLI line count is unchanged but its duplicated decision rule has one owner.
Regression coverage was added for the retained behavior. No dependencies or new
framework layers were introduced. Filesystem existence helpers remain separate
because their permission-error and symlink semantics differ.

## Remaining boundaries

- Five archived Quill graphs referenced removed `cascade.quill.Chat`:
  `playground2`, `test-quill/convo1`, `test-quill/convo2`,
  `test-quill/test-quill1`, and `test8/test81`. With the author's approval they
  were retired to a recoverable Trash backup, not migrated. Quill has no remaining
  implementation or active graph dependency; rejection tests remain. Eight other
  archived documents are empty: they load but cannot produce artwork.
- The player supports definition-v1 browser/portable graphs with assets/GPU,
  not dynamic modules or server operations. Programmatic control is same-origin;
  cross-origin embedding uses ordinary iframe markup.
- Scene display is wireframe/points, not shaded GPU surfaces. GPU verification
  on one machine does not certify every browser/backend.
- Malformed intermediate series settings JSON still falls back during editing;
  the panel does not yet distinguish malformed text from an empty object.
- This is a tested, bounded quality pass, not a claim that the whole platform
  has no remaining bugs. Studio migration remains separate work; retired Quill
  examples are not a platform migration obligation.

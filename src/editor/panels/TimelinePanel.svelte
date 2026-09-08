<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import { sharedContextStore } from '../dockview/renderer';
  import { cascade } from '@/engine/cascade';
  import { Transport } from './timeline/transport';
  import { collectTracks, moveKey, type ChannelTrack } from './timeline/channels';
  import { timelineFocus } from '../stores/timelineFocus';
  import { frameAt, frameToX, frameTicks, hitTestKey, type TimelineView } from './timeline/timeline-math';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any = undefined;
  export let containerApi: any = undefined;
  export let graph: Graph | undefined = undefined;

  // Silence unused-prop warnings without dropping the panel contract.
  void panelId; void panelParams; void containerApi;

  $: if ($sharedContextStore) graph = $sharedContextStore.graph;

  const LABEL_WIDTH = 170;

  let fps = cascade.fps();
  let rangeStart = 1;
  let rangeEnd = 250;
  let loop = true;
  let frame = cascade.frame();
  let frameField = String(frame);

  const transport = new Transport({ start: rangeStart, end: rangeEnd, fps, loop }, frame);
  let playing = false;
  let dropped = 0;

  let trackWidth = 600;
  $: view = { start: rangeStart, end: rangeEnd, width: Math.max(1, trackWidth) } satisfies TimelineView;
  $: ticks = frameTicks(view);
  $: playheadX = frameToX(frame, view);

  let tracks: ChannelTrack[] = [];
  let selected: { nodeId: string; param: string; frame: number; value: number } | null = null;
  let dragging: { nodeId: string; param: string; from: number; to: number } | null = null;
  let moveUnsupported = false;

  // ---- cooking -----------------------------------------------------------
  // One cook at a time, and a frame that arrives while one is running replaces
  // the pending one rather than joining a queue. Scrubbing therefore costs at
  // most one cook per completed cook, however fast the mouse moves.
  let cooking = false;
  let pendingFrame: number | null = null;

  async function cookAt(target: number): Promise<void> {
    cascade.setFrame(target);
    cascade.markTimeDependentDirty();
    if (cooking) {
      pendingFrame = target;
      return;
    }
    cooking = true;
    try {
      await graph?.execute();
    } catch (error) {
      console.warn('[Timeline] cook failed:', error);
    } finally {
      cooking = false;
      const next = pendingFrame;
      pendingFrame = null;
      if (next !== null && next !== target) void cookAt(next);
    }
  }

  function showFrame(target: number): void {
    frame = target;
    frameField = String(target);
    void cookAt(target);
  }

  // ---- transport ---------------------------------------------------------
  let raf: number | null = null;

  function tick(now: number): void {
    const next = transport.advance(now, cooking);
    dropped = transport.dropped;
    playing = transport.playing;
    if (next !== null) showFrame(next);
    if (transport.playing) raf = requestAnimationFrame(tick);
    else raf = null;
  }

  function togglePlay(): void {
    transport.toggle(performance.now());
    playing = transport.playing;
    if (playing && raf === null) raf = requestAnimationFrame(tick);
  }

  function stop(): void {
    transport.pause();
    playing = false;
  }

  function step(delta: number): void {
    stop();
    showFrame(transport.step(delta, performance.now()));
  }

  function toStart(): void { stop(); showFrame(transport.toStart(performance.now())); }
  function toEnd(): void { stop(); showFrame(transport.toEnd(performance.now())); }

  function commitFrameField(): void {
    const parsed = Number.parseFloat(frameField);
    if (!Number.isFinite(parsed)) {
      frameField = String(frame);
      return;
    }
    stop();
    showFrame(transport.setFrame(parsed, performance.now()));
  }

  function commitRange(): void {
    if (rangeEnd < rangeStart) rangeEnd = rangeStart;
    if (fps <= 0) fps = 1;
    cascade.setFps(fps);
    transport.setRange({ start: rangeStart, end: rangeEnd, fps, loop }, performance.now());
    if (frame < rangeStart || frame > rangeEnd) showFrame(transport.setFrame(frame, performance.now()));
  }

  // ---- scrubbing ---------------------------------------------------------
  let rulerEl: HTMLDivElement | undefined;

  function frameFromEvent(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    return frameAt(event.clientX - rect.left, view);
  }

  function startScrub(event: PointerEvent): void {
    if (!rulerEl) return;
    stop();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scrubTo(event);
  }

  function scrubTo(event: PointerEvent): void {
    if (!rulerEl) return;
    const target = transport.setFrame(frameFromEvent(event, rulerEl), performance.now());
    if (target !== frame) showFrame(target);
  }

  function onRulerMove(event: PointerEvent): void {
    if (event.buttons === 0) return;
    scrubTo(event);
  }

  function endScrub(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  // ---- dope sheet --------------------------------------------------------
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function refreshTracks(): void {
    tracks = collectTracks(graph as any);
    if (selected && !tracks.some(t => t.nodeId === selected!.nodeId && t.param === selected!.param
      && t.keys.some(k => k.frame === selected!.frame))) {
      selected = null;
    }
  }

  $: graph, refreshTracks();

  /**
   * Right-clicking a parameter in the Inspector asks for its channel. Honour it
   * by refreshing first — the track very likely does not exist yet, because the
   * usual reason to ask is that you have just keyed the parameter and the
   * poll has not come round. Then select its nearest key so the frame and value
   * readout has something in it, rather than opening on an empty selection and
   * looking like nothing happened.
   */
  $: if ($timelineFocus) honourFocusRequest($timelineFocus.nodeId, $timelineFocus.param);

  function honourFocusRequest(nodeId: string, param: string): void {
    refreshTracks();
    const track = tracks.find(t => t.nodeId === nodeId && t.param === param);
    if (!track?.keys.length) {
      // Nothing keyed yet. Leave the panel open and say so rather than
      // silently selecting nothing.
      selected = null;
      focusNotice = `${nodeId}.${param} has no keys yet — alt-click the parameter to set one.`;
      return;
    }
    focusNotice = null;
    const nearest = track.keys.reduce((best, key) =>
      Math.abs(key.frame - frame) < Math.abs(best.frame - frame) ? key : best);
    selected = { nodeId, param, frame: nearest.frame, value: nearest.value };
  }

  let focusNotice: string | null = null;

  function trackKeyFrames(track: ChannelTrack): number[] {
    return track.keys.map(key => key.frame);
  }

  function keyX(track: ChannelTrack, keyFrame: number): number {
    const isDragged = dragging
      && dragging.nodeId === track.nodeId
      && dragging.param === track.param
      && dragging.from === keyFrame;
    return frameToX(isDragged ? dragging!.to : keyFrame, view);
  }

  function onTrackPointerDown(event: PointerEvent, track: ChannelTrack): void {
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const hit = hitTestKey(event.clientX - rect.left, trackKeyFrames(track), view);
    if (hit === null) {
      selected = null;
      return;
    }
    const key = track.keys.find(k => k.frame === hit);
    selected = { nodeId: track.nodeId, param: track.param, frame: hit, value: key?.value ?? 0 };
    dragging = { nodeId: track.nodeId, param: track.param, from: hit, to: hit };
    element.setPointerCapture(event.pointerId);
  }

  function onTrackPointerMove(event: PointerEvent): void {
    if (!dragging || event.buttons === 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const target = frameAt(event.clientX - rect.left, view);
    if (target !== dragging.to) dragging = { ...dragging, to: target };
  }

  function onTrackPointerUp(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (!dragging) return;
    const move = dragging;
    dragging = null;
    if (move.to === move.from) return;
    const moved = moveKey(graph as any, move.nodeId, move.param, move.from, move.to);
    if (moved) {
      selected = selected ? { ...selected, frame: move.to } : null;
      refreshTracks();
      void cookAt(frame);
    } else {
      // The channel API cannot move keys yet; say so rather than showing the
      // key at a frame it is not on.
      moveUnsupported = true;
      setTimeout(() => { moveUnsupported = false; }, 4000);
    }
  }

  onMount(() => {
    fps = cascade.fps();
    frame = cascade.frame();
    frameField = String(frame);
    transport.setFrame(frame, performance.now());
    refreshTracks();
    // No event exists for "a key was added", so the sheet polls. Walking the
    // node list is cheap; re-reading it once a second is cheaper than a stale
    // panel that looks broken after alt-clicking a parameter.
    refreshTimer = setInterval(refreshTracks, 1000);
  });

  onDestroy(() => {
    if (raf !== null) cancelAnimationFrame(raf);
    if (refreshTimer !== null) clearInterval(refreshTimer);
  });

  $: if (panelApi?.setTitle) panelApi.setTitle(playing ? `Timeline · ${frame}` : 'Timeline');
</script>

<div class="timeline-panel" data-panel-type="timeline">
  <div class="transport">
    <button class="tbtn" title="Jump to start" on:click={toStart} aria-label="Jump to start">⏮</button>
    <button class="tbtn" title="Step back" on:click={() => step(-1)} aria-label="Step back">◀</button>
    <button class="tbtn play" class:active={playing} title={playing ? 'Pause' : 'Play'} on:click={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
    <button class="tbtn" title="Step forward" on:click={() => step(1)} aria-label="Step forward">▶</button>
    <button class="tbtn" title="Jump to end" on:click={toEnd} aria-label="Jump to end">⏭</button>

    <label class="field" title="Current frame">
      <span>Frame</span>
      <input type="number" bind:value={frameField} on:change={commitFrameField}
             on:keydown={(e) => { if (e.key === 'Enter') commitFrameField(); }} aria-label="Current frame" />
    </label>

    <label class="field" title="In point">
      <span>In</span>
      <input type="number" bind:value={rangeStart} on:change={commitRange} aria-label="In point" />
    </label>
    <label class="field" title="Out point">
      <span>Out</span>
      <input type="number" bind:value={rangeEnd} on:change={commitRange} aria-label="Out point" />
    </label>
    <label class="field" title="Frames per second">
      <span>FPS</span>
      <input type="number" bind:value={fps} on:change={commitRange} aria-label="Frames per second" />
    </label>
    <label class="toggle" title="Loop playback">
      <input type="checkbox" bind:checked={loop} on:change={commitRange} />
      <span>Loop</span>
    </label>

    <div class="spacer"></div>
    {#if playing && dropped > 0}
      <span class="note" title="Frames skipped because a cook was still running">{dropped} dropped</span>
    {/if}
    {#if moveUnsupported}
      <span class="note warn">Channel API cannot move keys yet</span>
    {/if}
    {#if focusNotice}
      <span class="note">{focusNotice}</span>
    {/if}
  </div>

  <div class="ruler-row">
    <div class="gutter" style="width: {LABEL_WIDTH}px"></div>
    <div
      class="ruler"
      bind:this={rulerEl}
      bind:clientWidth={trackWidth}
      role="slider"
      tabindex="0"
      aria-label="Playhead"
      aria-valuemin={rangeStart}
      aria-valuemax={rangeEnd}
      aria-valuenow={frame}
      on:pointerdown={startScrub}
      on:pointermove={onRulerMove}
      on:pointerup={endScrub}
      on:keydown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      }}
    >
      {#each ticks as tickFrame (tickFrame)}
        <div class="tick" style="left: {frameToX(tickFrame, view)}px">
          <span class="tick-label">{tickFrame}</span>
        </div>
      {/each}
      <div class="playhead" style="left: {playheadX}px">
        <span class="playhead-label">{frame}</span>
      </div>
    </div>
  </div>

  <div class="sheet">
    {#if tracks.length === 0}
      <div class="empty">No keyed parameters. Key a parameter to see its channel here.</div>
    {:else}
      {#each tracks as track (track.nodeId + '/' + track.param)}
        <div class="track-row">
          <div class="gutter label" style="width: {LABEL_WIDTH}px" title="{track.nodePath}/{track.param}">
            <span class="node-name">{track.nodeId}</span>
            <span class="param-name">{track.param}</span>
          </div>
          <div
            class="track"
            role="group"
            aria-label="{track.nodeId} {track.param} channel"
            on:pointerdown={(e) => onTrackPointerDown(e, track)}
            on:pointermove={onTrackPointerMove}
            on:pointerup={onTrackPointerUp}
          >
            <div class="track-playhead" style="left: {playheadX}px"></div>
            {#each track.keys as key (key.frame)}
              <div
                class="key"
                class:selected={selected && selected.nodeId === track.nodeId
                  && selected.param === track.param && selected.frame === key.frame}
                style="left: {keyX(track, key.frame)}px"
                title="frame {key.frame} · {key.value}"
              ></div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="status">
    {#if selected}
      <span class="selected-key">{selected.nodeId}/{selected.param} — frame {selected.frame}, value {selected.value}</span>
    {:else}
      <span class="hint">{tracks.length} channel{tracks.length === 1 ? '' : 's'} · drag a key to move it in time</span>
    {/if}
  </div>
</div>

<style>
  .timeline-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-panel);
    color: var(--text-primary);
    font-size: 11px;
    overflow: hidden;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--surface-panel-alt);
    border-bottom: 1px solid var(--border-subtle);
    flex: 0 0 auto;
  }

  .tbtn {
    background: var(--surface-control);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    width: 24px;
    height: 22px;
    cursor: pointer;
    line-height: 1;
  }
  .tbtn:hover { background: var(--surface-control-hover); color: var(--text-bright); }
  .tbtn.play.active { background: var(--accent-tint-medium); border-color: var(--accent); color: var(--accent-light); }

  .field { display: flex; align-items: center; gap: 4px; color: var(--text-subtle); }
  .field span { text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; }
  .field input {
    width: 54px;
    background: var(--surface-input);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
  }
  .toggle { display: flex; align-items: center; gap: 4px; color: var(--text-subtle); font-size: 9px; text-transform: uppercase; }
  .spacer { flex: 1 1 auto; }
  .note { color: var(--text-faint); font-size: 10px; }
  .note.warn { color: var(--status-warn); }

  .ruler-row { display: flex; flex: 0 0 auto; border-bottom: 1px solid var(--border-subtle); }
  .gutter { flex: 0 0 auto; border-right: 1px solid var(--border-subtle); background: var(--surface-panel-alt); }

  .ruler {
    position: relative;
    flex: 1 1 auto;
    height: 22px;
    background: var(--surface-panel-alt);
    cursor: ew-resize;
    overflow: hidden;
    user-select: none;
  }
  .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--border-faint); }
  .tick-label { position: absolute; left: 3px; top: 4px; color: var(--text-faintest); font-size: 9px; }

  .playhead { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--accent); pointer-events: none; }
  .playhead-label {
    position: absolute;
    left: 1px;
    top: 2px;
    padding: 0 3px;
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: 2px;
    font-size: 9px;
  }

  .sheet { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; }
  .empty { padding: 12px; color: var(--text-faint); }

  .track-row { display: flex; height: 20px; border-bottom: 1px solid var(--border-faint); }
  .gutter.label {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    overflow: hidden;
    white-space: nowrap;
  }
  .node-name { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
  .param-name { color: var(--text-faint); }

  .track { position: relative; flex: 1 1 auto; overflow: hidden; }
  .track-playhead { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--accent-tint-half); pointer-events: none; }
  .key {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    background: var(--status-attention);
    border: 1px solid var(--shade-strong);
    transform: rotate(45deg);
    cursor: ew-resize;
  }
  .key.selected { background: var(--text-bright); border-color: var(--accent); }

  .status {
    flex: 0 0 auto;
    padding: 3px 8px;
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-panel-alt);
    color: var(--text-faint);
    font-size: 10px;
  }
  .selected-key { color: var(--text-secondary); }
</style>

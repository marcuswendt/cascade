<script lang="ts">
  import { onMount } from 'svelte';
  /**
   * Renderer and editor for `observatory.moment`.
   *
   * On an OUTPUT it shows the envelope: which moment, and every candidate frame
   * with its sky score, so the ranking the pipeline acted on is visible rather
   * than implied. On the input side it is an editor — paste an Observatory URL
   * or an id, and pick which frame the pipeline uses when the moment holds more
   * than one, which it usually does.
   *
   * Picking a frame matters more than it looks: everything downstream is
   * computed from one photo, and the automatic choice is whichever scored
   * highest for sky coverage. That is a decent default and not a judgement about
   * which picture is worth drawing.
   */
  export let value: any = null;
  export let port: any = null;
  export let readOnly = true;
  export let onChange: ((value: any) => void) | null = null;

  /** The id input this editor writes to lives on the same node — an
   *  `observatory.moment` is produced by the loader, not typed by hand, so
   *  editing means changing what the loader is pointed at. */
  export let momentIdPort: any = null;
  /** The owning node, so this can be drawn on the ID INPUT — where you would
   *  look for it — while still showing the moment the loader produced. */
  export let node: any = null;

  let draft = '';
  let selected = 0;

  /** The envelope: this port's own value when it carries one, otherwise the
   *  node's moment output. Drawn on the id input, the value here is the id
   *  string and the frames live one port over. */
  $: moment = value && typeof value === 'object' && Array.isArray(value.photos)
    ? value
    : findMoment(node, portsTick);

  /** By type first, then by shape. A node's output ports are typed only once
   *  its code has run, so early on the type isn't there to match against yet. */
  function findMoment(owner: any, _tick: number) {
    const ports = owner?.outputs ?? [];
    const typed = ports.find((p: any) => p.dataType === 'observatory.moment');
    if (typed?.value) return typed.value;
    const shaped = ports.find((p: any) => p.value && Array.isArray(p.value.photos));
    return shaped?.value ?? null;
  }

  // The moment lands on a sibling port after this component is already on
  // screen, and nothing about that is an assignment Svelte can see.
  let portsTick = 0;
  onMount(() => {
    const timer = setInterval(() => { portsTick += 1; }, 500);
    return () => clearInterval(timer);
  });

  $: photos = Array.isArray(moment?.photos) ? moment.photos : [];
  $: momentId = moment?.id ?? (typeof value === 'string' ? value : '') ?? momentIdPort?.value ?? '';
  $: if (momentId && !draft) draft = momentId;

  /**
   * Accept a whole Observatory URL as well as a bare id. A UUID pasted from the
   * address bar is what anyone actually has to hand, and asking them to cut the
   * id out of it themselves is the kind of small friction that makes a tool
   * annoying to use.
   */
  function extractId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const uuid = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0];
    // Fall back to the last path segment, so a non-UUID id still works.
    const segment = trimmed.replace(/[?#].*$/, '').split('/').filter(Boolean).pop();
    return segment || null;
  }

  function applyMoment() {
    const id = extractId(draft);
    if (!id || !onChange) return;
    onChange(id);
  }

  function thumb(path: string, width = 160): string {
    const clean = String(path).replace(/^\.?\//, '');
    return `/api/media/${clean.split('/').map(encodeURIComponent).join('/')}?w=${width}`;
  }

  function pick(index: number) {
    selected = index;
  }

  $: observatoryUrl = momentId ? `https://observatory.field.io/moments/${momentId}` : null;
</script>

<div class="moment">
  {#if onChange}
    <div class="picker">
      <input
        type="text"
        placeholder="Observatory URL or moment id"
        bind:value={draft}
        on:keydown={(e) => e.key === 'Enter' && applyMoment()}
      />
      <button on:click={applyMoment} disabled={!extractId(draft)}>Load</button>
    </div>
  {/if}

  {#if momentId}
    <div class="id">
      <span class="mono">{momentId}</span>
      {#if observatoryUrl}
        <a href={observatoryUrl} target="_blank" rel="noopener">open</a>
      {/if}
    </div>
  {/if}

  {#if photos.length}
    <div class="heading">{photos.length} {photos.length === 1 ? 'frame' : 'frames'} · ranked by sky score</div>
    <div class="frames">
      {#each photos as photo, index}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="frame"
          class:chosen={index === selected}
          title={photo.filename}
          on:click={() => pick(index)}
        >
          <img src={thumb(photo.path)} alt={photo.filename} loading="lazy" />
          <div class="score">{(photo.sky_score ?? 0).toFixed(2)}</div>
          {#if index === selected}<div class="badge">in use</div>{/if}
          <div class="dims">{photo.width}×{photo.height}</div>
        </div>
      {/each}
    </div>
  {:else if momentId}
    <div class="empty">No frames — the moment may have no photos, or the loader hasn't run.</div>
  {:else}
    <div class="empty">No moment loaded</div>
  {/if}
</div>

<style>
  .moment {
    margin-left: 13px;
    font-size: 10px;
  }

  .picker {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
  }

  .picker input {
    flex: 1;
    min-width: 0;
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 3px;
    color: #ddd;
    font-size: 10px;
    padding: 3px 5px;
  }

  .picker input:focus {
    outline: none;
    border-color: #0e639c;
  }

  .picker button {
    background: #0e639c;
    border: none;
    border-radius: 3px;
    color: #fff;
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
    flex: none;
  }

  .picker button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .id {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id a {
    color: #9cdcfe;
    text-decoration: none;
    font-size: 9px;
    flex: none;
  }

  .heading {
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b6b6b;
    margin-bottom: 4px;
  }

  .frames {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
    gap: 4px;
  }

  .frame {
    position: relative;
    border: 1px solid transparent;
    border-radius: 3px;
    overflow: hidden;
    cursor: pointer;
    background: #111;
  }

  .frame.chosen {
    border-color: #9cdcfe;
  }

  .frame img {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
  }

  .score,
  .badge,
  .dims {
    position: absolute;
    font-size: 8px;
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.65);
  }

  .score {
    top: 2px;
    left: 2px;
    color: #ddd;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .badge {
    top: 2px;
    right: 2px;
    color: #9cdcfe;
  }

  .dims {
    bottom: 2px;
    left: 2px;
    color: #999;
  }

  .empty {
    color: #777;
  }
</style>

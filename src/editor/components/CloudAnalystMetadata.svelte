<script lang="ts">
  /**
   * Renderer for `observatory.cloudanalyst.metadata`.
   *
   * The analyst's output is the one value in this pipeline that is genuinely
   * read rather than glanced at — a prose report, named shapes with fractional
   * bounding boxes, named markers, and inferred scene forces. A JSON dump would
   * technically show all of it and be useless: the report would be a single
   * unwrapped line, the coordinates would mean nothing without the frame they
   * refer to, and the sky/not-sky gate would be buried in the middle.
   *
   * So: the gate first, because it decides whether anything below it is real;
   * the report as prose; shapes and markers as named lists with their positions
   * shown as percentages, which is what a fraction of the frame actually means;
   * and the forces as labelled readings with their units.
   */
  export let value: any = null;

  $: isSky = value?.is_cloud_or_sky_photo;
  $: report = value?.report ?? '';
  $: shapes = Array.isArray(value?.shapes) ? value.shapes : [];
  $: markers = Array.isArray(value?.markers) ? value.markers : [];
  $: forces = value?.forces ?? {};

  let reportExpanded = false;

  function percent(n: unknown): string {
    return typeof n === 'number' ? `${Math.round(n * 100)}%` : '—';
  }

  function degrees(n: unknown): string {
    return typeof n === 'number' ? `${Math.round(n)}°` : '—';
  }

  function metres(n: unknown): string {
    if (typeof n !== 'number') return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.round(n)} m`;
  }

  /** A compass point reads faster than a bearing, and the bearing is kept
   *  beside it because the pipeline uses the number. */
  function compass(n: unknown): string {
    if (typeof n !== 'number') return '';
    const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return points[Math.round(((n % 360) / 22.5)) % 16];
  }
</script>

{#if !value}
  <div class="empty">Not analysed yet</div>
{:else}
  <div class="metadata">
    {#if isSky !== undefined}
      <div class="gate" class:yes={isSky} class:no={!isSky}>
        {isSky ? 'Sky photo' : 'Not a sky photo — shapes and forces suppressed'}
      </div>
    {/if}

    {#if report}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="report"
        class:clamped={!reportExpanded}
        title="Click to expand"
        on:click={() => (reportExpanded = !reportExpanded)}
      >{report}</div>
    {/if}

    {#if shapes.length}
      <div class="section">
        <div class="heading">Shapes · {shapes.length}</div>
        {#each shapes as shape}
          <div class="entry">
            <span class="label">{shape.name}</span>
            {#if Array.isArray(shape.bbox)}
              <span class="coords">
                {percent(shape.bbox[0])},{percent(shape.bbox[1])}
                → {percent(shape.bbox[2])},{percent(shape.bbox[3])}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if markers.length}
      <div class="section">
        <div class="heading">Markers · {markers.length}</div>
        {#each markers as marker}
          <div class="entry">
            <span class="label">{marker.name}</span>
            {#if Array.isArray(marker.point)}
              <span class="coords">{percent(marker.point[0])},{percent(marker.point[1])}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if forces && Object.keys(forces).length}
      <div class="section">
        <div class="heading">Forces</div>
        <div class="force">
          <span class="label">Wind</span>
          <span class="reading">{degrees(forces.wind_direction_degrees)} {compass(forces.wind_direction_degrees)}</span>
        </div>
        <div class="force">
          <span class="label">Sun</span>
          <span class="reading">{degrees(forces.sun_direction_degrees)} {compass(forces.sun_direction_degrees)}</span>
        </div>
        <div class="force">
          <span class="label">Cloud height</span>
          <span class="reading">{metres(forces.estimated_cloud_height_meters)}</span>
        </div>
        {#if forces.scene_scale_note}
          <div class="note">{forces.scene_scale_note}</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .metadata {
    margin-left: 13px;
    font-size: 10px;
  }

  .empty {
    margin-left: 13px;
    font-size: 10px;
    color: #777;
  }

  .gate {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 9px;
    margin-bottom: 6px;
  }

  .gate.yes {
    background: rgba(74, 222, 128, 0.16);
    color: #4ADE80;
  }

  .gate.no {
    background: rgba(248, 113, 113, 0.16);
    color: #F87171;
  }

  .report {
    color: #ccc;
    line-height: 1.5;
    cursor: pointer;
    margin-bottom: 8px;
  }

  .report.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .section {
    margin-bottom: 8px;
  }

  .heading {
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b6b6b;
    margin-bottom: 3px;
  }

  .entry,
  .force {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid #262626;
  }

  .entry:last-child,
  .force:last-child {
    border-bottom: none;
  }

  .label {
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .coords,
  .reading {
    color: #888;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
    flex: none;
  }

  .note {
    color: #888;
    line-height: 1.4;
    margin-top: 4px;
  }
</style>

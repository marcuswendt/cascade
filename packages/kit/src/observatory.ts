// Observatory data, as the cloud-* sketches read it.
//
// Two shapes travel between those sketches:
//   - a moment *record* (`observatory.moment` in cloud-volumes, the testbed's
//     field names): colour columns crystallised from the frames, the mean hue,
//     the seam and the perimeter facts, stored as JSON fixtures;
//   - a moment with *photos* (cloud-shared's `observatory.moment`): the archive
//     record plus downloaded photos and the one selected as the image.
// The archive itself is reached through the `observatory` CLI in a Python or
// shell stage; that stays in the project. This module is the reading and
// shaping half, with file access injected.

export type ReadBytes = (path: string) => Promise<Uint8Array>;

export interface MomentColumns {
  /** frames reduced to colour columns: one column per slice, `stops` entries each */
  slices: number;
  stops: number;
  /** [slice][stop] -> [r, g, b], 0..1 */
  columns: number[][][];
}

export interface MomentFacts {
  top: string;
  left: string;
  right: string;
  time: string;
  bottom: string;
}

export interface MomentRecord {
  id: string;
  label: string;
  columns: MomentColumns;
  meanHue: number;
  seam: number;
  facts: MomentFacts;
  [key: string]: unknown;
}

/** Parse a moment record and check it carries colour columns. */
export function parseMomentRecord(text: string, id = 'moment'): MomentRecord {
  const record = JSON.parse(text) as MomentRecord;
  if (!record.columns || !record.columns.columns) {
    throw new Error(`moment ${id} carries no colour columns`);
  }
  return record;
}

/** Read a moment fixture `<dir>/<id>.json` (default dir `assets/moments`). */
export async function readMomentRecord(read: ReadBytes, id: string, dir = 'assets/moments'): Promise<MomentRecord> {
  const bytes = await read(`${dir}/${id}.json`);
  return parseMomentRecord(new TextDecoder().decode(bytes), id);
}

// ------------------------------------------------------------------ photos

export interface ObservatoryPhoto {
  path: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

/** Cascade's core `image` descriptor, structurally (no import of cascade/contracts). */
export interface ImageDescriptor {
  path: string;
  size: [number, number];
  channels: 'rgb' | 'rgba';
  depth: 'u8';
  space: 'srgb';
}

export interface MomentSummary {
  id: string;
  instant?: string | null;
  title?: string | null;
  photoCount?: number;
  videoCount?: number;
}

export interface ObservatoryMoment {
  id: string;
  instant: string | null;
  title: string | null;
  photoCount: number;
  videoCount: number;
  photos: ObservatoryPhoto[];
  selectedImage: ImageDescriptor;
}

/** A photo as an `image` descriptor. */
export function photoImage(photo: ObservatoryPhoto): ImageDescriptor {
  return { path: photo.path, size: [photo.width, photo.height], channels: 'rgb', depth: 'u8', space: 'srgb' };
}

/** A moment with one photo selected by index or path; null when there is no such photo. */
export function selectMomentImage(summary: MomentSummary, photos: ObservatoryPhoto[], selected: number | string): ObservatoryMoment | null {
  const photo = typeof selected === 'number' ? photos[selected] : photos.find((candidate) => candidate.path === selected);
  if (!photo) return null;
  return {
    id: summary.id,
    instant: summary.instant ?? null,
    title: summary.title ?? null,
    photoCount: summary.photoCount ?? photos.length,
    videoCount: summary.videoCount ?? 0,
    photos,
    selectedImage: photoImage(photo),
  };
}

/** The selected frame, falling back to the first photo for older values. */
export function bestFrame(moment: Partial<ObservatoryMoment> | null | undefined): ImageDescriptor | null {
  if (moment?.selectedImage?.path) return moment.selectedImage;
  const first = moment?.photos?.[0];
  return first ? photoImage(first) : null;
}

// ------------------------------------------------------------------ local time

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number }

/**
 * The wall-clock parts of an ISO instant as written (`2025-12-08T09:17:17+01:00`
 * is 09:17), never through `Date`, which would read it in this process's zone.
 */
export function parseLocalTime(iso: string): LocalParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) };
}

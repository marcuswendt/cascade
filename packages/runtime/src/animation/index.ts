/**
 * Animation: keyframe channels, and frame-range evaluation over a host-bound
 * clock. Neither holds a clock of its own — the host owns time, which is what
 * keeps a cook deterministic.
 */

export {
  DEFAULT_INTERPOLATION,
  EMPTY_CHANNEL,
  createChannel,
  deleteKey,
  deserializeChannel,
  isChannel,
  isEmptyChannel,
  isInterpolation,
  keyAt,
  sampleChannel,
  serializeChannel,
  setKey,
  setKeyInterpolation
} from "./channel.js";
export type {
  Channel,
  Interpolation,
  Keyframe,
  KeyframeInput,
  SerializedChannel,
  SerializedKeyframe
} from "./channel.js";
export { frameRange, runFrameRange } from "./frameRange.js";
export type {
  FrameClock,
  FrameInfo,
  FrameRangeOptions,
  FrameRangeResult
} from "./frameRange.js";

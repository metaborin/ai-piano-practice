export const PLAYBACK_RATES = [0.5, 0.75, 1] as const
export type PlaybackRate = typeof PLAYBACK_RATES[number]

export function isPlaybackRate(value: number): value is PlaybackRate {
  return PLAYBACK_RATES.some(rate => rate === value)
}

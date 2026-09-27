/** Score content is independent of MIDI devices and UI state. */
export type ScoreSource = { id: string; title: string; partLabel: string; musicXml: string }
/** Transitional contract consumed only by the existing monophonic practice/player. */
export type PracticeNote = { readonly midiNote: number; readonly durationBeats: number }
export type PracticeScore = ScoreSource & { readonly notes: readonly PracticeNote[] }

/** Exact, JSON-safe quarter-note beat position; reduced positive denominator. */
export type BeatFraction = { readonly numerator: string; readonly denominator: string }
export type TimedEvent = {
  readonly id: string
  readonly onset: BeatFraction
  readonly onsetBeats: number
  readonly duration: BeatFraction
  readonly durationBeats: number
  readonly measureIndex: number
  readonly measureNumber: string
  readonly staff: number
  readonly voice: string
}
export type ScoreTie = { readonly source: 'tie' | 'tied'; readonly type: string; readonly number?: string; readonly timeOnly?: string }
export type ScoreNote = TimedEvent & {
  readonly midiNote: number
  readonly xmlId?: string
  readonly chord: boolean
  readonly tieStart: boolean
  readonly tieStop: boolean
  readonly ties: readonly ScoreTie[]
}
export type ScoreRest = TimedEvent & { readonly measureRest: boolean }
export type ScoreMoment = {
  readonly id: string
  readonly onset: BeatFraction
  readonly onsetBeats: number
  readonly measureIndex: number
  readonly measureNumber: string
  readonly notes: readonly ScoreNote[]
}
export type ScoreMeasure = {
  readonly index: number; readonly number: string; readonly implicit: boolean
  readonly onset: BeatFraction; readonly onsetBeats: number
  readonly duration: BeatFraction; readonly durationBeats: number
}
export type ScoreTempo = {
  readonly onset: BeatFraction; readonly onsetBeats: number; readonly bpm: number
  readonly source: 'sound' | 'metronome'; readonly measureIndex: number
}
export type PracticeCompatibility = 'simpleMelody' | 'pitchPractice' | 'polyphonicPending' | 'unsupported'
export type ScoreWarning = { readonly code: string; readonly message: string }
/** Normalized timeline. No MusicXML DOM or OSMD objects escape the parser. */
export type ScoreModel = ScoreSource & {
  readonly partId: string
  readonly notes: readonly ScoreNote[]
  readonly rests: readonly ScoreRest[]
  readonly moments: readonly ScoreMoment[]
  readonly measures: readonly ScoreMeasure[]
  readonly totalDuration: BeatFraction
  readonly totalBeats: number
  readonly staffCount: number
  readonly voices: readonly string[]
  readonly tempoBpm?: number
  readonly tempos: readonly ScoreTempo[]
  readonly warnings: readonly ScoreWarning[]
  readonly practiceCompatibility: PracticeCompatibility
  readonly practiceReasons: readonly string[]
}

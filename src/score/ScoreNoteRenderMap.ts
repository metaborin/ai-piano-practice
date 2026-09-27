import type { OpenSheetMusicDisplay, VexFlowGraphicalNote } from 'opensheetmusicdisplay'
import type { ScoreModel } from './ScoreModel'
import { Beat } from './Beat'
import type { PracticePlan } from '../practice/PracticePlan'
import type { PracticeSnapshot } from '../practice/PracticeSession'

export function missingSourceNoteIds(plan: PracticePlan | null, feedback: PracticeSnapshot['matchFeedback']): readonly string[] {
  if (!plan || feedback?.status !== 'incorrect') return []
  return plan.targets[feedback.targetIndex]?.sourceNotes.filter((note) => !note.tieStop && feedback.missingMidiNotes.includes(note.midiNote)).map((note) => note.id) ?? []
}

/** Stable musical correspondence, followed by OSMD's own per-note SVG API.
 * All voices of a selected staff participate; unison source notes may share a head.
 */
export class ScoreNoteRenderMap {
  private readonly notes = new Map<string, readonly HTMLElement[]>()
  private colored = new Map<HTMLElement | SVGElement, string | null>()
  constructor(model: ScoreModel, display: OpenSheetMusicDisplay, octaveDifference: number) {
    const rendered = new Map<string, Set<HTMLElement>>()
    const byPitch = new Map<string, Set<HTMLElement>>()
    const sourcePitchCounts = new Map<string, number>()
    const pitchKey = (beat: string, midi: number) => `${beat}:${midi}`
    for (const note of model.notes) {
      const id = pitchKey(Beat.from(note.onset).key, note.midiNote)
      sourcePitchCounts.set(id, (sourcePitchCounts.get(id) ?? 0) + 1)
    }
    const key = (beat: string, staff: number, midi: number) => `${beat}:${staff}:${midi}`
    const cursor = display.cursor
    cursor.reset()
    try {
      let steps = 0
      while (!cursor.Iterator.EndReached) {
        if (++steps > 5000) throw new Error('Note map traversal limit')
        const measure = model.measures[cursor.Iterator.CurrentMeasureIndex]
        if (measure) for (const note of cursor.NotesUnderCursor()) {
          if (note.isRest() || !note.Pitch) continue
          const relative = note.ParentVoiceEntry.Timestamp
          const beat = Beat.from(measure.onset).add(new Beat(BigInt(relative.GetExpandedNumerator()) * 4n, BigInt(relative.Denominator)))
          const pitch = note.Pitch, midi = 12 * (pitch.Octave + octaveDifference + 1) + pitch.FundamentalNote + pitch.AccidentalHalfTones
          const graphical = display.EngravingRules.GNote(note) as VexFlowGraphicalNote | undefined
          // OSMD returns the whole chord. Its GraphicalNote carries the renderer's
          // pitch index (setIndex), so use that musical index, never a DOM sibling index.
          const head = graphical?.getNoteheadSVGs()[graphical.vfnoteIndex]
          const heads = head ? [head] : []
          const id = key(beat.key, note.ParentStaff.Id, midi), elements = rendered.get(id) ?? new Set<HTMLElement>()
          for (const element of heads) elements.add(element)
          rendered.set(id, elements)
          const atPitch = pitchKey(beat.key, midi), candidates = byPitch.get(atPitch) ?? new Set<HTMLElement>()
          for (const element of heads) candidates.add(element)
          byPitch.set(atPitch, candidates)
        }
        cursor.next()
      }
      for (const note of model.notes.filter((note) => !note.tieStop)) {
        const beat = Beat.from(note.onset).key, atPitch = pitchKey(beat, note.midiNote)
        let match = rendered.get(key(beat, note.staff, note.midiNote))
        // Existing imports can omit <staves> despite a <staff> marker; OSMD
        // normalizes those onto one staff. Accept only a unique onset/pitch pair.
        if (!match?.size && sourcePitchCounts.get(atPitch) === 1 && byPitch.get(atPitch)?.size === 1) match = byPitch.get(atPitch)
        const elements = [...(match ?? [])]
        if (!elements.length) throw new Error(`No rendered note for ${note.id}`)
        this.notes.set(note.id, elements)
        for (const element of elements) {
          element.dataset.scoreNotes = [...new Set([...(element.dataset.scoreNotes?.split(' ') ?? []), note.id])].join(' ')
          element.dataset.midiPitch = String(note.midiNote)
          element.dataset.scoreStaff = String(note.staff)
        }
      }
    } finally { cursor.reset() }
  }
  clear() {
    for (const [element, style] of this.colored) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
      delete element.dataset.missingNote
    }
    this.colored.clear()
  }
  highlight(ids: readonly string[]) {
    this.clear()
    for (const id of ids) for (const element of this.notes.get(id) ?? []) {
      // VexFlow's glyph paths set their own fill, overriding the parent group.
      // Color only paths belonging to this mapped notehead, and restore exact styles.
      for (const glyph of [element, ...element.querySelectorAll<SVGElement>('path')]) {
        if (!this.colored.has(glyph)) this.colored.set(glyph, glyph.getAttribute('style'))
        glyph.style.fill = '#c62828'; glyph.style.stroke = '#c62828'
      }
      element.dataset.missingNote = 'true'
    }
  }
}

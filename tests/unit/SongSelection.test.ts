import { expect, it, vi } from 'vitest'
import { SongSelection } from '../../src/score/SongSelection'
import { songs } from '../../src/score/songCatalog'
import { PracticeSession } from '../../src/practice/PracticeSession'
import type { ScoreModel } from '../../src/score/ScoreModel'

function deferred() {
  let resolve!: (xml: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const loads = [deferred(), deferred(), deferred()]
  const practice = new PracticeSession([{ midiNote: 60, durationBeats: 1 }])
  const reset = vi.fn(() => practice.loadScore(null))
  const apply = vi.fn(practice.loadScore)
  const selection = new SongSelection(songs[0], { reset, apply, obtain: (song) => loads[songs.indexOf(song)].promise })
  const model = (id: number): ScoreModel => ({
    id: songs[id].id, title: songs[id].title, partLabel: songs[id].partLabel,
    musicXml: 'xml-' + id, notes: [{ midiNote: 67, durationBeats: 2 }],
  })
  return { loads, practice, reset, apply, selection, model }
}

it('last selection wins even when earlier acquisition, rendering and errors arrive after it', async () => {
  const { loads, selection, apply, model } = setup()
  const a = selection.select(songs[0])
  const aId = selection.getSnapshot().requestId
  const b = selection.select(songs[1])
  const bId = selection.getSnapshot().requestId
  const c = selection.select(songs[2])
  const cId = selection.getSnapshot().requestId
  loads[2].resolve('xml-2'); await c
  selection.ready(cId, model(2))
  loads[0].resolve('xml-0'); await a
  loads[1].reject(new Error('offline')); await b
  selection.ready(aId, model(0))
  selection.fail(bId, 'old rendering failure')
  expect(selection.getSnapshot()).toMatchObject({ song: songs[2], status: 'ready', source: { id: songs[2].id }, error: null })
  expect(apply).toHaveBeenCalledExactlyOnceWith(model(2))
})

it('clears practice synchronously, ignores input during load, and enables only a matching rendered model', async () => {
  const { selection, loads, practice, apply, model } = setup()
  practice.start()
  const pending = selection.select(songs[2])
  const id = selection.getSnapshot().requestId
  expect(practice.getSnapshot()).toMatchObject({ status: 'idle', totalNotes: 0, expectedMidiNote: null, correctNoteCount: 0 })
  practice.start()
  practice.handleMidiEvent({ type: 'noteon', midiNote: 60, velocity: 80, channel: 1, timestamp: 1 })
  expect(practice.getSnapshot().correctNoteCount).toBe(0)
  loads[2].resolve('xml-2'); await pending
  expect(selection.getSnapshot().status).toBe('loading')
  expect(apply).not.toHaveBeenCalled()
  selection.ready(id, model(2))
  expect(practice.getSnapshot()).toMatchObject({ status: 'idle', expectedMidiNote: 67, totalNotes: 1 })
})

it('rejects mismatched/empty models and recovers from acquisition failure by selecting another song', async () => {
  const { selection, loads, practice, model } = setup()
  const failed = selection.select(songs[0])
  loads[0].reject(new Error('offline')); await failed
  expect(selection.getSnapshot()).toMatchObject({ status: 'error', source: null })
  const pending = selection.select(songs[1])
  loads[1].resolve('xml-1'); await pending
  selection.ready(selection.getSnapshot().requestId, model(0))
  expect(selection.getSnapshot().status).toBe('error')
  await selection.select(songs[1])
  selection.ready(selection.getSnapshot().requestId, { ...model(1), notes: [] })
  expect(practice.getSnapshot().totalNotes).toBe(0)
  const recovery = selection.select(songs[2])
  loads[2].resolve('xml-2'); await recovery
  selection.ready(selection.getSnapshot().requestId, model(2))
  expect(selection.getSnapshot().status).toBe('ready')
})

it('cancellation invalidates delayed acquisition and OSMD completion', async () => {
  const { selection, loads, apply, model } = setup()
  const pending = selection.select(songs[0])
  const id = selection.getSnapshot().requestId
  selection.cancel()
  loads[0].resolve('xml-0'); await pending
  selection.ready(id, model(0))
  expect(apply).not.toHaveBeenCalled()
  expect(selection.getSnapshot().source).toBeNull()
})

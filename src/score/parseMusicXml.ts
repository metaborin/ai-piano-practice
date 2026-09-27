import { Beat } from './Beat'
import { soundSpans } from './soundSpans'
import { child, children, descendants, readMusicXmlDocument, value } from './musicXmlDocument'
import type { ScoreMeasure, ScoreModel, ScoreMoment, ScoreNote, ScoreRest, ScoreSource, ScoreTempo, ScoreTie, ScoreWarning } from './ScoreModel'

export const MAX_SCORE_NOTES = 1000
export const MAX_SCORE_MEASURES = 500
export class UnsupportedMusicXmlError extends Error {}
const unsupported = (message: string): never => { throw new UnsupportedMusicXmlError('この楽譜の解析は未対応です：' + message) }
const invalid = (message: string): never => { throw new Error('楽譜を解析できませんでした：' + message) }
function positive(text: string, label: string) {
  let beat: Beat
  try { beat = Beat.decimal(text) } catch { return invalid(label + 'の数値が不正です。') }
  if (beat.n <= 0n) return invalid(label + 'は正数である必要があります。')
  return beat
}
function staffNumber(text: string) {
  if (!/^\d+$/.test(text) || Number(text) < 1) return invalid('Staff番号が不正です。')
  if (Number(text) > 2) return unsupported('3以上のStaff')
  return Number(text)
}
function pitchToMidi(note: Element) {
  const pitch = child(note, 'pitch')
  if (!pitch) return invalid('音符にpitchがありません。')
  const offsets: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const step = value(pitch, 'step'), octaveText = value(pitch, 'octave')
  const alterText = value(pitch, 'alter') || '0'
  if (!(step in offsets) || !/^-?\d+$/.test(octaveText) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(alterText)) return invalid('音高のstep・alter・octaveが不正です。')
  const alter = Number(alterText)
  if (!Number.isInteger(alter)) return unsupported('微分音のMIDI変換')
  const midi = (Number(octaveText) + 1) * 12 + offsets[step] + alter
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return invalid('MIDI音高が0〜127の範囲外です。')
  return midi
}

/** Read written score order, normalizing XML cursor moves into exact absolute beat positions. */
export function parseMusicXml(source: ScoreSource, document?: Document): ScoreModel {
  const doc = document ?? readMusicXmlDocument(source.musicXml)
  if (doc.documentElement.localName !== 'score-partwise') return unsupported('score-timewise形式')
  const parts = children(doc.documentElement, 'part')
  if (parts.length !== 1) return unsupported('複数パート')
  const part = parts[0], measuresXml = children(part, 'measure')
  if (!measuresXml.length) return invalid('measureがありません。')
  if (descendants(part, 'note').length > MAX_SCORE_NOTES || measuresXml.length > MAX_SCORE_MEASURES) return unsupported('表示上限（1000音・500小節）を超える楽譜')
  const blocked: [string, string][] = [
    ['grace', '装飾音'], ['cue', '小音符'], ['unpitched', '打楽器音'], ['transpose', '移調楽器'],
    ['octave-shift', 'オクターブ移動'], ['image', '画像・外部参照'], ['credit-image', '画像・外部参照'],
    ['part-link', '画像・外部参照'], ['link', '画像・外部参照'],
  ]
  for (const [name, message] of blocked) if (descendants(doc, name).length) return unsupported(message)
  if (/<!ENTITY\s/i.test(source.musicXml)) return unsupported('XMLエンティティ定義')
  if (descendants(part, 'sign').some((node) => ['percussion', 'TAB'].includes(node.textContent?.trim() ?? ''))) return unsupported('打楽器譜・タブ譜')
  const notes: ScoreNote[] = [], rests: ScoreRest[] = [], measures: ScoreMeasure[] = [], tempos: ScoreTempo[] = []
  const warnings: ScoreWarning[] = []
  const warn = (code: string, message: string) => { if (!warnings.some((warning) => warning.code === code)) warnings.push({ code, message }) }
  const pending = new Set<string>(), practiceUnsupported = new Set<string>(), voices = new Set<string>()
  for (const [name, message] of [['pedal', 'ペダルの演奏解釈'], ['arpeggiate', 'アルペジオの演奏順'], ['ornaments', '装飾記号の演奏解釈']] as const) {
    // Preserve annotations in the source. Pedal remains warning-only; gestures
    // requiring different attacks must not be treated as ordinary pitch practice.
    if (descendants(doc, name).length) warn(name, message + 'は未対応です。記譜された音と時間だけを保持します。')
    if (name !== 'pedal' && descendants(doc, name).length) practiceUnsupported.add(message)
  }
  if (descendants(doc, 'tremolo').length) { warn('tremolo', 'トレモロの発音展開は未対応です。'); practiceUnsupported.add('トレモロ') }
  if (['repeat', 'ending', 'segno', 'coda', 'measure-repeat'].some((name) => descendants(doc, name).length) || descendants(doc, 'sound').some((node) => ['dacapo', 'dalsegno', 'tocoda', 'fine', 'forward-repeat'].some((name) => node.hasAttribute(name)))) {
    warn('repeat', '反復・演奏順の展開は未対応です。記載順の時間軸を保持します。'); practiceUnsupported.add('反復・演奏順の指定')
  }
  if (descendants(doc, 'time-modification').length) { warn('tuplet', '連符はduration/divisionsで時間を保持します。今回の練習・手本は未対応です。'); practiceUnsupported.add('連符') }
  let divisions: Beat | null = null, measureStart = Beat.zero(), staffCount = 1
  for (const [measureIndex, measure] of measuresXml.entries()) {
    const measureNumber = measure.getAttribute('number') || String(measureIndex + 1)
    let position = Beat.zero(), end = Beat.zero(), noteIndex = 0
    let anchor: { onset: Beat; duration: Beat; voice: string } | null = null
    const trackEnd = (candidate: Beat) => { if (candidate.compare(end) > 0) end = candidate }
    const durationOf = (node: Element) => {
      if (!divisions) return invalid('最初の音の前にdivisionsが必要です。')
      return positive(value(node, 'duration'), 'duration').divide(divisions)
    }
    const tempoAt = (node: Element) => {
      const sound = node.localName === 'sound' ? node : child(node, 'sound')
      const metronome = descendants(node, 'metronome')[0]
      let bpm: number | undefined, from: 'sound' | 'metronome' = 'sound'
      if (sound?.hasAttribute('tempo')) {
        const numeric = Number(sound.getAttribute('tempo'))
        if (Number.isFinite(numeric) && numeric > 0) bpm = numeric
        else warn('tempo', 'soundの数値テンポが不正です。有効なメトロノーム指定がなければ代替テンポを使用します。')
      }
      if (bpm === undefined && metronome) {
        const units: Record<string, number> = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 }
        const unit = units[value(metronome, 'beat-unit')]
        const dots = children(metronome, 'beat-unit-dot').length
        const rate = value(metronome, 'per-minute')
        if (!unit || !/^\d+(\.\d+)?$/.test(rate) || children(metronome, 'beat-unit').length !== 1) { warn('tempo', 'このメトロノーム表記は数値テンポへ変換していません。'); return }
        bpm = Number(rate) * unit * (2 - 2 ** -dots); from = 'metronome'
      }
      if (bpm === undefined) return
      if (!Number.isFinite(bpm) || bpm <= 0) { warn('tempo', '数値テンポが未指定または不正です。'); return }
      const offset = (sound && child(sound, 'offset')) ?? child(node, 'offset')
      let onset = measureStart.add(position)
      if (offset && offset.getAttribute('sound') !== 'no') {
        if (!divisions) return invalid('tempo offsetの前にdivisionsが必要です。')
        try { onset = onset.add(Beat.decimal(offset.textContent?.trim() ?? '').divide(divisions)) }
        catch { return invalid('tempo offsetが不正です。') }
      }
      if (onset.n < 0n) { warn('tempo-offset', '曲の先頭より前のテンポ指定を適用していません。'); return }
      tempos.push({ onset: onset.toJSON(), onsetBeats: onset.beats, bpm, source: from, measureIndex })
    }
    for (const element of children(measure)) {
      if (element.localName === 'attributes') {
        const newDivisions = value(element, 'divisions')
        if (newDivisions) {
          const next = positive(newDivisions, 'divisions')
          if (end.n !== 0n && (!divisions || next.compare(divisions) !== 0)) return unsupported('小節途中のdivisions変更')
          divisions = next
        }
        if (value(element, 'staves')) staffCount = Math.max(staffCount, staffNumber(value(element, 'staves')))
        continue
      }
      if (element.localName === 'direction' || element.localName === 'sound') { tempoAt(element); continue }
      if (element.localName === 'backup' || element.localName === 'forward') {
        const duration = durationOf(element)
        position = element.localName === 'backup' ? position.subtract(duration) : position.add(duration)
        if (position.n < 0n) return invalid('backupが小節の先頭より前へ戻っています。')
        trackEnd(position); anchor = null; pending.add('backup / forward')
        continue
      }
      if (element.localName !== 'note') continue
      const duration = durationOf(element), isChord = !!child(element, 'chord'), isRest = !!child(element, 'rest')
      const voice: string = value(element, 'voice') || (isChord ? anchor?.voice : undefined) || '1'
      const staff = staffNumber(value(element, 'staff') || '1')
      voices.add(voice); staffCount = Math.max(staffCount, staff)
      if (isChord && (!anchor || isRest || voice !== anchor.voice)) return invalid('chord（和音）の直前に同じVoiceの基準音がありません。')
      if (isChord && anchor && duration.compare(anchor.duration) > 0) return invalid('chordの音価が基準音より長くなっています。')
      const localOnset: Beat = isChord && anchor ? anchor.onset : position
      const onset = measureStart.add(localOnset)
      const event = { id: `${part.getAttribute('id') || 'P1'}:m${measureIndex}:n${noteIndex++}`, onset: onset.toJSON(), onsetBeats: onset.beats,
        duration: duration.toJSON(), durationBeats: duration.beats, measureIndex, measureNumber, staff, voice }
      if (isRest) {
        if (child(element, 'pitch')) return invalid('同じ音符にrestとpitchが混在しています。')
        rests.push({ ...event, measureRest: child(element, 'rest')?.getAttribute('measure') === 'yes' }); pending.add('休符'); anchor = null
      }
      else {
        const ties: ScoreTie[] = [...children(element, 'tie'), ...descendants(element, 'tied')].map((tie) => ({ source: tie.localName as 'tie' | 'tied', type: tie.getAttribute('type') || '', number: tie.getAttribute('number') || undefined, timeOnly: tie.getAttribute('time-only') || undefined }))
        const tieStart = ties.some((tie) => tie.type === 'start' || tie.type === 'continue')
        const tieStop = ties.some((tie) => tie.type === 'stop' || tie.type === 'continue')
        if (ties.length) pending.add('タイ')
        notes.push({ ...event, midiNote: pitchToMidi(element), xmlId: element.getAttribute('id') || undefined, chord: isChord, tieStart, tieStop, ties })
        if (!isChord) anchor = { onset: localOnset, duration, voice }
        if (isChord) pending.add('和音')
      }
      trackEnd(localOnset.add(duration))
      if (!isChord) position = position.add(duration)
    }
    // Use the longest voice/rest/forward extent, never the last serialized voice cursor.
    // Actual encoded span also preserves pickups and incomplete final measures; no invented rests.
    if (end.n === 0n) return invalid('時間情報のない小節です。練習対象の音がありません。')
    measures.push({ index: measureIndex, number: measureNumber, implicit: measure.getAttribute('implicit') === 'yes', onset: measureStart.toJSON(), onsetBeats: measureStart.beats, duration: end.toJSON(), durationBeats: end.beats })
    measureStart = measureStart.add(end)
  }
  const compare = (a: { onset: import('./ScoreModel').BeatFraction }, b: { onset: import('./ScoreModel').BeatFraction }) => Beat.from(a.onset).compare(Beat.from(b.onset))
  notes.sort(compare); rests.sort(compare); tempos.sort(compare)
  const grouped = new Map<string, ScoreNote[]>()
  for (const note of notes) {
    const key = Beat.from(note.onset).key
    const group = grouped.get(key) ?? []
    group.push(note); grouped.set(key, group)
  }
  const moments: ScoreMoment[] = [...grouped.entries()].map(([key, group]) => ({ id: 'moment:' + key, onset: group[0].onset, onsetBeats: group[0].onsetBeats, measureIndex: group[0].measureIndex, measureNumber: group[0].measureNumber, notes: group }))
  if (staffCount > 1) pending.add('複数Staff')
  if (voices.size > 1) pending.add('複数声部')
  if (moments.some((moment) => moment.notes.length > 1)) pending.add('同時発音')
  if (!notes.length) pending.add('打鍵対象なし（休符のみ）')
  let expected = Beat.zero()
  for (const moment of moments) {
    if (Beat.from(moment.onset).compare(expected) !== 0) pending.add('音の間隔・重なり')
    expected = Beat.from(moment.onset).add(Beat.from(moment.notes[0].duration))
  }
  if (expected.compare(measureStart) !== 0) pending.add('休止時間')
  if (moments.some((moment) => {
    const voiceStaff = new Map<string, Set<number>>()
    for (const note of moment.notes) { const staves = voiceStaff.get(note.voice) ?? new Set<number>(); staves.add(note.staff); voiceStaff.set(note.voice, staves) }
    return [...voiceStaff.values()].some((staves) => staves.size > 1)
  })) practiceUnsupported.add('同時刻の同一Voiceが複数Staffをまたぐ記譜')
  try { soundSpans(notes) } catch (error) { const message = error instanceof Error ? error.message : '発音の対応'; practiceUnsupported.add(message); warn('performance', message + 'は未対応です。') }
  const initialTempo = tempos.filter((tempo) => Beat.from(tempo.onset).n === 0n).at(-1)?.bpm
  return { ...source, partId: part.getAttribute('id') || 'P1', notes, rests, moments, measures, totalDuration: measureStart.toJSON(), totalBeats: measureStart.beats, staffCount, voices: [...voices], tempoBpm: initialTempo, tempos, warnings,
    practiceCompatibility: practiceUnsupported.size ? 'unsupported' : pending.size ? 'pitchPractice' : 'simpleMelody', practiceReasons: [...practiceUnsupported] }
}

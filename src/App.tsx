import { useDemoPlayer } from './audio/useDemoPlayer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScoreSystems } from './score/ScoreLookAhead'
import type { Song } from './songs/Song'
import { PracticeFeedback } from './components/PracticeFeedback'
import { missingSourceNoteIds } from './score/ScoreNoteRenderMap'
import type { DemoChoice } from './components/DemoControls'
import { DemoControls } from './components/DemoControls'
import { DeveloperControls } from './components/DeveloperControls'
import { MidiDebugPanel } from './components/MidiDebugPanel'
import { MidiStatus } from './components/MidiStatus'
import { MidiOutputPanel } from './components/MidiOutputPanel'
import { PracticeControls } from './components/PracticeControls'
import { PracticeStartControls } from './components/PracticeStartControls'
import { ScoreView } from './components/ScoreView'
import { SongLibrary } from './components/SongLibrary'
import { useMidi } from './midi/useMidi'
import { usePracticeSession } from './practice/usePracticeSession'
import { DEFAULT_SONG_ID, songRepository } from './songs/libraryRepository'
import { useSongLibrary } from './songs/useSongLibrary'
import { useSongSelection } from './score/useSongSelection'
import { MODE_LABELS } from './practice/PracticePlan'
import type { PracticeMode } from './practice/PracticePlan'
import './App.css'

export default function App() {
  const { midi, connect, selectInput, events, output, outputManager, selectOutput, playTestNote, stopAllNotes, retryOutput } = useMidi()
  const { session, practice, start, restart, moveCursor } = usePracticeSession(events)
  const { demo, player } = useDemoPlayer(outputManager, session)
  const { selection, songState } = useSongSelection(session, player, outputManager)
  const [systems, setSystems] = useState<{ requestId: number; map: ScoreSystems } | null>(null)
  const acceptSystems = useCallback((requestId: number, map: ScoreSystems) => setSystems({ requestId, map }), [])
  useEffect(() => {
    player.setSystems(systems?.requestId === songState.requestId && songState.status === 'ready' ? systems.map : null)
  }, [player, systems, songState.requestId, songState.status, songState.plan])
  const [focusRequest, setFocusRequest] = useState(0)
  const focusCursor = () => setFocusRequest((value) => value + 1)
  const [returnRequest, setReturnRequest] = useState(0)
  const returnToCursor = () => { focusCursor(); setReturnRequest(value => value + 1) }
  const selectSong = (song: Song) => { focusCursor(); return selection.select(song) }
  const { library, retry, addSong, deleteSong } = useSongLibrary(songRepository, selection.select, DEFAULT_SONG_ID)
  const removeSong = async (id: string) => {
    if (songState.song?.id === id) {
      const fallback = library.songs.find((song) => song.id === DEFAULT_SONG_ID)
      if (fallback) void selectSong(fallback)
    }
    await deleteSong(id)
  }
  const title = songState.song?.title ?? 'AIピアノ練習アプリ'
  const scoreReady = songState.status === 'ready' && songState.canPractice
  const showDemoCursor = demo.status === 'playing'
  const cursorIndex = showDemoCursor ? demo.currentNoteIndex : practice.currentNoteIndex
  const cursorOccurrence = songState.plan?.sequence.occurrences[cursorIndex]
  const noteCount = practice.totalNotes
  const practiceBlocked = !scoreReady || practice.startTargetIndex === null || demo.status === 'playing' || output.playing
  const cursorMomentId = showDemoCursor ? demo.cursorMomentId : practice.startTargetIndex === null ? null : cursorOccurrence?.sourceMoment.id ?? null
  const currentMoment = showDemoCursor ? songState.model?.moments.find(moment => moment.id === cursorMomentId) : cursorOccurrence?.sourceMoment
  const currentMeasure = currentMoment?.measureNumber
  const currentRepeat = currentMoment && songState.model?.navigation.repeats.find(region => currentMoment.measureIndex >= region.startMeasureIndex && currentMoment.measureIndex <= region.endMeasureIndex)
  const repeatPass = currentRepeat ? cursorOccurrence?.repeatRegionId === currentRepeat.id ? cursorOccurrence.repeatPass : 1 : undefined
  const positionUnit = songState.model?.practiceCompatibility === 'simpleMelody' ? '音' : 'ステップ'
  const startPractice = () => { if (!practiceBlocked) { focusCursor(); player.resetDisplay(); start() } }
  const restartPractice = () => { if (!practiceBlocked) { focusCursor(); player.resetDisplay(); restart() } }
  const missingNoteIds = useMemo(() => missingSourceNoteIds(songState.plan, practice.matchFeedback), [songState.plan, practice.matchFeedback])
  const playDemo = (choice: DemoChoice) => {
    if (!scoreReady) return
    if (choice === 'current') {
      const position = session.getSnapshot()
      player.start({ kind: 'current', occurrenceIndex: position.startTargetIndex === null ? null : position.currentNoteIndex, completed: position.status === 'completed' })
    } else player.start(choice === 'beginning' ? { kind: 'beginning' } : { kind: 'measure', measureIndex: Number(choice.slice(8)) })
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">ピアノ練習 · Phase 2E-D3.3.2</p>
          <h1>{title}</h1>
          <p className="subtitle">{songState.song?.partLabel ?? '曲を選んで練習しましょう'}</p>
        </div>
        <MidiStatus status={midi.status} />
      </header>
      <SongLibrary library={library} selectedId={songState.song?.id ?? ''} onSelect={selectSong} onRetry={retry} onAdd={addSong} onDelete={removeSong} />
      {songState.model?.staffCount === 2 && <section className="practice-mode" aria-label="練習するパート">
        <h2>練習するパート</h2>
        <div className="mode-buttons">{(['right', 'left', 'both'] as PracticeMode[]).map((mode) => <button key={mode} aria-pressed={songState.mode === mode} onClick={() => { focusCursor(); selection.setMode(mode, practice.currentNoteIndex) }}>{MODE_LABELS[mode]}</button>)}</div>
      </section>}
      <PracticeStartControls plan={songState.plan} requested={songState.practiceStart}
        onChange={start => { focusCursor(); selection.setPracticeStart(start) }} />
      <section className="score-card" aria-label={songState.song ? title + 'の楽譜' : '楽譜'} aria-busy={!scoreReady && songState.status === 'loading'}>
        <div className="score-status"><div className="score-heading">
          {songState.model && !songState.canPractice ? <span>楽譜表示</span> : <span className="cursor-legend"><span aria-hidden="true" />緑の帯が現在位置</span>}
          <button className="return-to-cursor" disabled={!scoreReady || !cursorMomentId} onClick={returnToCursor}>現在位置へ戻る</button>
          <div className="score-position" aria-live="polite">
            {scoreReady && cursorMomentId && currentMeasure !== undefined && <span className="current-measure">{currentMeasure}小節目</span>}
            {scoreReady && !!songState.model?.navigation.repeats.length && <span className="repeat-position-slot">
              {cursorMomentId && repeatPass ? <span className="repeat-position">反復 {repeatPass}回目</span> : '\u00a0'}
            </span>}
            <span className="position">{scoreReady && cursorMomentId && noteCount > 0 ? `${cursorIndex + 1} / ${noteCount} ${positionUnit}` : '— / — 音'}</span>
          </div>
        </div>
        {songState.startPosition?.message && <p className="practice-start-message" role="status">{songState.startPosition.message}</p>}
        <PracticeFeedback practice={practice} midiConnected={midi.status === 'connected'} />
        </div>
        {songState.status === 'loading' && <p className="score-message" role="status">楽譜を読み込み中…</p>}
        {songState.error && <p className="error-message" role="alert">{songState.error}</p>}
        {songState.status === 'ready' && !songState.canPractice && <p className="score-message" role="status">{songState.plan
          ? '選択したパートには、新しく押す音がありません。別のパートを選んでください。'
          : 'この曲は表示できますが、現在の練習・手本演奏には未対応です。'}<br />{songState.model?.practiceReasons.join('、')}</p>}
        {songState.source && <ScoreView key={songState.requestId} requestId={songState.requestId} score={songState.source} cursorIndex={cursorIndex} cursorMomentId={cursorMomentId} missingNoteIds={missingNoteIds} followMode={showDemoCursor ? 'demo' : practice.status === 'idle' ? 'idle' : 'practice'} focusRequest={focusRequest} returnRequest={returnRequest} plan={songState.plan} demoPreview={showDemoCursor ? demo.preview : null} onSystems={acceptSystems} onReady={selection.ready} onError={selection.fail} />}
      </section>
      <DemoControls key={`${songState.requestId}:${songState.mode}`} demo={demo} plan={songState.plan} outputReady={scoreReady && output.status === 'connected'} outputBusy={output.playing} currentAvailable={practice.startTargetIndex !== null} onPlay={playDemo} onStop={player.stop} />
      <PracticeControls practice={practice} midiConnected={midi.status === 'connected'} blocked={practiceBlocked} onStart={startPractice} onRestart={restartPractice} />
      <section className="midi-connection" aria-label="MIDI接続設定">
        <div className="connection-copy">
          <h2>MIDI入力</h2>
          <p role="status">{midi.message}</p>
          {midi.inputs.length > 0 && (
            <label className="input-selector">
              <span>入力機器</span>
              <select value={midi.selectedInputId ?? ''} onChange={(event) => selectInput(event.target.value)}>
                {midi.inputs.map((input) => <option key={input.id} value={input.id}>{input.name} / {input.manufacturer || 'メーカー不明'}</option>)}
              </select>
            </label>
          )}
        </div>
        <button className="connect-button" onClick={connect} disabled={midi.status === 'connected' || midi.requesting}>
          {midi.requesting ? '接続しています…' : midi.status === 'connected' ? 'MIDI接続済み' : 'MIDI接続'}
        </button>
      </section>
      <DeveloperControls practice={practice} model={songState.model} plan={songState.plan} song={songState.song} error={songState.error} cursorIndex={cursorIndex} blocked={!scoreReady || showDemoCursor} onPrevious={() => moveCursor(-1)} onNext={() => moveCursor(1)}
        demo={demo} demoDiagnostics={player.getDiagnostics()} outputDiagnostics={outputManager.getDiagnostics()} midiTrace={outputManager.trace} />
      <MidiDebugPanel latest={midi.latestEvent} lastNoteOn={midi.lastNoteOn} lastNoteOff={midi.lastNoteOff} />
      <MidiOutputPanel output={output} inputStatus={midi.status} onSelect={selectOutput} onPlay={playTestNote} onStop={stopAllNotes} onRetry={retryOutput} />
      <footer>Phase 2E-D3.3.2 · 曲を選んで、順番に弾いてみよう</footer>
    </main>
  )
}

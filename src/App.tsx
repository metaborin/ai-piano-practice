import { useDemoPlayer } from './audio/useDemoPlayer'
import { DemoControls } from './components/DemoControls'
import { DeveloperControls } from './components/DeveloperControls'
import { MidiDebugPanel } from './components/MidiDebugPanel'
import { MidiStatus } from './components/MidiStatus'
import { MidiOutputPanel } from './components/MidiOutputPanel'
import { PracticeControls } from './components/PracticeControls'
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
  const { library, retry, addSong, deleteSong } = useSongLibrary(songRepository, selection.select, DEFAULT_SONG_ID)
  const removeSong = async (id: string) => {
    if (songState.song?.id === id) {
      const fallback = library.songs.find((song) => song.id === DEFAULT_SONG_ID)
      if (fallback) void selection.select(fallback)
    }
    await deleteSong(id)
  }
  const title = songState.song?.title ?? 'AIピアノ練習アプリ'
  const scoreReady = songState.status === 'ready' && songState.canPractice
  const showDemoCursor = demo.status !== 'idle' && practice.status !== 'practicing' && practice.status !== 'completed'
  const cursorIndex = showDemoCursor ? demo.currentNoteIndex : practice.currentNoteIndex
  const noteCount = practice.totalNotes
  const practiceBlocked = !scoreReady || demo.status === 'playing' || output.playing
  const cursorMomentId = songState.plan?.targets[cursorIndex]?.scoreMomentId ?? null
  const positionUnit = songState.model?.practiceCompatibility === 'simpleMelody' ? '音' : 'ステップ'
  const startPractice = () => { if (!practiceBlocked) { player.resetDisplay(); start() } }
  const restartPractice = () => { if (!practiceBlocked) { player.resetDisplay(); restart() } }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">ピアノ練習 · Phase 2E-C2</p>
          <h1>{title}</h1>
          <p className="subtitle">{songState.song?.partLabel ?? '曲を選んで練習しましょう'}</p>
        </div>
        <MidiStatus status={midi.status} />
      </header>
      <SongLibrary library={library} selectedId={songState.song?.id ?? ''} onSelect={selection.select} onRetry={retry} onAdd={addSong} onDelete={removeSong} />
      {songState.model?.staffCount === 2 && <section className="practice-mode" aria-label="練習するパート">
        <h2>練習するパート</h2>
        <div className="mode-buttons">{(['right', 'left', 'both'] as PracticeMode[]).map((mode) => <button key={mode} aria-pressed={songState.mode === mode} onClick={() => selection.setMode(mode)}>{MODE_LABELS[mode]}</button>)}</div>
      </section>}
      <section className="score-card" aria-label={songState.song ? title + 'の楽譜' : '楽譜'} aria-busy={!scoreReady && songState.status === 'loading'}>
        <div className="score-heading">
          {songState.model && !songState.canPractice ? <span>楽譜表示</span> : <span className="cursor-legend"><span aria-hidden="true" />緑の帯が現在位置</span>}
          <span className="position" aria-live="polite">{scoreReady && noteCount > 0 ? `${cursorIndex + 1} / ${noteCount} ${positionUnit}` : '— / — 音'}</span>
        </div>
        {songState.status === 'loading' && <p className="score-message" role="status">楽譜を読み込み中…</p>}
        {songState.error && <p className="error-message" role="alert">{songState.error}</p>}
        {songState.status === 'ready' && !songState.canPractice && <p className="score-message" role="status">{songState.plan
          ? '選択したパートには、新しく押す音がありません。別のパートを選んでください。'
          : 'この曲は表示できますが、現在の練習・手本演奏には未対応です。'}<br />{songState.model?.practiceReasons.join('、')}</p>}
        {songState.source && <ScoreView key={songState.requestId} requestId={songState.requestId} score={songState.source} cursorIndex={cursorIndex} cursorMomentId={cursorMomentId} onReady={selection.ready} onError={selection.fail} />}
      </section>
      <DemoControls demo={demo} outputReady={scoreReady && output.status === 'connected'} outputBusy={output.playing} onPlay={() => { if (scoreReady) player.start() }} onStop={player.stop} />
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
      <DeveloperControls practice={practice} model={songState.model} plan={songState.plan} blocked={!scoreReady || showDemoCursor} onPrevious={() => moveCursor(-1)} onNext={() => moveCursor(1)} />
      <MidiDebugPanel latest={midi.latestEvent} lastNoteOn={midi.lastNoteOn} lastNoteOff={midi.lastNoteOff} />
      <MidiOutputPanel output={output} inputStatus={midi.status} onSelect={selectOutput} onPlay={playTestNote} onStop={stopAllNotes} onRetry={retryOutput} />
      <footer>Phase 2E-C2 · 曲を選んで、順番に弾いてみよう</footer>
    </main>
  )
}

import { useCallback } from 'react'
import { useDemoPlayer } from './audio/useDemoPlayer'
import { DemoControls } from './components/DemoControls'
import { DeveloperControls } from './components/DeveloperControls'
import { MidiDebugPanel } from './components/MidiDebugPanel'
import { MidiStatus } from './components/MidiStatus'
import { MidiOutputPanel } from './components/MidiOutputPanel'
import { PracticeControls } from './components/PracticeControls'
import { ScoreView } from './components/ScoreView'
import { useMidi } from './midi/useMidi'
import { usePracticeSession } from './practice/usePracticeSession'
import { twinkleScore } from './score/ScoreModel'
import type { ScoreModel } from './score/ScoreModel'
import './App.css'

export default function App() {
  const { midi, connect, selectInput, events, output, outputManager, selectOutput, playTestNote, stopAllNotes, retryOutput } = useMidi()
  const { session, practice, start, restart, moveCursor } = usePracticeSession(events)
  const { demo, player } = useDemoPlayer(outputManager, session)
  const onScoreReady = useCallback((model: ScoreModel | null) => {
    player.loadScore(model)
    session.loadScore(model)
  }, [player, session])
  const showDemoCursor = demo.status !== 'idle' && practice.status !== 'practicing' && practice.status !== 'completed'
  const cursorIndex = showDemoCursor ? demo.currentNoteIndex : practice.currentNoteIndex
  const noteCount = practice.totalNotes
  const practiceBlocked = demo.status === 'playing' || (showDemoCursor && output.playing)
  const startPractice = () => { if (!practiceBlocked) { player.resetDisplay(); start() } }
  const restartPractice = () => { if (!practiceBlocked) { player.resetDisplay(); restart() } }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">ピアノ練習 · Phase 2C-B</p>
          <h1>{twinkleScore.title}</h1>
          <p className="subtitle">{twinkleScore.partLabel} · はじめの4小節</p>
        </div>
        <MidiStatus status={midi.status} />
      </header>
      <section className="score-card" aria-label="きらきら星の楽譜">
        <div className="score-heading">
          <span className="cursor-legend"><span aria-hidden="true" />緑の帯が現在位置</span>
          <span className="position" aria-live="polite">{noteCount > 0 ? `${cursorIndex + 1} / ${noteCount} 音` : '楽譜を準備中'}</span>
        </div>
        <ScoreView score={twinkleScore} cursorIndex={cursorIndex} onReady={onScoreReady} />
      </section>
      <DemoControls demo={demo} outputReady={output.status === 'connected'} outputBusy={output.playing} onPlay={player.start} onStop={player.stop} />
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
      <DeveloperControls practice={practice} blocked={showDemoCursor} onPrevious={() => moveCursor(-1)} onNext={() => moveCursor(1)} />
      <MidiDebugPanel latest={midi.latestEvent} lastNoteOn={midi.lastNoteOn} lastNoteOff={midi.lastNoteOff} />
      <MidiOutputPanel output={output} inputStatus={midi.status} onSelect={selectOutput} onPlay={playTestNote} onStop={stopAllNotes} onRetry={retryOutput} />
      <footer>Phase 2C-B · 手本を聴いて、順番に弾いてみよう</footer>
    </main>
  )
}

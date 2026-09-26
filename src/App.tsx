import { DeveloperControls } from './components/DeveloperControls'
import { MidiDebugPanel } from './components/MidiDebugPanel'
import { MidiStatus } from './components/MidiStatus'
import { MidiOutputPanel } from './components/MidiOutputPanel'
import { PracticeControls } from './components/PracticeControls'
import { ScoreView } from './components/ScoreView'
import { useMidi } from './midi/useMidi'
import { usePracticeSession } from './practice/usePracticeSession'
import { twinkleScore } from './score/ScoreModel'
import './App.css'

export default function App() {
  const { midi, connect, selectInput, events, output, selectOutput, playTestNote, stopAllNotes, retryOutput } = useMidi()
  const { practice, start, restart, moveCursor, onScoreReady } = usePracticeSession(events)
  const { currentNoteIndex: cursorIndex, totalNotes: noteCount } = practice

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">ピアノ練習 · Phase 2C-A</p>
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
      <PracticeControls practice={practice} midiConnected={midi.status === 'connected'} onStart={start} onRestart={restart} />
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
      <DeveloperControls practice={practice} onPrevious={() => moveCursor(-1)} onNext={() => moveCursor(1)} />
      <MidiDebugPanel latest={midi.latestEvent} lastNoteOn={midi.lastNoteOn} lastNoteOff={midi.lastNoteOff} />
      <MidiOutputPanel output={output} inputStatus={midi.status} onSelect={selectOutput} onPlay={playTestNote} onStop={stopAllNotes} onRetry={retryOutput} />
      <footer>Phase 2C-A · 音順練習とMIDI出力の接続確認</footer>
    </main>
  )
}

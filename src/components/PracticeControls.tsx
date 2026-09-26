type Props = { cursorIndex: number; noteCount: number; onPrevious: () => void; onNext: () => void }
export function PracticeControls({ cursorIndex, noteCount, onPrevious, onNext }: Props) {
  return (
    <section className="practice-controls" aria-label="現在位置の操作">
      <div className="cursor-buttons">
        <button onClick={onPrevious} disabled={noteCount === 0 || cursorIndex === 0}><span aria-hidden="true">← </span>前の音</button>
        <button className="primary-button" onClick={onNext} disabled={noteCount === 0 || cursorIndex >= noteCount - 1}>次の音<span aria-hidden="true"> →</span></button>
      </div>
      <p>確認用の手動操作です。演奏ではカーソルは動きません。</p>
    </section>
  )
}

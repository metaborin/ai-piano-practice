import type { ScoreModel } from '../score/ScoreModel'
import type { Compatibility } from '../songs/Song'
import { createValidationReport } from '../score/validationReport'

type Props = { model: ScoreModel | null; tempoBpm?: number; compatibility?: Compatibility | null; error?: string | null }
export function ValidationReport({ model, tempoBpm, compatibility, error }: Props) {
  const report = createValidationReport(model, tempoBpm, compatibility, error)
  const tempo = report.tempo?.[0]
  return <section className="validation-report" aria-label="楽譜検証レポート">
    <h3>楽譜解析結果</h3>
    <p>{report.supported ? '✓' : '⚠'} 現在の練習対応：{report.label}</p>
    {model && <>
      <p>小節：{report.measures?.first} – {report.measures?.last}（{report.measures?.count}小節・XMLの番号）</p>
      <p>Staff：{model.staffCount} ／ Voice：{model.voices.join(', ')}</p>
      <p>Moment：{model.moments.length} ／ Notes：{model.notes.length} ／ Rest：{model.rests.length}</p>
      <p>Chord：{report.chordMoments ? 'あり' : 'なし'}（同時発音位置：{report.chordMoments}） ／ 総拍数：{model.totalBeats}</p>
      <p>Tie：{report.tieNotes ? `あり（${report.tieNotes}音符）` : 'なし'} ／ 複数Voice：{model.voices.length > 1 ? 'あり' : 'なし'}</p>
      {tempo && <p>手本の開始テンポ：{tempo.bpm} BPM（{tempo.source === 'default' ? '既定値' : tempo.source}） ／ 1拍：{(60_000 / tempo.bpm).toFixed(2)}ms</p>}
      {report.tempo && report.tempo.length > 1 && <p>途中のテンポ指定：{report.tempo.slice(1).map((point) => `${point.beat}拍から${point.bpm} BPM`).join('、')}</p>}
      {report.steps && <p>練習Step：{model.staffCount === 2 ? `右手 ${report.steps.right} ／ 左手 ${report.steps.left} ／ 両手 ${report.steps.both}` : report.steps.both}</p>}
      <p>Repeat：{report.navigation?.repeats.length ? 'あり' : 'なし'}</p>
      {report.navigation?.repeats.map(region => <p key={region.id}>Repeat range：{model.measures[region.startMeasureIndex].number}〜{model.measures[region.endMeasureIndex].number} ／ Repeat total passes：{region.totalPasses}</p>)}
      {!!report.navigation?.repeats.length && report.expandedMeasures && <p>Expanded measures（{report.expandedMeasures.length}小節）：{report.expandedMeasures.join(' → ')}</p>}
      {model.warnings.map((warning) => <p key={warning.code}>⚠ {warning.message}</p>)}
    </>}
    {report.reasons.map((reason) => <p key={reason}>⚠ {reason}</p>)}
    <p className="validation-note">MusicXMLの構造の確認です。印刷譜との音符の一致は、登録前に確認してください。</p>
  </section>
}

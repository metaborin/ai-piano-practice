import { useCallback, useEffect, useRef, useState } from 'react'
import type { Compatibility, ImportedSong } from '../songs/Song'
import { COMPATIBILITY_VERSION, compatibilityFromModel } from '../songs/inspectMusicXml'
import { readSongFile } from '../songs/readSongFile'
import type { ReadSongFileResult } from '../songs/readSongFile'
import type { ScoreModel, ScoreSource } from '../score/ScoreModel'
import { ScoreView } from './ScoreView'

type Draft = ReadSongFileResult & { requestId: number; score: ScoreSource }
type Props = { disabled: boolean; onAdd: (song: ImportedSong) => Promise<void> }

export function SongImport({ disabled, onAdd }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const savingRef = useRef(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  const [composer, setComposer] = useState('')
  const [compatibility, setCompatibility] = useState<Compatibility | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => () => { ++generation.current }, [])
  const cancel = () => {
    if (savingRef.current) return
    ++generation.current
    setDraft(null); setReading(false); setCompatibility(null); setError(null); setNotice('')
  }
  const read = async (file: File) => {
    if (savingRef.current) return
    const requestId = ++generation.current
    setReading(true); setDraft(null); setError(null); setNotice(''); setCompatibility(null)
    try {
      const result = await readSongFile(file)
      if (requestId !== generation.current) return
      setTitle(result.title); setComposer(result.composer)
      setDraft({ ...result, requestId, score: { id: 'import-preview', title: result.title, partLabel: '追加曲', musicXml: result.musicXml } })
      if (!result.model) setCompatibility(result.compatibility)
    } catch (error) {
      if (requestId === generation.current) setError(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。')
    } finally { if (requestId === generation.current) setReading(false) }
  }
  const ready = useCallback((id: number, model: ScoreModel) => {
    if (id === generation.current) setCompatibility(compatibilityFromModel(model))
  }, [])
  const fail = useCallback((id: number, message: string) => {
    if (id === generation.current) setCompatibility({ status: 'unsupported', version: COMPATIBILITY_VERSION, practiceCompatibility: 'unsupported', reasons: [message] })
  }, [])
  const save = async () => {
    if (!draft || !compatibility || !title.trim() || savingRef.current) return
    savingRef.current = true; setSaving(true); setError(null)
    try {
      await onAdd({ id: 'imported:' + crypto.randomUUID(), title: title.trim(), composer: composer.trim() || undefined,
        source: 'imported', partLabel: '追加曲', musicXml: { type: 'text', value: draft.musicXml },
        originalFileName: draft.originalFileName, fileFormat: draft.fileFormat, createdAt: Date.now(), compatibility })
      ++generation.current
      setDraft(null); setCompatibility(null); setNotice('曲を追加しました。「自分の曲」から選んでください。')
    } catch (error) { setError('曲を保存できませんでした。' + (error instanceof Error ? error.message : '空き容量やサイトデータ設定を確認してください。')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <div className="song-import">
    <input ref={input} type="file" accept=".musicxml,.xml,.mxl" hidden aria-label="追加する楽譜ファイル" onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void read(file)
    }} />
    <button className="add-song-button" disabled={disabled || saving} onClick={() => input.current?.click()}>＋ 曲を追加</button>
    <p className="import-help">MusicXML / MXL・10 MiBまで。曲はこのブラウザに保存され、外部へ送信されません。</p>
    {reading && <div role="status">ファイルを読み込み中… <button onClick={cancel}>キャンセル</button></div>}
    {error && <p role="alert" className="import-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {draft && <form className="import-confirmation" aria-label="曲の登録確認" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <h3>曲を追加</h3>
      <p>ファイル：{draft.originalFileName}</p>
      <p>形式：{draft.fileFormat === 'mxl' ? 'MXL' : 'MusicXML'}</p>
      <label>曲名<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={saving} required maxLength={300} /></label>
      <label>作曲者<input value={composer} onChange={(event) => setComposer(event.target.value)} disabled={saving} maxLength={300} /></label>
      <div role="status" className="compatibility-message">
        {!compatibility ? '楽譜と練習対象を確認中…' : compatibility.status === 'supported'
          ? 'この曲は現在の練習モードで使用できます。'
          : compatibility.parseCompatibility === 'supported' && compatibility.practiceCompatibility === 'polyphonicPending'
          ? 'この曲は解析・表示できます。練習・手本演奏は次Phase（2E-C2）で対応します。理由：' + compatibility.reasons.join('、')
          : '曲は保存できますが、現在の練習機能では未対応です。練習・手本演奏は利用できません。理由：' + compatibility.reasons.join('、')}
      </div>
      <div className="library-actions"><button type="button" onClick={cancel} disabled={saving}>キャンセル</button><button className="primary-button" type="submit" disabled={!compatibility || !title.trim() || saving}>{saving ? '保存中…' : '追加する'}</button></div>
      {!compatibility && <div className="import-validation" aria-hidden="true"><ScoreView key={draft.requestId} requestId={draft.requestId} score={draft.score} cursorIndex={0} onReady={ready} onError={fail} /></div>}
    </form>}
  </div>
}

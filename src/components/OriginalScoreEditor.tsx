import { useEffect, useRef, useState } from 'react'
import type { Song } from '../songs/Song'
import type { OriginalScoreAttachment, OriginalScoreRepository } from '../songs/OriginalScoreRepository'
import { ORIGINAL_SCORE_ACCEPT, originalScoreSize, readOriginalScoreFile } from '../songs/readOriginalScoreFile'

type Props = { song: Song; repository: OriginalScoreRepository; disabled: boolean; onSaved: (song: Song) => void }
export function OriginalScoreEditor({ song, repository, disabled, onSaved }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<OriginalScoreAttachment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmation = useRef<HTMLFormElement>(null)
  useEffect(() => {
    // The personal library has its own bounded scroller. Reveal the decision UI
    // when the file picker closes instead of leaving it below the clipped card.
    if (pending || deleting) confirmation.current?.scrollIntoView({ block: 'nearest' })
  }, [pending, deleting])
  const generation = useRef(0)
  const read = async (file: File) => {
    const request = ++generation.current
    setBusy(true); setError(null); setPending(null); setDeleting(false)
    try { const result = await readOriginalScoreFile(file); if (request === generation.current) setPending(result) }
    catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : '元の楽譜を読み込めませんでした。') }
    finally { if (request === generation.current) setBusy(false) }
  }
  const save = async () => {
    if (busy || disabled || (!pending && !deleting)) return
    setBusy(true); setError(null)
    try {
      const updated = deleting ? await repository.deleteOriginalScore(song.id) : await repository.saveOriginalScore(song.id, pending!)
      onSaved(updated); setPending(null); setDeleting(false)
    } catch (e) { setError(e instanceof Error ? e.message : '元の楽譜を保存できませんでした。') }
    finally { setBusy(false) }
  }
  return <div className="original-score-editor">
    <p>元の楽譜：{song.originalScore ? `登録済み ${song.originalScore.type === 'pdf' ? 'PDF' : '画像'} · ${song.originalScore.fileName ?? 'ファイル'}` : '未登録'}</p>
    <input ref={input} type="file" hidden accept={ORIGINAL_SCORE_ACCEPT} aria-label={`${song.title}の元の楽譜ファイル`} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file)
    }} />
    <div className="library-actions">
      <button disabled={disabled || busy} onClick={() => input.current?.click()}>{song.originalScore ? '元の楽譜を変更' : '元の楽譜を登録'}</button>
      {song.originalScore && <button disabled={disabled || busy} onClick={() => { setPending(null); setError(null); setDeleting(true) }}>元の楽譜を削除</button>}
    </div>
    {(pending || deleting) && <form ref={confirmation} className="import-confirmation" aria-label="元の楽譜の登録・削除確認" onSubmit={event => { event.preventDefault(); void save() }}>
      <p>曲：{song.title}</p>
      {pending && <><p>ファイル：{pending.metadata.fileName}</p><p>形式：{pending.metadata.mimeType} · サイズ：{originalScoreSize(pending.metadata.size)}</p>
        {song.originalScore && <p>現在登録されている元の楽譜を置き換えますか？</p>}</>}
      {deleting && <p>元の楽譜だけを削除しますか？練習用楽譜と曲は残ります。</p>}
      <div className="library-actions"><button type="button" disabled={busy} onClick={() => { setPending(null); setDeleting(false); setError(null) }}>キャンセル</button>
        <button disabled={disabled || busy} type="submit">{busy ? '保存中…' : deleting ? '元の楽譜だけ削除する' : song.originalScore ? '置き換える' : '登録する'}</button></div>
    </form>}
    {busy && <p role="status">元の楽譜を処理中…</p>}
    {error && <p className="import-error" role="alert">{error}</p>}
  </div>
}

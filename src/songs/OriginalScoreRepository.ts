import type { OriginalScore, Song } from './Song'

export type OriginalScoreAttachment = {
  metadata: Required<OriginalScore>
  blob: Blob
}

/** Metadata and binary changes commit together with the owning Song. */
export interface OriginalScoreRepository {
  saveOriginalScore(songId: string, attachment: OriginalScoreAttachment): Promise<Song>
  deleteOriginalScore(songId: string): Promise<Song>
  getOriginalScore(storageId: string): Promise<Blob>
}

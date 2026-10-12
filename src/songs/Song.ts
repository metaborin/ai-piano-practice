export type SongSource = 'builtin' | 'imported'

export type Compatibility = {
  readonly status: 'supported' | 'unsupported' | 'unknown'
  readonly version: number
  readonly reasons: readonly string[]
  /** Optional for records saved by Phase 2E-B. Recomputed from the original XML. */
  readonly parseCompatibility?: 'supported' | 'unsupported' | 'unknown'
  readonly practiceCompatibility?: 'simpleMelody' | 'pitchPractice' | 'polyphonicPending' | 'unsupported'
}

export type MusicXmlLocation =
  | { readonly type: 'url'; readonly value: string }
  | { readonly type: 'text'; readonly value: string }

export type DuetPartId = 'primo' | 'secondo'
export type DuetPart = { readonly label: string; readonly description: string; readonly musicXml: MusicXmlLocation }
/** Two separate single-part originals; practice and playback never share a pitch array. */
export type DuetPiece = {
  readonly id: string
  readonly defaultPart: DuetPartId
  readonly parts: Readonly<Record<DuetPartId, DuetPart>>
  readonly downloads?: { readonly primoMxl: string; readonly primoPdf: string; readonly fullScore: string; readonly fullMxl: string }
}

/** Reference only. The original PDF/image is stored separately from musical data. */
export type OriginalScore = {
  readonly type: 'pdf' | 'image'
  readonly storageId: string
  readonly fileName?: string
  /** Optional only for metadata saved before Phase 2E-E. New registrations set all fields. */
  readonly mimeType?: string
  readonly size?: number
  readonly createdAt?: number
}

/** Serializable metadata; no loaders, DOM, MIDI state or binary attachments. */
export type Song = {
  readonly id: string
  readonly title: string
  readonly composer?: string
  readonly source: SongSource
  readonly partLabel: string
  readonly musicXml: MusicXmlLocation
  /** Quarter-note BPM fallback; the selected MusicXML's tempo takes priority. */
  readonly tempoBpm?: number
  readonly difficulty?: number
  readonly createdAt?: number
  readonly originalScore?: OriginalScore
  readonly originalFileName?: string
  readonly fileFormat?: 'musicxml' | 'mxl'
  readonly compatibility?: Compatibility
  readonly duet?: DuetPiece
}

export type ImportedSong = Song & {
  readonly source: 'imported'
  readonly musicXml: { readonly type: 'text'; readonly value: string }
  readonly originalFileName: string
  readonly fileFormat: 'musicxml' | 'mxl'
  readonly createdAt: number
  readonly compatibility: Compatibility
}

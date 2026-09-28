import type { MusicSystem, OpenSheetMusicDisplay, VexFlowGraphicalNote } from 'opensheetmusicdisplay'
import type { ScoreModel } from './ScoreModel'
import type { ScoreSystems } from './ScoreLookAhead'

export type LayoutRect = { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export type ScoreLayout = { readonly systems: ScoreSystems; readonly positions: ReadonlyMap<string, LayoutRect> }

/** Capture original-position geometry during render only; never move the live cursor to preview. */
export function readScoreLayout(model: ScoreModel, display: OpenSheetMusicDisplay, mapping: ReadonlyMap<string, number>, host: HTMLElement): ScoreLayout {
  const ids = new Map<MusicSystem, number>(), systems = new Map<string, { system: number; measureIndex: number }>()
  for (const moment of model.moments) {
    const system = display.GraphicSheet.MeasureList[moment.measureIndex]?.find(measure => measure?.ParentMusicSystem)?.ParentMusicSystem
    if (!system) continue
    if (!ids.has(system)) ids.set(system, ids.size)
    systems.set(moment.id, { system: ids.get(system)!, measureIndex: moment.measureIndex })
  }
  const byCursor = new Map<number, string[]>()
  for (const [moment, index] of mapping) { const group = byCursor.get(index) ?? []; group.push(moment); byCursor.set(index, group) }
  const positions = new Map<string, LayoutRect>(), cursor = display.cursor
  const extents = new Map<number, { top: number; bottom: number }>()
  cursor.reset(); cursor.show()
  try {
    const origin = host.getBoundingClientRect()
    let index = 0
    while (!cursor.Iterator.EndReached) {
      if (index > model.notes.length + model.rests.length + model.measures.length) throw new Error('Layout traversal did not finish')
      const moments = byCursor.get(index)
      if (moments) {
        const box = cursor.cursorElement.getBoundingClientRect()
        const position = { top: box.top - origin.top, bottom: box.bottom - origin.top, left: box.left - origin.left, right: box.right - origin.left }
        for (const moment of moments) positions.set(moment, position)
        const system = systems.get(moments[0])?.system
        if (system !== undefined) {
          const extent = extents.get(system) ?? { top: position.top, bottom: position.bottom }
          // Ledger-line notes can extend outside OSMD's green staff-height band.
          for (const note of cursor.NotesUnderCursor()) {
            const graphical = display.EngravingRules.GNote(note) as VexFlowGraphicalNote | undefined
            const head = graphical?.getNoteheadSVGs()?.[graphical.vfnoteIndex]?.getBoundingClientRect()
            if (head?.height) { extent.top = Math.min(extent.top, head.top - origin.top); extent.bottom = Math.max(extent.bottom, head.bottom - origin.top) }
          }
          extents.set(system, extent)
        }
      }
      index++; cursor.next()
    }
  } finally { cursor.reset() }
  for (const [moment, rect] of positions) {
    const extent = extents.get(systems.get(moment)!.system)
    if (extent) positions.set(moment, { ...rect, top: Math.min(rect.top, extent.top), bottom: Math.max(rect.bottom, extent.bottom) })
  }
  return { systems, positions }
}

/** Two adjacent systems should fit where practical; never shrink below readable 100%.
 * We use measured geometry, including imported system spacing and grand-staff height.
 */
export function lookAheadZoom(layout: ScoreLayout, currentZoom: number, height: number): number {
  const systems = new Map<number, LayoutRect>()
  for (const [moment, position] of layout.positions) {
    const system = layout.systems.get(moment)?.system
    if (system !== undefined && !systems.has(system)) systems.set(system, position)
  }
  const values = [...systems.values()]
  const largestPair = values.slice(1).reduce((largest, next, index) => Math.max(largest, next.bottom - values[index].top), 0)
  if (!largestPair || height <= 0) return currentZoom
  return Math.max(1, Math.min(currentZoom, currentZoom * (height - 48) / largestPair))
}

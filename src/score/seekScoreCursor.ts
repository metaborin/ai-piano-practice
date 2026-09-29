import type { Cursor } from 'opensheetmusicdisplay'

/** OSMD next/previous update the DOM while visible. Seek hidden and draw once,
 * so a long repeat jump costs one cursor layout, not one per written position. */
export function seekScoreCursor(cursor: Pick<Cursor, 'hide' | 'show' | 'next' | 'previous'>, from: number, to: number): number {
  if (from !== to) {
    cursor.hide()
    while (from < to) { cursor.next(); from++ }
    while (from > to) { cursor.previous(); from-- }
  }
  cursor.show()
  return from
}

import { expect, it } from 'vitest'
import { matchNote } from '../../src/practice/NoteMatcher'

it('matches expected MIDI 60 with played MIDI 60', () => { expect(matchNote(60, 60)).toBe('correct') })
it('rejects played MIDI 64 when MIDI 60 is expected', () => { expect(matchNote(60, 64)).toBe('incorrect') })
it('distinguishes different octaves of the same note name', () => { expect(matchNote(60, 72)).toBe('incorrect') })

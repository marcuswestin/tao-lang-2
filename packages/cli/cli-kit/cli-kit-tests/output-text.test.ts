import { Describe, Expect, Test } from '@shared/test'
import { OutputText } from '../cli-kit-src/OutputText'

Describe('OutputText', () => {
  Test('sanitize strips ANSI codes and normalizes line endings', () => {
    Expect(OutputText.sanitize('[31mred[0m\r\nnext\rline')).toBe('red\nnextline')
  })

  Test('appendCompleteLines buffers a trailing partial line across chunks', () => {
    const buffer = { pending: '' }
    const lines: string[] = []

    OutputText.appendCompleteLines(buffer, 'one\ntwo\nthr', line => lines.push(line))
    Expect(lines).toEqual(['one', 'two'])
    Expect(buffer.pending).toBe('thr')

    OutputText.appendCompleteLines(buffer, 'ee\n', line => lines.push(line))
    Expect(lines).toEqual(['one', 'two', 'three'])
    Expect(buffer.pending).toBe('')
  })

  Test('flushPendingLine emits and clears a buffer that never saw a trailing newline', () => {
    const buffer = { pending: 'unfinished' }
    const lines: string[] = []

    OutputText.flushPendingLine(buffer, line => lines.push(line))
    Expect(lines).toEqual(['unfinished'])
    Expect(buffer.pending).toBe('')

    OutputText.flushPendingLine(buffer, line => lines.push(line))
    Expect(lines).toEqual(['unfinished'])
  })

  Test('formatElapsed renders sub-second durations in milliseconds and longer ones in seconds', () => {
    Expect(OutputText.formatElapsed(42)).toBe('42ms')
    Expect(OutputText.formatElapsed(1_500)).toBe('1.5s')
  })

  Test('wrapLine hard-wraps to the given width without touching a line that already fits', () => {
    Expect(OutputText.wrapLine('short', 20)).toEqual(['short'])
    Expect(OutputText.wrapLine('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

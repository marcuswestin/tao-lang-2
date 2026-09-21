import { OutputText } from '@cli-kit'
import { Platform } from '@shared'
import { Describe, Expect, fakeTerminal, Test, withCapturedOutput } from '@shared/test'
import { createInkDevLoopReporter, devLoopDashboardLayout } from '../cli-src/dev/dev-loop-tui'

Describe('Dev-loop TUI dashboard layout', () => {
  Test('wraps long output instead of clipping it', () => {
    Expect(OutputText.wrapLine('Compiled /Users/ro/code/tao-lang-2/Apps/Books/Books.tao', 20)).toEqual([
      'Compiled /Users/ro/c',
      'ode/tao-lang-2/Apps/',
      'Books/Books.tao',
    ])
  })

  Test('wraps output by terminal width without splitting Unicode graphemes', () => {
    Expect(OutputText.wrapLine('123456789😀界', 10)).toEqual([
      '123456789',
      '😀界',
    ])
  })

  Test('uses a two-by-two grid when four skinny columns would clip', () => {
    const layout = devLoopDashboardLayout({ columns: 120, rows: 28 }, 4, 2)
    Expect(layout.columnsPerRow).toBe(2)
    Expect(layout.columnWidth).toBeGreaterThanOrEqual(48)
  })

  Test('keeps a two-column grid in a wide terminal instead of a four-column strip', () => {
    const layout = devLoopDashboardLayout({ columns: 220, rows: 28 }, 5, 2)
    Expect(layout.columnsPerRow).toBe(2)
  })

  Test('keeps one full-width column in a narrow terminal', () => {
    const layout = devLoopDashboardLayout({ columns: 72, rows: 28 }, 4, 2)
    Expect(layout.columnsPerRow).toBe(1)
  })
})

Describe('Dev-loop TUI mount', () => {
  Test('mounts the real dashboard against a fake TTY without an Invalid hook call', async () => {
    // Regression: expo-host used to render this dashboard with cli-kit's React instance while
    // pinning its own for Expo, mounting two Reacts in one Ink tree. The TUI now lives here, where
    // it shares cli-kit's React and Ink resolution instead of expo-host's Expo-pinned one.
    const terminal = fakeTerminal()
    const originalStdout = Platform.runtimeProcess.stdout
    Platform.runtimeProcess.stdout = terminal.output as typeof Platform.runtimeProcess.stdout

    try {
      const reporter = createInkDevLoopReporter()
      const handle = reporter.start()
      Expect(handle).toBeDefined()
      reporter.logDevLoop('dev', 'mount proof')
      await new Promise(resolve => setTimeout(resolve, 300))
      await handle?.stop()
      Expect(terminal.outputText().length).toBeGreaterThan(0)
    } finally {
      Platform.runtimeProcess.stdout = originalStdout
    }
  })

  Test('falls back to a plain line without a TTY, mounting nothing', async () => {
    const reporter = createInkDevLoopReporter()
    const { result } = await withCapturedOutput(() => reporter.start())
    Expect(result).toBeUndefined()
  })
})

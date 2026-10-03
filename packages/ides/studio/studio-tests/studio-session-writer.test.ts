import { Errors } from '@shared/core'
import { Deferred, Expect, settle, Test } from '@shared/test'
import { StudioSessionWriter } from '../studio-src/client/StudioSessionWriter'

Test('Studio persists rapid tab changes in action order while focus saves independently', async () => {
  const first = Deferred<void>()
  const started: unknown[] = []
  const saved = new Map<string, unknown>()
  const writer = new StudioSessionWriter(async (field, value) => {
    started.push(value)
    if (value === 'tabs-A') {
      await first.promise
    }
    saved.set(field, value)
  })
  const a = writer.save('editorTabs', 'tabs-A')
  const b = writer.save('editorTabs', 'tabs-B')
  const focus = writer.save('focusedCellId', 'cell-B')
  await settle()
  Expect(started).toEqual(['tabs-A', 'cell-B'])
  Expect(saved.get('editorTabs')).toBe(undefined)
  first.resolve()
  await Promise.all([a, b, focus])
  Expect(saved.get('editorTabs')).toBe('tabs-B')
  Expect(saved.get('focusedCellId')).toBe('cell-B')
})

Test('Studio reports a failed focus save without blocking the next focus change', async () => {
  const saved: unknown[] = []
  const writer = new StudioSessionWriter(async (_field, value) => {
    if (value === 'cell-A') {
      Errors.throwUnexpected('Injected Studio session save failure.')
    }
    saved.push(value)
  })
  const failed = writer.save('focusedCellId', 'cell-A')
  const failure = Expect(failed).rejects.toThrow('Injected Studio session save failure.')
  const next = writer.save('focusedCellId', 'cell-B')
  await failure
  await next
  Expect(saved).toEqual(['cell-B'])
})

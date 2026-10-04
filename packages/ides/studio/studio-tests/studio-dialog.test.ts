import { FS } from '@shared'
import { Expect, Test } from '@shared/test'
import { StudioDialog, StudioDialogKeys, StudioDialogLifetime } from '../studio-src/client/StudioDialog'

Test('Studio dialog keys: Escape cancels from anywhere', () => {
  Expect(StudioDialogKeys.action('Escape', 'cancel', 'confirm')).toBe('cancel')
  Expect(StudioDialogKeys.action('Escape', 'input', 'prompt')).toBe('cancel')
})

Test('Studio dialog keys: Enter activates the focused button', () => {
  // A person who tabbed to Cancel and pressed Enter said no, whatever the dialog's default is.
  Expect(StudioDialogKeys.action('Enter', 'cancel', 'confirm')).toBe('cancel')
  Expect(StudioDialogKeys.action('Enter', 'confirm', 'confirm')).toBe('accept')
  Expect(StudioDialogKeys.action('Enter', 'confirm', 'prompt')).toBe('accept')
})

Test('Studio dialog keys: Enter acts only inside the dialog controls', () => {
  Expect(StudioDialogKeys.action('Enter', 'elsewhere', 'confirm')).toBeUndefined()
  Expect(StudioDialogKeys.action('Enter', 'input', 'prompt')).toBe('accept')
  Expect(StudioDialogKeys.action('Enter', 'elsewhere', 'prompt')).toBeUndefined()
})

Test('Studio dialog keys: other keys pass through', () => {
  Expect(StudioDialogKeys.action('Tab', 'confirm', 'confirm')).toBeUndefined()
})

Test('Studio dialog lifetime cancels superseded and disposed requests only while active', () => {
  const lifetime = new StudioDialogLifetime()
  const cancelled: string[] = []
  lifetime.replace(() => cancelled.push('first'))
  const releaseSecond = lifetime.replace(() => cancelled.push('second'))
  Expect(cancelled).toEqual(['first'])

  releaseSecond()
  lifetime.dispose()
  Expect(cancelled).toEqual(['first'])

  lifetime.replace(() => cancelled.push('third'))
  lifetime.dispose()
  Expect(cancelled).toEqual(['first', 'third'])
})

Test('Studio dialog refuses to open outside a mounted ProductHost scope', async () => {
  await Expect(StudioDialog.confirm({ title: 'Invisible action' })).resolves.toBe(false)
  await Expect(StudioDialog.prompt({ title: 'Invisible prompt' })).resolves.toBeUndefined()
})

Test('Studio client code never falls back to a native browser dialog', async () => {
  const root = FS.resolvePath('../studio-src/client', import.meta.dir)
  const violations: string[] = []
  for await (const path of FS.walk(root, { extensions: ['.ts', '.tsx'] })) {
    const source = await FS.readText(path)
    if (/\bwindow\.(?:alert|confirm|prompt)\s*\(/u.test(source)) {
      violations.push(path)
    }
  }
  Expect(violations).toEqual([])
})

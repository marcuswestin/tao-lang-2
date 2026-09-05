import { Expect, Test } from '@shared/test'
import { StudioDialogKeys } from '../studio-src/client/StudioDialog'

Test('Studio dialog keys: Escape cancels from anywhere', () => {
  for (const focus of ['cancel', 'confirm', 'elsewhere', 'input'] as const) {
    Expect(StudioDialogKeys.action('Escape', focus, 'confirm')).toBe('cancel')
    Expect(StudioDialogKeys.action('Escape', focus, 'prompt')).toBe('cancel')
  }
})

Test('Studio dialog keys: Enter activates the focused button', () => {
  // A person who tabbed to Cancel and pressed Enter said no, whatever the dialog's default is.
  Expect(StudioDialogKeys.action('Enter', 'cancel', 'confirm')).toBe('cancel')
  Expect(StudioDialogKeys.action('Enter', 'cancel', 'prompt')).toBe('cancel')
  Expect(StudioDialogKeys.action('Enter', 'confirm', 'confirm')).toBe('accept')
  Expect(StudioDialogKeys.action('Enter', 'confirm', 'prompt')).toBe('accept')
})

Test('Studio dialog keys: Enter confirms a confirm dialog and submits a prompt only from its input', () => {
  Expect(StudioDialogKeys.action('Enter', 'elsewhere', 'confirm')).toBe('accept')
  Expect(StudioDialogKeys.action('Enter', 'input', 'prompt')).toBe('accept')
  Expect(StudioDialogKeys.action('Enter', 'elsewhere', 'prompt')).toBeUndefined()
})

Test('Studio dialog keys: other keys pass through', () => {
  Expect(StudioDialogKeys.action('a', 'input', 'prompt')).toBeUndefined()
  Expect(StudioDialogKeys.action('Tab', 'confirm', 'confirm')).toBeUndefined()
  Expect(StudioDialogKeys.action(' ', 'confirm', 'confirm')).toBeUndefined()
})

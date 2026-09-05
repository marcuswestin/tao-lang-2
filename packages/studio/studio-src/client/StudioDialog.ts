// Studio's own confirmation and prompt dialogs.
//
// The workbench used the browser's `confirm` and `prompt` for the moments a person decides: applying a
// shared style edit, saving a captured or generated fixture, saving recorded steps, and naming a
// package. A native dialog is unstyled, blocks the whole window, cannot show a diff legibly, and does
// not exist at all in an embedded or headless host, where `confirm` answers false and the edit is
// reported as "not applied" with no way to say yes. These dialogs render in the shell, on the shared
// sheet, with the diff as a real block and the keyboard doing what people expect.

export type StudioConfirmOptions = Readonly<{
  cancelLabel?: string
  confirmLabel?: string
  /** A unified diff of the change the person is agreeing to; shown as a monospace block. */
  diff?: string
  detail?: string
  title: string
}>

export type StudioPromptOptions = Readonly<{
  cancelLabel?: string
  confirmLabel?: string
  detail?: string
  initialValue?: string
  placeholder?: string
  title: string
}>

/** StudioDialog opens one modal at a time and resolves with the person's answer. */
export const StudioDialog = {
  /** confirm resolves true when the person confirms, false when they cancel, close, or press Escape. */
  async confirm(options: StudioConfirmOptions): Promise<boolean> {
    const answer = await open({ ...options, kind: 'confirm' })
    return answer !== undefined
  },
  /** prompt resolves the entered text, or undefined when the person cancels. */
  async prompt(options: StudioPromptOptions): Promise<string | undefined> {
    return await open({ ...options, kind: 'prompt' })
  },
} as const

type DialogRequest =
  | (StudioConfirmOptions & { kind: 'confirm' })
  | (StudioPromptOptions & { kind: 'prompt' })

let current: HTMLElement | undefined

function open(request: DialogRequest): Promise<string | undefined> {
  current?.remove()
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const backdrop = document.createElement('div')
    backdrop.className = 'studio-dialog-backdrop'
    const dialog = document.createElement('section')
    dialog.className = 'studio-dialog'
    dialog.setAttribute('role', request.kind === 'prompt' ? 'dialog' : 'alertdialog')
    dialog.setAttribute('aria-modal', 'true')
    const titleId = `studio-dialog-title-${Math.random().toString(36).slice(2, 8)}`
    dialog.setAttribute('aria-labelledby', titleId)

    const title = document.createElement('h2')
    title.className = 'studio-dialog-title'
    title.id = titleId
    title.textContent = request.title
    dialog.append(title)
    if (request.detail !== undefined && request.detail !== '') {
      const detail = document.createElement('p')
      detail.className = 'studio-dialog-detail'
      detail.textContent = request.detail
      dialog.append(detail)
    }
    if (request.kind === 'confirm' && request.diff !== undefined && request.diff.trim() !== '') {
      dialog.append(renderDiff(request.diff))
    }
    let input: HTMLInputElement | undefined
    if (request.kind === 'prompt') {
      input = document.createElement('input')
      input.className = 'studio-input studio-dialog-input'
      input.setAttribute('aria-label', request.title)
      input.spellcheck = false
      input.value = request.initialValue ?? ''
      if (request.placeholder !== undefined) {
        input.placeholder = request.placeholder
      }
      dialog.append(input)
    }

    const actions = document.createElement('div')
    actions.className = 'studio-dialog-actions'
    const cancel = button(request.cancelLabel ?? 'Cancel', 'ghost')
    const confirm = button(request.confirmLabel ?? (request.kind === 'prompt' ? 'Continue' : 'Apply'), 'primary')
    actions.append(cancel, confirm)
    dialog.append(actions)
    backdrop.append(dialog)

    const finish = (answer: string | undefined): void => {
      if (current !== backdrop) {
        return
      }
      current = undefined
      document.removeEventListener('keydown', onKeyDown, true)
      backdrop.remove()
      previouslyFocused?.focus()
      resolve(answer)
    }
    const accept = (): void => finish(input === undefined ? '' : input.value)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(undefined)
      } else if (event.key === 'Enter' && (input === undefined || document.activeElement === input)) {
        event.preventDefault()
        event.stopPropagation()
        accept()
      }
    }
    cancel.addEventListener('click', () => finish(undefined))
    confirm.addEventListener('click', accept)
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) {
        finish(undefined)
      }
    })
    document.addEventListener('keydown', onKeyDown, true)

    current = backdrop
    ;(document.querySelector('.studio-shell') ?? document.body).append(backdrop)
    ;(input ?? confirm).focus()
    input?.select()
  })
}

function button(label: string, variant: 'ghost' | 'primary'): HTMLButtonElement {
  const element = document.createElement('button')
  element.className = 'studio-button'
  element.dataset['variant'] = variant
  element.textContent = label
  element.type = 'button'
  return element
}

/** renderDiff shows a unified diff with added and removed lines told apart by color, not by reading. */
function renderDiff(diff: string): HTMLElement {
  const block = document.createElement('pre')
  block.className = 'studio-dialog-diff'
  for (const line of diff.replace(/\n$/u, '').split('\n')) {
    const row = document.createElement('span')
    row.className = 'studio-dialog-diff-line'
    row.dataset['kind'] = line.startsWith('+++') || line.startsWith('---')
      ? 'file'
      : line.startsWith('@@')
      ? 'hunk'
      : line.startsWith('+')
      ? 'added'
      : line.startsWith('-')
      ? 'removed'
      : 'context'
    row.textContent = line
    block.append(row)
  }
  return block
}

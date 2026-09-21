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
  /** Binds dialogs to one ProductHost lifetime. Disposing the host cancels any pending answer. */
  mount(options: Readonly<{ container: HTMLElement; signal?: AbortSignal }>): () => void {
    const lifetime = new StudioDialogLifetime()
    const mounted: Omit<DialogScope, 'dispose'> = {
      container: options.container,
      lifetime,
      signal: options.signal,
      token: Symbol('dialog-scope'),
    }
    scope?.dispose()
    const abort = (): void => {
      lifetime.dispose()
    }
    const dispose = (): void => {
      abort()
      options.signal?.removeEventListener('abort', abort)
      if (scope?.token === mounted.token) {
        scope = undefined
      }
    }
    scope = { ...mounted, dispose }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted === true) {
      dispose()
    }
    return dispose
  },
} as const

/** Where keyboard focus sits when a key arrives, as far as the dialog's own keys are concerned. */
export type StudioDialogFocus = 'cancel' | 'confirm' | 'elsewhere' | 'input'

export type StudioDialogKeyAction = 'accept' | 'cancel'

/**
 * StudioDialogKeys decides what a key does in an open dialog. Escape always cancels. Enter activates
 * the focused button, so Enter on Cancel cancels instead of applying; prompts also submit from their
 * input. An Enter originating behind the modal has no dialog action.
 */
export const StudioDialogKeys = {
  action(key: string, focus: StudioDialogFocus, kind: 'confirm' | 'prompt'): StudioDialogKeyAction | undefined {
    if (key === 'Escape') {
      return 'cancel'
    }
    if (key !== 'Enter') {
      return undefined
    }
    if (focus === 'cancel') {
      return 'cancel'
    }
    if (kind === 'prompt') {
      return focus === 'input' || focus === 'confirm' ? 'accept' : undefined
    }
    return focus === 'confirm' ? 'accept' : undefined
  },
} as const

type DialogRequest =
  | (StudioConfirmOptions & { kind: 'confirm' })
  | (StudioPromptOptions & { kind: 'prompt' })

type DialogScope = Readonly<{
  container: HTMLElement
  dispose: () => void
  lifetime: StudioDialogLifetime
  signal?: AbortSignal
  token: symbol
}>

type OpenDialog = Readonly<{ backdrop: HTMLElement; cancel: () => void }>

let current: OpenDialog | undefined
let scope: DialogScope | undefined

/** Cancels superseded and disposed dialog work without exposing DOM concerns to its owner. */
export class StudioDialogLifetime {
  #cancel: (() => void) | undefined

  replace(cancel: () => void): () => void {
    this.dispose()
    this.#cancel = cancel
    return () => {
      if (this.#cancel === cancel) {
        this.#cancel = undefined
      }
    }
  }

  dispose(): void {
    const cancel = this.#cancel
    this.#cancel = undefined
    cancel?.()
  }
}

function open(request: DialogRequest): Promise<string | undefined> {
  // A dialog opening over another answers the first as cancelled: its flow resumes with "no" instead
  // of waiting forever, and its key handling stops instead of eating Enter and Escape for the session.
  current?.cancel()
  return new Promise(resolve => {
    const activeScope = scope
    if (activeScope === undefined || activeScope.signal?.aborted === true) {
      resolve(undefined)
      return
    }
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
    const focusable: readonly HTMLElement[] = input === undefined ? [cancel, confirm] : [input, cancel, confirm]
    let restoreBackground = (): void => {}
    let releaseLifetime = (): void => {}

    const finish = (answer: string | undefined): void => {
      if (current?.backdrop !== backdrop) {
        return
      }
      current = undefined
      releaseLifetime()
      document.removeEventListener('keydown', onKeyDown, true)
      activeScope?.signal?.removeEventListener('abort', abort)
      restoreBackground()
      backdrop.remove()
      if (previouslyFocused?.isConnected === true) {
        previouslyFocused.focus()
      }
      resolve(answer)
    }
    const abort = (): void => finish(undefined)
    const accept = (): void => finish(input === undefined ? '' : input.value)
    const focusOf = (): StudioDialogFocus => {
      const active = document.activeElement
      return active === input ? 'input' : active === cancel ? 'cancel' : active === confirm ? 'confirm' : 'elsewhere'
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        // The dialog is modal: Tab cycles its own controls instead of wandering into the shell behind it.
        const index = focusable.findIndex(element => element === document.activeElement)
        const last = focusable.length - 1
        const next = event.shiftKey ? (index <= 0 ? last : index - 1) : (index < 0 || index === last ? 0 : index + 1)
        event.preventDefault()
        event.stopPropagation()
        focusable[next]?.focus()
        return
      }
      const action = StudioDialogKeys.action(event.key, focusOf(), request.kind)
      if (action === undefined) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (action === 'accept') {
        accept()
      } else {
        finish(undefined)
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

    current = { backdrop, cancel: () => finish(undefined) }
    releaseLifetime = activeScope.lifetime.replace(abort)
    activeScope.container.append(backdrop)
    restoreBackground = makeBackgroundInert(activeScope.container, backdrop)
    activeScope.signal?.addEventListener('abort', abort, { once: true })
    ;(input ?? confirm).focus()
    input?.select()
  })
}

function makeBackgroundInert(container: HTMLElement, dialog: HTMLElement): () => void {
  const previous = [...container.children].flatMap(child => {
    if (!(child instanceof HTMLElement) || child === dialog) {
      return []
    }
    const state = { ariaHidden: child.getAttribute('aria-hidden'), element: child, inert: child.inert }
    child.inert = true
    child.setAttribute('aria-hidden', 'true')
    return [state]
  })
  return () => {
    for (const state of previous) {
      state.element.inert = state.inert
      if (state.ariaHidden === null) {
        state.element.removeAttribute('aria-hidden')
      } else {
        state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
    }
  }
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

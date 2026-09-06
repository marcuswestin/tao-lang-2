/** The canonical keys understood by the attention reducer. */
export type TaoAttentionKey =
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'Backspace'
  | 'Enter'
  | 'Escape'
  | 'Space'
  | 'Tab'
  | '.'
  | '/'
  | '?'
  | 'primary+k'

/** The platform-neutral part of a browser or future native hardware-key event. */
export type TaoHardwareKeyEvent = Readonly<{
  altKey?: boolean
  code?: string
  ctrlKey?: boolean
  key?: string
  metaKey?: boolean
  shiftKey?: boolean
}>

export type TaoKeyPlatform = Readonly<{
  /** navigatorPlatform distinguishes Apple hardware when React Native reports only `web`. */
  navigatorPlatform?: string
  platformOS?: string
}>

/** InteractionKeyboardPresence hides keyboard-only affordances until a key enters the app. */
class InteractionKeyboardPresence {
  #present = false
  #revision = 0
  #listeners = new Set<() => void>()

  readonly snapshot = (): number => this.#revision
  readonly subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  read(): boolean {
    return this.#present
  }

  mark(): void {
    if (this.#present) {
      return
    }
    this.#present = true
    this.#revision += 1
    for (const listener of [...this.#listeners]) {
      listener()
    }
  }

  reset(): void {
    if (!this.#present) {
      return
    }
    this.#present = false
    this.#revision += 1
    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}

export const interactionKeyboardPresence = new InteractionKeyboardPresence()

const namedKeys: Readonly<Record<string, TaoAttentionKey>> = Object.freeze({
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
})

/** normalizeInteractionKey is the one canonicalizer for Tao test strings and hardware input. */
export function normalizeInteractionKey(value: string): string {
  if (value === ' ') {
    return 'Space'
  }
  const parts = value.split('+').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    return ''
  }
  const key = normalizeKeyPart(parts.at(-1)!)
  const modifiers = parts.slice(0, -1).map(part => part.toLocaleLowerCase())
  return [...modifiers, key].join('+')
}

/** interactionKeyFromHardwareEvent lowers physical input to the same strings Tao tests dispatch. */
export function interactionKeyFromHardwareEvent(
  event: TaoHardwareKeyEvent,
  platform: TaoKeyPlatform = {},
): string | undefined {
  const physicalSlash = event.code === 'Slash'
  const key = physicalSlash ? (event.shiftKey ? '?' : '/') : event.key
  if (!key) {
    return undefined
  }
  const modifiers: string[] = []
  const apple = isApplePrimaryPlatform(platform)
  const primary = apple ? event.metaKey === true : event.ctrlKey === true
  if (primary) {
    modifiers.push('primary')
  } else {
    if (event.ctrlKey) {
      modifiers.push('control')
    }
    if (event.metaKey) {
      modifiers.push('meta')
    }
  }
  if (event.altKey) {
    modifiers.push('alt')
  }
  // Shift is already represented by the physical Slash key's `?` character.
  if (event.shiftKey && !physicalSlash && key.length > 1) {
    modifiers.push('shift')
  }
  return normalizeInteractionKey([...modifiers, key].join('+'))
}

/**
 * dispatchInteractionHardwareKey lowers one host key event to a canonical key, records that a
 * keyboard is present, and hands the key to the dispatch its caller passes in. It registers no
 * listener of its own; the web app host, which owns the app's one key listener, is its only caller.
 */
export function dispatchInteractionHardwareKey(
  event: TaoHardwareKeyEvent,
  dispatch: (key: string) => boolean,
  platform: TaoKeyPlatform = {},
): boolean {
  const key = interactionKeyFromHardwareEvent(event, platform)
  if (key === undefined) {
    return false
  }
  interactionKeyboardPresence.mark()
  return dispatch(key)
}

function isApplePrimaryPlatform(platform: TaoKeyPlatform): boolean {
  const os = platform.platformOS?.toLocaleLowerCase()
  if (os === 'ios' || os === 'macos') {
    return true
  }
  return os === 'web' && /mac|iphone|ipad|ipod/i.test(platform.navigatorPlatform ?? '')
}

function normalizeKeyPart(value: string): string {
  const named = namedKeys[value.toLocaleLowerCase()]
  if (named) {
    return named
  }
  return [...value].length === 1 ? value.toLocaleLowerCase() : value
}

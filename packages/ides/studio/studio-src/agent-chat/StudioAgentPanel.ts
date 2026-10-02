// Studio agent: floating workbench panel that hosts the agent chat in the bottom left.
// It floats over the workbench by default, can be dragged to reposition anywhere on screen,
// can be minimized to a compact pill or expanded, and is styled by the shared Studio sheet.

import { studioIcon } from '../client/StudioShell'
import { mountStudioAgentChatPanel, type StudioAgentChatPanelHooks } from './StudioAgentChatPanel'

export type AgentPanelPosition = Readonly<{ left: number; top: number }>

const agentPositionStorageKey = 'tao-studio:agent-position:v1'

/** The panel's own CSS sizes, used when the element cannot be measured yet. */
const agentPanelSizes = {
  expanded: { height: 500, width: 480 },
  minimized: { height: 34, width: 200 },
} as const

export const StudioAgentPosition = {
  clamp(
    position: AgentPanelPosition,
    panelSize: Readonly<{ height: number; width: number }>,
    viewportSize: Readonly<{ height: number; width: number }>,
  ): AgentPanelPosition {
    const minLeft = 8
    const maxLeft = Math.max(minLeft, viewportSize.width - panelSize.width - 8)
    const minTop = 48
    const maxTop = Math.max(minTop, viewportSize.height - panelSize.height - 8)
    return {
      left: Math.min(Math.max(minLeft, Math.round(position.left)), maxLeft),
      top: Math.min(Math.max(minTop, Math.round(position.top)), maxTop),
    }
  },
  /** defaultSize is the panel's authored size for one state, the fallback before it can be measured. */
  defaultSize(minimized: boolean): Readonly<{ height: number; width: number }> {
    return minimized ? agentPanelSizes.minimized : agentPanelSizes.expanded
  },
  /**
   * parse reads a persisted position back. Anything that is not a pair of finite numbers is discarded
   * rather than written onto the panel: a stored value is only ever as trustworthy as the browser that
   * wrote it, and an unparsable one used to place the panel wherever the CSS happened to leave it.
   */
  parse(stored: string | null | undefined): AgentPanelPosition | undefined {
    if (stored === null || stored === undefined || stored === '') {
      return undefined
    }
    let value: unknown
    try {
      value = JSON.parse(stored)
    } catch {
      return undefined
    }
    if (typeof value !== 'object' || value === null) {
      return undefined
    }
    const left = pixels((value as { left?: unknown }).left)
    const top = pixels((value as { top?: unknown }).top)
    return left === undefined || top === undefined ? undefined : { left, top }
  },
  /** restore applies the state that determines size before clamping the saved position. */
  restore(
    stored: string | null | undefined,
    minimized: boolean,
    viewportSize: Readonly<{ height: number; width: number }>,
  ): AgentPanelPosition | undefined {
    const position = StudioAgentPosition.parse(stored)
    return position === undefined
      ? undefined
      : StudioAgentPosition.clamp(position, StudioAgentPosition.defaultSize(minimized), viewportSize)
  },
} as const

/** pixels accepts both a number and the `"123px"` CSS string earlier versions persisted. */
function pixels(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export type StudioAgentPanelModel = {
  expand: () => void
  isMinimized: () => boolean
  minimize: () => void
  toggle: () => void
}

export function mountStudioAgentPanel(root: HTMLElement, hooks: StudioAgentChatPanelHooks): StudioAgentPanelModel {
  const host = root.querySelector<HTMLElement>('.studio-agent-host') ?? root
  const panel = document.createElement('section')
  panel.className = 'studio-agent-panel'
  panel.setAttribute('aria-label', 'Tao agent')
  panel.dataset['minimized'] = 'false'
  panel.innerHTML = `
    <header class="studio-agent-header">
      <div class="studio-agent-header-title">
        ${studioIcon('ai', 'small')}
        <strong>Agent</strong>
      </div>
      <div class="studio-agent-header-actions">
        <button class="studio-agent-collapse studio-icon-button" type="button" title="Minimize agent" aria-label="Minimize agent">–</button>
      </div>
    </header>
    <div class="studio-agent-body"></div>
  `
  host.append(panel)

  const body = panel.querySelector<HTMLElement>('.studio-agent-body')!
  const collapse = panel.querySelector<HTMLButtonElement>('.studio-agent-collapse')!
  const header = panel.querySelector<HTMLElement>('.studio-agent-header')!
  const railButton = root.querySelector<HTMLButtonElement>('.studio-rail-button[data-panel="agent"]')

  /** placed is the panel's own position; while it is undefined the stylesheet's corner still owns it. */
  let placed: AgentPanelPosition | undefined

  function viewportSize(): Readonly<{ height: number; width: number }> {
    return {
      height: window.innerHeight || agentPanelSizes.expanded.height,
      width: window.innerWidth || agentPanelSizes.expanded.width,
    }
  }

  function panelSize(): Readonly<{ height: number; width: number }> {
    const fallback = StudioAgentPosition.defaultSize(panel.dataset['minimized'] === 'true')
    return { height: panel.offsetHeight || fallback.height, width: panel.offsetWidth || fallback.width }
  }

  /** place clamps a position into the current viewport and writes it, so the panel stays reachable. */
  function place(position: AgentPanelPosition): void {
    placed = StudioAgentPosition.clamp(position, panelSize(), viewportSize())
    panel.style.left = `${placed.left}px`
    panel.style.top = `${placed.top}px`
    panel.style.bottom = 'auto'
  }

  function store(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value)
      }
    } catch {}
  }

  function setMinimized(minimized: boolean): void {
    panel.dataset['minimized'] = String(minimized)
    collapse.textContent = minimized ? '+' : '–'
    collapse.title = minimized ? 'Expand agent' : 'Minimize agent'
    collapse.setAttribute('aria-label', collapse.title)
    if (railButton !== null) {
      railButton.setAttribute('aria-current', String(!minimized))
    }
    // Expanding is what grows the panel, so a pill that sat near an edge has to be pulled back in.
    if (placed !== undefined) {
      place(placed)
    }
    if (!minimized) {
      panel.querySelector<HTMLInputElement>('.chat-input')?.focus()
    }
  }

  collapse.addEventListener('click', event => {
    event.stopPropagation()
    setMinimized(panel.dataset['minimized'] !== 'true')
  })

  let ignoreNextClick = false

  header.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
      return
    }
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) {
      return
    }
    const startX = event.clientX
    const startY = event.clientY
    const rect = panel.getBoundingClientRect()
    const initialLeft = rect.left
    const initialTop = rect.top
    let hasDragged = false

    header.setPointerCapture?.(event.pointerId)

    // One gesture, one signal: a drag ends on either pointerup or pointercancel, and whichever does
    // not fire would otherwise stay registered and run against some later gesture's pointer.
    const gesture = new AbortController()

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!hasDragged && Math.hypot(dx, dy) > 3) {
        hasDragged = true
        panel.dataset['dragging'] = 'true'
      }
      if (hasDragged) {
        place({ left: initialLeft + dx, top: initialTop + dy })
      }
    }

    const onPointerUp = (upEvent: PointerEvent): void => {
      gesture.abort()
      header.releasePointerCapture?.(upEvent.pointerId)
      if (hasDragged) {
        delete panel.dataset['dragging']
        ignoreNextClick = true
        if (placed !== undefined) {
          store(agentPositionStorageKey, JSON.stringify(placed))
        }
      }
    }

    header.addEventListener('pointermove', onPointerMove, { signal: gesture.signal })
    header.addEventListener('pointerup', onPointerUp, { signal: gesture.signal })
    header.addEventListener('pointercancel', onPointerUp, { signal: gesture.signal })
  })

  header.addEventListener('click', () => {
    if (ignoreNextClick) {
      ignoreNextClick = false
      return
    }
    if (panel.dataset['minimized'] === 'true') {
      setMinimized(false)
    }
  })

  header.addEventListener('dblclick', event => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) {
      return
    }
    setMinimized(panel.dataset['minimized'] !== 'true')
  })

  // Studio always opens on the canvas, with the agent a pill until asked for. Minimizing comes before
  // placement: clamping a bottom-corner pill as if it were the full panel walks it upward on every load.
  setMinimized(true)

  try {
    if (typeof window !== 'undefined') {
      // The stored position was clamped against the display it was dragged on. A smaller one now, or
      // a smaller window, would leave the panel off-screen with no way back, so it is re-clamped here
      // and again on every resize rather than trusted as written.
      const saved = StudioAgentPosition.parse(window.localStorage.getItem(agentPositionStorageKey))
      if (saved !== undefined) {
        place(saved)
      }
      window.addEventListener('resize', () => {
        if (placed !== undefined) {
          place(placed)
        }
      })
    }
  } catch {}

  mountStudioAgentChatPanel(body, hooks)

  return {
    expand: () => setMinimized(false),
    isMinimized: () => panel.dataset['minimized'] === 'true',
    minimize: () => setMinimized(true),
    toggle: () => setMinimized(panel.dataset['minimized'] !== 'true'),
  }
}

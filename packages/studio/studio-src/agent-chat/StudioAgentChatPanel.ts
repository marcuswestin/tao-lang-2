// Studio agent chat: a second overlay beside the proof-of-concept panel. Plain DOM and inline styles, for
// the same reason the first one is: the point is to make the flow observable, not to design a product surface.

import { StudioApiClient } from '../client/StudioApiClient'

type Availability = {
  configured: boolean
  enabled: boolean
  provider: string
  model: string
  reason?: string
}

type ToolCall = { name: string; input: unknown; summary: string; resultChars: number }

type Approval = { approvalId: string; toolName: string; input: unknown; reason?: string }

type TurnResult = {
  status: 'complete' | 'needs-approval' | 'budget-exhausted' | 'failed' | 'unavailable'
  text?: string
  message?: string
  steps?: number
  toolCalls?: ToolCall[]
  pendingApprovals?: Approval[]
  usage?: { inputTokens?: number; outputTokens?: number }
  availability?: Availability
}

export type StudioAgentChatPanelHooks = {
  openDeclaration: (name: string) => Promise<void>
  /** Names the panel can turn into links: every declaration the open app has. */
  knownNames: () => readonly string[]
}

const SHELL =
  'position:fixed;left:12px;bottom:12px;width:430px;max-height:72vh;display:flex;flex-direction:column;background:#151a17;color:#e8ede9;border:1px solid #3a4a3f;border-radius:10px;padding:10px 12px;font:12px/1.45 ui-monospace,Menlo,monospace;z-index:9000;box-shadow:0 8px 24px rgba(0,0,0,.4)'

const INPUT =
  'flex:1;background:#0f1411;color:#e8ede9;border:1px solid #3a4a3f;border-radius:6px;padding:4px 7px;font:inherit'

export function mountStudioAgentChatPanel(root: HTMLElement, hooks: StudioAgentChatPanelHooks): void {
  const panel = document.createElement('section')
  panel.className = 'studio-agent-chat'
  panel.setAttribute('aria-label', 'Studio agent chat')
  panel.style.cssText = SHELL
  panel.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <strong style="flex:1">Ask about this app</strong>
      <label style="display:flex;gap:4px;align-items:center;color:#9fb3a5" title="Send this project's declarations to a hosted model">
        <input class="chat-cloud" type="checkbox"> cloud
      </label>
      <button class="chat-toggle" type="button" title="Collapse">–</button>
    </div>
    <div class="chat-status" style="color:#9fb3a5;margin-bottom:6px"></div>
    <div class="chat-log" style="flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px"></div>
    <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
      <input class="chat-input" placeholder="what happens when I tap a story?" style="${INPUT}">
      <button class="chat-send" type="button">Ask</button>
    </div>
  `
  root.append(panel)

  const cloud = panel.querySelector<HTMLInputElement>('.chat-cloud')!
  const status = panel.querySelector<HTMLElement>('.chat-status')!
  const log = panel.querySelector<HTMLElement>('.chat-log')!
  const input = panel.querySelector<HTMLInputElement>('.chat-input')!
  const send = panel.querySelector<HTMLButtonElement>('.chat-send')!
  const toggle = panel.querySelector<HTMLButtonElement>('.chat-toggle')!

  toggle.addEventListener('click', () => {
    const hidden = !log.hidden
    log.hidden = hidden
    status.hidden = hidden
    toggle.textContent = hidden ? '+' : '–'
    panel.style.width = hidden ? '200px' : '430px'
  })

  function line(text: string, color = '#9fb3a5'): HTMLElement {
    const element = document.createElement('div')
    element.style.cssText = `color:${color}`
    element.textContent = text
    return element
  }

  function say(role: 'you' | 'agent', text: string): HTMLElement {
    const block = document.createElement('div')
    block.style.cssText = role === 'you'
      ? 'border-left:2px solid #3a4a3f;padding-left:8px'
      : 'border-left:2px solid #6fb38a;padding-left:8px'
    const who = document.createElement('div')
    who.style.cssText = `color:${role === 'you' ? '#9fb3a5' : '#6fb38a'};margin-bottom:2px`
    who.textContent = role
    block.append(who)
    block.append(withLinks(text))
    log.append(block)
    log.scrollTop = log.scrollHeight
    return block
  }

  /**
   * withLinks turns any declaration name the model wrote into something that opens the source. The model is
   * told to name declarations exactly for this reason: the answer stays checkable.
   */
  function withLinks(text: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.style.whiteSpace = 'pre-wrap'
    const names = [...hooks.knownNames()].filter(name => name.length > 2).sort((a, b) => b.length - a.length)
    if (names.length === 0) {
      wrapper.textContent = text
      return wrapper
    }
    const pattern = new RegExp(
      `\\b(${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
      'g',
    )
    let index = 0
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0
      if (at > index) {
        wrapper.append(document.createTextNode(text.slice(index, at)))
      }
      const link = document.createElement('a')
      link.href = '#'
      link.textContent = match[0]
      link.style.cssText = 'color:#8fc7ff;text-decoration:underline;cursor:pointer'
      link.title = 'Open this declaration'
      link.addEventListener('click', event => {
        event.preventDefault()
        void hooks.openDeclaration(match[0])
      })
      wrapper.append(link)
      index = at + match[0].length
    }
    wrapper.append(document.createTextNode(text.slice(index)))
    return wrapper
  }

  /** Tool calls are shown, always. A person should be able to see what the answer was built from. */
  function showToolCalls(calls: readonly ToolCall[]): void {
    if (calls.length === 0) {
      return
    }
    const box = document.createElement('details')
    box.style.cssText = 'color:#9fb3a5'
    const heading = document.createElement('summary')
    heading.style.cursor = 'pointer'
    heading.textContent = `${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}`
    box.append(heading)
    for (const call of calls) {
      const row = document.createElement('div')
      row.style.cssText = 'margin:3px 0 3px 10px'
      const name = document.createElement('span')
      name.style.color = '#e8ede9'
      name.textContent = call.name
      row.append(name)
      const argument = JSON.stringify(call.input)
      row.append(
        document.createTextNode(
          `${argument === '{}' ? '' : `(${argument})`} → ${call.summary} [${call.resultChars} chars]`,
        ),
      )
      box.append(row)
    }
    log.append(box)
  }

  async function availability(): Promise<Availability> {
    return await StudioApiClient.agentChat<Availability>('availability', {})
  }

  function showAvailability(state: Availability): void {
    cloud.checked = state.enabled
    cloud.disabled = !state.configured
    status.textContent = state.reason ?? `Answering with ${state.model}. Only this app's declarations are sent.`
    status.style.color = state.enabled ? '#6fb38a' : '#9fb3a5'
  }

  cloud.addEventListener('change', () => {
    void (async () => {
      showAvailability(await StudioApiClient.agentChat<Availability>('enable', { enabled: cloud.checked }))
    })()
  })

  async function ask(): Promise<void> {
    const question = input.value.trim()
    if (question === '') {
      return
    }
    input.value = ''
    say('you', question)
    send.disabled = true
    const thinking = line('thinking…', '#9fb3a5')
    log.append(thinking)
    log.scrollTop = log.scrollHeight
    try {
      const turn = await StudioApiClient.agentChat<TurnResult>('send', { message: question })
      thinking.remove()
      showToolCalls(turn.toolCalls ?? [])
      if (turn.status === 'unavailable') {
        if (turn.availability !== undefined) {
          showAvailability(turn.availability)
        }
        log.append(line(turn.availability?.reason ?? 'The chat is not available.', '#d4736b'))
      } else if (turn.status === 'failed') {
        log.append(line(`The model could not answer: ${turn.message ?? 'unknown failure'}`, '#d4736b'))
      } else {
        if (turn.text !== undefined && turn.text !== '') {
          say('agent', turn.text)
        }
        if (turn.status === 'budget-exhausted' && turn.message !== undefined) {
          log.append(line(turn.message, '#d4a96b'))
        }
        const usage = turn.usage
        if (usage?.inputTokens !== undefined) {
          log.append(
            line(
              `${turn.steps ?? 0} steps, ${usage.inputTokens} in / ${usage.outputTokens ?? 0} out tokens`,
              '#6b7a70',
            ),
          )
        }
      }
    } catch (error) {
      thinking.remove()
      log.append(line(`Studio could not reach the chat: ${String(error)}`, '#d4736b'))
    } finally {
      send.disabled = false
      log.scrollTop = log.scrollHeight
    }
  }

  send.addEventListener('click', () => void ask())
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      void ask()
    }
  })

  void (async () => {
    try {
      showAvailability(await availability())
    } catch {
      status.textContent = 'The chat endpoint is not reachable in this session.'
    }
  })()
}

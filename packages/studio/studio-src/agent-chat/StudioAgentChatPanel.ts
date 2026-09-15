import { Text } from '@shared/core'
// Studio agent chat: the hosted-model conversation inside the Agent rail panel. Plain DOM, styled by the
// shared Studio sheet so it reads like the rest of the workbench; the point is still to make the flow
// observable, and every card here says what the model did or wants to do.

import { StudioApiClient } from '../client/StudioApiClient'

type Availability = {
  configured: boolean
  enabled: boolean
  provider: string
  model: string
  reason?: string
}

type ToolCall = { name: string; input: unknown; summary: string; resultChars: number }

type Approval = { approvalId: string; toolName: string; input: unknown; reason?: string; diff?: string }

type TurnResult = {
  status: 'complete' | 'needs-approval' | 'budget-exhausted' | 'failed' | 'unavailable'
  text?: string
  message?: string
  steps?: number
  toolCalls?: ToolCall[]
  pendingApprovals?: Approval[]
  usage?: { inputTokens?: number; outputTokens?: number }
  availability?: Availability
  codeChanges?: { granted: boolean; requests: { reason: string; missing: string }[] }
  verdict?: { status: 'held' | 'broke' | 'unknown'; heading: string; detail?: string; broke: { name: string }[] }
}

export type AgentChatHistoryItem =
  | { role: 'user'; text: string }
  | {
    role: 'assistant'
    text: string
    codeChanges?: { granted: boolean; requests: { reason: string; missing: string }[] }
    message?: string
    pendingApprovals?: Approval[]
    status?: TurnResult['status']
    steps?: number
    toolCalls?: ToolCall[]
    usage?: { inputTokens?: number; outputTokens?: number }
    verdict?: TurnResult['verdict']
  }

export type StudioAgentChatPanelHooks = {
  openDeclaration: (name: string) => Promise<void>
  /** Names the panel can turn into links: every declaration the open app has. */
  knownNames: () => readonly string[]
}

type Tone = 'error' | 'info' | 'ok' | 'quiet' | 'warn'

export function mountStudioAgentChatPanel(root: HTMLElement, hooks: StudioAgentChatPanelHooks): void {
  const panel = document.createElement('section')
  panel.className = 'studio-agent-chat'
  panel.setAttribute('aria-label', 'Studio agent chat')
  panel.innerHTML = `
    <div class="studio-agent-chat-controls">
      <select class="chat-mode studio-select" aria-label="Agent mode" title="Chat answers questions and proposes changes you approve. Scenario sets up states and tests, and must ask before touching app code.">
        <option value="chat">Chat</option>
        <option value="scenario">Scenario</option>
      </select>
      <label class="studio-switch" title="Send this project's declarations to a hosted model">
        <input class="chat-cloud" type="checkbox"> Cloud
      </label>
    </div>
    <div class="chat-status studio-agent-status" role="status"></div>
    <div class="chat-log studio-agent-log" aria-live="polite"></div>
    <div class="studio-agent-composer">
      <input class="chat-input studio-input" placeholder="Ask about this app…" aria-label="Ask the agent">
      <button class="chat-send studio-button" data-variant="primary" type="button">Ask</button>
    </div>
  `
  root.append(panel)

  const cloud = panel.querySelector<HTMLInputElement>('.chat-cloud')!
  const status = panel.querySelector<HTMLElement>('.chat-status')!
  const log = panel.querySelector<HTMLElement>('.chat-log')!
  const input = panel.querySelector<HTMLInputElement>('.chat-input')!
  const send = panel.querySelector<HTMLButtonElement>('.chat-send')!
  const mode = panel.querySelector<HTMLSelectElement>('.chat-mode')!

  function line(text: string, tone: Tone = 'quiet'): HTMLElement {
    const element = document.createElement('div')
    element.className = 'studio-agent-line'
    element.dataset['tone'] = tone
    element.textContent = text
    return element
  }

  function say(role: 'you' | 'agent', text: string): HTMLElement {
    const block = document.createElement('div')
    block.className = 'studio-agent-message'
    block.dataset['role'] = role
    const who = document.createElement('div')
    who.className = 'studio-agent-who'
    who.textContent = role === 'you' ? 'You' : 'Tao'
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
    wrapper.className = 'studio-agent-text'
    const names = [...hooks.knownNames()].filter(name => name.length > 2).sort((a, b) => b.length - a.length)
    if (names.length === 0) {
      wrapper.textContent = text
      return wrapper
    }
    const pattern = new RegExp(
      `\\b(${names.map(Text.escapeRegExp).join('|')})\\b`,
      'g',
    )
    let index = 0
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0
      if (at > index) {
        wrapper.append(document.createTextNode(text.slice(index, at)))
      }
      const link = document.createElement('a')
      link.className = 'studio-agent-link'
      link.href = '#'
      link.textContent = match[0]
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
    box.className = 'studio-agent-tools'
    const heading = document.createElement('summary')
    heading.textContent = `${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}`
    box.append(heading)
    for (const call of calls) {
      const row = document.createElement('div')
      const name = document.createElement('span')
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
    status.textContent = state.reason
      ?? `Answering with ${state.model}. This app's declarations and, when the model looks something up, excerpts of Tao's own spec are sent.`
    status.dataset['state'] = state.enabled ? 'on' : 'off'
  }

  function card(tone: Tone, heading: string): HTMLElement {
    const box = document.createElement('div')
    box.className = 'studio-agent-card'
    box.dataset['tone'] = tone
    const title = document.createElement('strong')
    title.textContent = heading
    box.append(title)
    return box
  }

  function button(label: string, variant: 'ghost' | 'primary' | 'secondary'): HTMLButtonElement {
    const element = document.createElement('button')
    element.className = 'studio-button'
    element.dataset['size'] = 'small'
    element.dataset['variant'] = variant
    element.type = 'button'
    element.textContent = label
    return element
  }

  /**
   * An approval card is the moment a person decides. It shows the change itself, not the arguments that
   * produced it, because approving an argument list is not consent to a diff nobody has read.
   */
  function askApproval(approvals: readonly Approval[]): void {
    const box = card(
      'warn',
      approvals.length === 1
        ? 'The agent wants to change your app'
        : `The agent wants to make ${approvals.length} changes`,
    )
    for (const approval of approvals) {
      box.append(line(`${approval.toolName}${approval.reason === undefined ? '' : `: ${approval.reason}`}`))
      if (approval.diff !== undefined) {
        const parts = approval.diff.split(/\n\n(?=--- )/)
        for (const part of parts) {
          const diff = document.createElement('pre')
          diff.textContent = part
          box.append(diff)
        }
      }
    }
    const buttons = document.createElement('div')
    buttons.className = 'studio-agent-card-actions'
    const approve = button('Apply it', 'primary')
    const decline = button('No', 'secondary')
    buttons.append(approve, decline)
    box.append(buttons)
    log.append(box)
    log.scrollTop = log.scrollHeight

    const answer = (approved: boolean) => {
      approve.disabled = true
      decline.disabled = true
      buttons.replaceChildren(line(approved ? 'You approved it.' : 'You declined.'))
      void resume(approvals.map(approval => ({ approvalId: approval.approvalId, approved })))
    }
    approve.addEventListener('click', () => answer(true))
    decline.addEventListener('click', () => answer(false))
  }

  async function resume(responses: { approvalId: string; approved: boolean }[]): Promise<void> {
    send.disabled = true
    const live = liveTurn()
    live.tool('continuing')
    try {
      const turn = await StudioApiClient.agentChatStream<TurnResult>('respond', { responses }, event => {
        if (event.type === 'text' && event.text !== undefined) {
          live.text(event.text)
        } else if (event.type === 'tool' && event.name !== undefined) {
          live.tool(event.name)
        }
      })
      live.done()
      show(turn)
    } catch (error) {
      live.done()
      log.append(line(`Studio could not continue: ${String(error)}`, 'error'))
    } finally {
      send.disabled = false
      log.scrollTop = log.scrollHeight
    }
  }

  mode.addEventListener('change', () => {
    void (async () => {
      await StudioApiClient.agentChat('mode', { mode: mode.value })
      log.replaceChildren()
      log.append(
        line(
          mode.value === 'scenario'
            ? 'Scenario mode: the agent can add scenarios and tests. It must ask before changing app code.'
            : 'Chat mode: ask anything, and the agent can propose changes you approve before they land.',
        ),
      )
    })()
  })

  cloud.addEventListener('change', () => {
    void (async () => {
      showAvailability(await StudioApiClient.agentChat<Availability>('enable', { enabled: cloud.checked }))
    })()
  })

  /**
   * A block that grows while the model is still producing. It shows the answer as it arrives and the tools as
   * they are called, so a turn that takes many seconds looks like work rather than a hang.
   */
  function liveTurn(): { text: (chunk: string) => void; tool: (name: string) => void; done: () => string } {
    const block = document.createElement('div')
    block.className = 'studio-agent-message'
    block.dataset['role'] = 'agent'
    const who = document.createElement('div')
    who.className = 'studio-agent-who'
    who.textContent = 'Tao'
    const body = document.createElement('div')
    body.className = 'studio-agent-text'
    block.append(who, body)
    log.append(block)
    let text = ''
    let working: HTMLElement | undefined
    return {
      done: () => {
        working?.remove()
        block.remove()
        return text
      },
      text: chunk => {
        working?.remove()
        working = undefined
        text += chunk
        body.textContent = text
        log.scrollTop = log.scrollHeight
      },
      tool: name => {
        working?.remove()
        working = line(`· ${name}…`)
        block.append(working)
        log.scrollTop = log.scrollHeight
      },
    }
  }

  function show(turn: TurnResult): void {
    showToolCalls(turn.toolCalls ?? [])
    if (turn.status === 'unavailable') {
      if (turn.availability !== undefined) {
        showAvailability(turn.availability)
      }
      log.append(line(turn.availability?.reason ?? 'The chat is not available.', 'error'))
      return
    }
    if (turn.status === 'failed') {
      log.append(line(`The model could not answer: ${turn.message ?? 'unknown failure'}`, 'error'))
      return
    }
    if (turn.text !== undefined && turn.text !== '') {
      say('agent', turn.text)
    }
    if (turn.status === 'budget-exhausted' && turn.message !== undefined) {
      log.append(line(turn.message, 'warn'))
    }
    const usage = turn.usage
    if (usage?.inputTokens !== undefined) {
      log.append(
        line(`${turn.steps ?? 0} steps, ${usage.inputTokens} in / ${usage.outputTokens ?? 0} out tokens`),
      )
    }
    if (turn.status === 'needs-approval' && (turn.pendingApprovals ?? []).length > 0) {
      askApproval(turn.pendingApprovals ?? [])
    }
    if (turn.verdict !== undefined) {
      showVerdict(turn.verdict)
    }
    const codeChanges = turn.codeChanges
    if (codeChanges !== undefined && !codeChanges.granted && codeChanges.requests.length > 0) {
      askCodeChanges(codeChanges.requests[codeChanges.requests.length - 1]!)
    }
  }

  /** The app's own tests on a change that landed. This is the only thing here that can contradict the agent. */
  function showVerdict(verdict: NonNullable<TurnResult['verdict']>): void {
    const tone: Tone = verdict.status === 'broke' ? 'error' : verdict.status === 'held' ? 'ok' : 'quiet'
    const box = card(tone, verdict.heading)
    if (verdict.detail !== undefined) {
      box.append(line(verdict.detail))
    }
    for (const broken of verdict.broke) {
      box.append(line(`· ${broken.name}`, 'error'))
    }
    log.append(box)
  }

  /**
   * The agent has said the state asked for cannot be set up without changing the app. That is a different
   * request from the one that was made, so it is put to the person rather than assumed.
   */
  function askCodeChanges(request: { reason: string; missing: string }): void {
    const box = card('info', 'This also needs the app itself to change')
    box.append(line(`Missing: ${request.missing}`), line(`Why: ${request.reason}`))
    const allow = button('Allow app changes in this conversation', 'secondary')
    box.append(allow)
    log.append(box)
    log.scrollTop = log.scrollHeight
    allow.addEventListener('click', () => {
      allow.disabled = true
      void (async () => {
        await StudioApiClient.agentChat('grant-code-changes', {})
        box.append(line('Allowed. Ask the agent to continue.', 'ok'))
      })()
    })
  }

  async function ask(): Promise<void> {
    const question = input.value.trim()
    if (question === '') {
      return
    }
    input.value = ''
    say('you', question)
    send.disabled = true
    const live = liveTurn()
    live.tool('thinking')
    try {
      const turn = await StudioApiClient.agentChatStream<TurnResult>('send', { message: question }, event => {
        if (event.type === 'text' && event.text !== undefined) {
          live.text(event.text)
        } else if (event.type === 'tool' && event.name !== undefined) {
          live.tool(event.name)
        }
      })
      // The streamed text is replaced by the finished rendering, which links every declaration it names.
      live.done()
      show(turn)
    } catch (error) {
      live.done()
      log.append(line(`Studio could not reach the chat: ${String(error)}`, 'error'))
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

  function restoreHistory(items: readonly AgentChatHistoryItem[], serverMode?: 'chat' | 'scenario'): void {
    if (serverMode !== undefined && mode.value !== serverMode) {
      mode.value = serverMode
    }
    log.replaceChildren()
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      if (item.role === 'user') {
        say('you', item.text)
      } else {
        const isLatest = i === items.length - 1
        showToolCalls(item.toolCalls ?? [])
        if (item.status === 'unavailable') {
          log.append(line(item.message ?? 'The chat is not available.', 'error'))
          continue
        }
        if (item.status === 'failed') {
          log.append(line(`The model could not answer: ${item.message ?? 'unknown failure'}`, 'error'))
          continue
        }
        if (item.text !== undefined && item.text !== '') {
          say('agent', item.text)
        }
        if (item.status === 'budget-exhausted' && item.message !== undefined) {
          log.append(line(item.message, 'warn'))
        }
        const usage = item.usage
        if (usage?.inputTokens !== undefined) {
          log.append(
            line(`${item.steps ?? 0} steps, ${usage.inputTokens} in / ${usage.outputTokens ?? 0} out tokens`),
          )
        }
        if (item.pendingApprovals !== undefined && item.pendingApprovals.length > 0) {
          if (isLatest && item.status === 'needs-approval') {
            askApproval(item.pendingApprovals)
          } else {
            const approvals = item.pendingApprovals
            const box = card(
              'quiet',
              approvals.length === 1
                ? 'Proposed change'
                : `Proposed ${approvals.length} changes`,
            )
            for (const approval of approvals) {
              box.append(line(`${approval.toolName}${approval.reason === undefined ? '' : `: ${approval.reason}`}`))
              if (approval.diff !== undefined) {
                const parts = approval.diff.split(/\n\n(?=--- )/)
                for (const part of parts) {
                  const diff = document.createElement('pre')
                  diff.textContent = part
                  box.append(diff)
                }
              }
            }
            log.append(box)
          }
        }
        if (item.verdict !== undefined) {
          showVerdict(item.verdict)
        }
        const codeChanges = item.codeChanges
        if (codeChanges !== undefined && !codeChanges.granted && codeChanges.requests.length > 0) {
          if (isLatest) {
            askCodeChanges(codeChanges.requests[codeChanges.requests.length - 1]!)
          }
        }
      }
    }
    log.scrollTop = log.scrollHeight
  }

  void (async () => {
    try {
      showAvailability(await availability())
      const historyResponse = await StudioApiClient.agentChat<{
        history?: readonly AgentChatHistoryItem[]
        mode?: 'chat' | 'scenario'
      }>('history', {})
      if (historyResponse.history && historyResponse.history.length > 0) {
        restoreHistory(historyResponse.history, historyResponse.mode)
      } else if (historyResponse.mode !== undefined && mode.value !== historyResponse.mode) {
        mode.value = historyResponse.mode
      }
    } catch {
      status.textContent = 'The chat endpoint is not reachable in this session.'
    }
  })()
}

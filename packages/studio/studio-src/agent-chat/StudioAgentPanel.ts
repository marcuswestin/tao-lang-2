// Studio agent: one floating surface for both agents.
//
// There were two panels, one pinned to each bottom corner, and they competed for the same attention while
// covering opposite sides of the preview. They are different engines — one hosted, one on-device — but they
// are one feature to the person using them, so they share a shell, a position, and a collapse, and a tab
// decides which is on screen.

import { mountStudioAgentPocPanel, type StudioAgentPocPanelHooks } from '../agent-poc/StudioAgentPocPanel'
import { mountStudioAgentChatPanel, type StudioAgentChatPanelHooks } from './StudioAgentChatPanel'

export type StudioAgentPanelHooks = {
  chat: StudioAgentChatPanelHooks
  poc: StudioAgentPocPanelHooks
}

const SHELL =
  'position:fixed;left:12px;bottom:12px;width:520px;max-height:78vh;display:flex;flex-direction:column;background:#151a17;color:#e8ede9;border:1px solid #3a4a3f;border-radius:10px;padding:10px 12px;font:12px/1.45 ui-monospace,Menlo,monospace;z-index:9000;box-shadow:0 8px 24px rgba(0,0,0,.4)'

const TAB_BASE =
  'background:transparent;color:#9fb3a5;border:1px solid transparent;border-radius:6px;padding:2px 8px;font:inherit;cursor:pointer'
const TAB_ACTIVE =
  'background:#0f1411;color:#e8ede9;border:1px solid #3a4a3f;border-radius:6px;padding:2px 8px;font:inherit;cursor:pointer'

export function mountStudioAgentPanel(root: HTMLElement, hooks: StudioAgentPanelHooks): void {
  const panel = document.createElement('section')
  panel.className = 'studio-agent-panel'
  panel.setAttribute('aria-label', 'Tao agent')
  panel.style.cssText = SHELL
  panel.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
      <strong style="margin-right:2px">Agent</strong>
      <button class="agent-tab-chat" type="button" title="A hosted model, working through Studio's tools">chat</button>
      <button class="agent-tab-poc" type="button" title="The on-device proof of concept, through Apple Foundation Models">on-device</button>
      <span style="flex:1"></span>
      <button class="agent-collapse" type="button" title="Collapse">–</button>
    </div>
    <div class="agent-bodies" style="flex:1;min-height:0;overflow:auto">
      <div class="agent-body-chat" style="display:flex;flex-direction:column;min-height:0"></div>
      <div class="agent-body-poc" hidden></div>
    </div>
  `
  root.append(panel)

  const chatTab = panel.querySelector<HTMLButtonElement>('.agent-tab-chat')!
  const pocTab = panel.querySelector<HTMLButtonElement>('.agent-tab-poc')!
  const bodies = panel.querySelector<HTMLElement>('.agent-bodies')!
  const chatBody = panel.querySelector<HTMLElement>('.agent-body-chat')!
  const pocBody = panel.querySelector<HTMLElement>('.agent-body-poc')!
  const collapse = panel.querySelector<HTMLButtonElement>('.agent-collapse')!

  const select = (tab: 'chat' | 'poc') => {
    chatBody.hidden = tab !== 'chat'
    pocBody.hidden = tab !== 'poc'
    chatTab.style.cssText = tab === 'chat' ? TAB_ACTIVE : TAB_BASE
    pocTab.style.cssText = tab === 'poc' ? TAB_ACTIVE : TAB_BASE
  }
  chatTab.addEventListener('click', () => select('chat'))
  pocTab.addEventListener('click', () => select('poc'))
  select('chat')

  collapse.addEventListener('click', () => {
    const hidden = !bodies.hidden
    bodies.hidden = hidden
    collapse.textContent = hidden ? '+' : '–'
    // Collapsed, the panel is a label rather than a workspace, so it stops reserving the room for one.
    panel.style.width = hidden ? '220px' : '520px'
    panel.style.maxHeight = hidden ? 'none' : '78vh'
  })

  mountStudioAgentChatPanel(chatBody, hooks.chat)
  mountStudioAgentPocPanel(pocBody, hooks.poc)
}

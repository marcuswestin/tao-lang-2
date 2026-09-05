// Studio agent: one rail panel for both agents.
//
// The agents are different engines — one hosted, one on-device — but they are one feature to the person
// using them, so they share a panel and a tab decides which is on screen. The panel lives in the left
// column like Files or Components: the rail opens it, the pane header collapses it, and it never floats
// over the preview or the file tree.

import { mountStudioAgentPocPanel, type StudioAgentPocPanelHooks } from '../agent-poc/StudioAgentPocPanel'
import { mountStudioAgentChatPanel, type StudioAgentChatPanelHooks } from './StudioAgentChatPanel'

export type StudioAgentPanelHooks = {
  chat: StudioAgentChatPanelHooks
  poc: StudioAgentPocPanelHooks
}

export function mountStudioAgentPanel(root: HTMLElement, hooks: StudioAgentPanelHooks): void {
  const host = root.querySelector<HTMLElement>('.studio-agent-host') ?? root
  const panel = document.createElement('section')
  panel.className = 'studio-agent-panel'
  panel.setAttribute('aria-label', 'Tao agent')
  panel.innerHTML = `
    <div class="studio-agent-tabs">
      <div class="studio-segmented" data-size="small" role="tablist" aria-label="Agent engine">
        <button class="agent-tab-chat" type="button" role="tab" aria-selected="true" title="A hosted model, working through Studio's tools">Chat</button>
        <button class="agent-tab-poc" type="button" role="tab" aria-selected="false" title="The on-device proof of concept, through Apple Foundation Models">On-device</button>
      </div>
    </div>
    <div class="agent-bodies studio-agent-bodies">
      <div class="agent-body-chat"></div>
      <div class="agent-body-poc" hidden></div>
    </div>
  `
  host.append(panel)

  const chatTab = panel.querySelector<HTMLButtonElement>('.agent-tab-chat')!
  const pocTab = panel.querySelector<HTMLButtonElement>('.agent-tab-poc')!
  const chatBody = panel.querySelector<HTMLElement>('.agent-body-chat')!
  const pocBody = panel.querySelector<HTMLElement>('.agent-body-poc')!

  const select = (tab: 'chat' | 'poc') => {
    chatBody.hidden = tab !== 'chat'
    pocBody.hidden = tab !== 'poc'
    chatTab.setAttribute('aria-selected', String(tab === 'chat'))
    pocTab.setAttribute('aria-selected', String(tab === 'poc'))
  }
  chatTab.addEventListener('click', () => select('chat'))
  pocTab.addEventListener('click', () => select('poc'))
  select('chat')

  mountStudioAgentChatPanel(chatBody, hooks.chat)
  mountStudioAgentPocPanel(pocBody, hooks.poc)
}

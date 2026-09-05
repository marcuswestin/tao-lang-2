// Studio agent: the rail panel that hosts the agent chat. It lives in the left column like Files or
// Components: the rail opens it, the pane header collapses it, and it never floats over the preview or
// the file tree.

import { mountStudioAgentChatPanel, type StudioAgentChatPanelHooks } from './StudioAgentChatPanel'

export function mountStudioAgentPanel(root: HTMLElement, hooks: StudioAgentChatPanelHooks): void {
  const host = root.querySelector<HTMLElement>('.studio-agent-host') ?? root
  const panel = document.createElement('section')
  panel.className = 'studio-agent-panel'
  panel.setAttribute('aria-label', 'Tao agent')
  host.append(panel)
  mountStudioAgentChatPanel(panel, hooks)
}

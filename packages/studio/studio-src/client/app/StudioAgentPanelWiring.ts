import { mountStudioAgentPanel } from '../../agent-chat/StudioAgentPanel'
import { StudioApiClient } from '../StudioApiClient'

/** The agent chat panel: it knows the project's declared names and can open the file declaring one. */
export function mountStudioAgentChat(
  root: HTMLElement,
  openFile: (path: string, refresh: true) => Promise<unknown>,
): void {
  let chatNames: readonly string[] = []
  mountStudioAgentPanel(root, {
    knownNames: () => chatNames,
    openDeclaration: async name => {
      const found = await StudioApiClient.agentChat<{ found: boolean; path?: string; line?: number }>('locate', {
        name,
      })
      if (found.found && found.path !== undefined) {
        await openFile(found.path, true)
      }
    },
  })
  void (async () => {
    try {
      chatNames = (await StudioApiClient.agentChat<{ names: string[] }>('names', {})).names
    } catch {
      chatNames = []
    }
  })()
}

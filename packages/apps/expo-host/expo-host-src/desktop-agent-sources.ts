/** Sources compiled by the pinned desktop SDK, rather than by the Expo web export. */
export const agentRPCSchemaSource = String.raw`
import type { RPCSchema } from 'electrobun/view'
export type Reply = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }
export type AgentRPC = {
  bun: RPCSchema<{ requests: { ready: { params: { error?: string }; response: void } } }>
  webview: RPCSchema<{ requests: { invoke: { params: { method: 'commands' | 'run' | 'drain'; params?: unknown }; response: Reply } } }>
}
`

export const agentRendererSource = String.raw`
import { Electroview } from 'electrobun/view'
import type { AgentRPC, Reply } from '../agent-rpc'
type AgentAPI = {
  ready(): Promise<void>
  commands(): unknown
  run(commandId: string, args: unknown): Promise<{ outcome: string }>
  drain(): Promise<void>
}
const page = globalThis as typeof globalThis & { __TAO_AGENT__?: AgentAPI; __TAO_AGENT_BRIDGE__?: boolean }
if (!page.__TAO_AGENT_BRIDGE__) {
  page.__TAO_AGENT_BRIDGE__ = true
  const rpc = Electroview.defineRPC<AgentRPC>({
    maxRequestTime: Infinity,
    handlers: { requests: { invoke: async ({ method, params }): Promise<Reply> => {
      try {
        const agent = page.__TAO_AGENT__
        if (!agent) return { ok: false, error: { code: 'app_unavailable', message: 'The app command runtime is not mounted.' } }
        if (method === 'drain') { await agent.drain(); return { ok: true, result: null } }
        await agent.ready()
        if (method === 'commands') return { ok: true, result: agent.commands() }
        if (typeof params !== 'object' || params === null || typeof (params as any).commandId !== 'string') {
          return { ok: false, error: { code: 'invalid_params', message: 'Run requires commandId and named JSON args.' } }
        }
        const { commandId, args } = params as { commandId: string; args: unknown }
        const receipt = await agent.run(commandId, args)
        return receipt.outcome === 'committed' ? { ok: true, result: receipt } : {
          ok: false, error: { code: receipt.outcome, message: 'The app command ' + receipt.outcome + '.', details: receipt },
        }
      } catch (error) {
        return { ok: false, error: { code: 'command_rejected', message: error instanceof Error ? error.message : String(error) } }
      }
    } } },
  })
  new Electroview({ rpc })
  void (async () => {
    try {
      const deadline = Date.now() + 20000
      while (!page.__TAO_AGENT__) {
        if (Date.now() >= deadline) {
          await rpc.request.ready({ error: 'The Tao app did not mount its command runtime within 20 seconds.' })
          return
        }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      await page.__TAO_AGENT__.ready()
      await rpc.request.ready({})
    } catch (error) {
      await rpc.request.ready({ error: error instanceof Error ? error.message : String(error) })
    }
  })()
}
`

export function agentMainSource(manifest: unknown): string {
  return String.raw`
import { BrowserWindow, BrowserView, Utils } from 'electrobun/main'
import { startDesktopAgentHost } from './agent-host.js'
import type { AgentRPC } from '../agent-rpc'
const manifest = ${JSON.stringify(manifest)}
const background = Bun.env.TAO_AGENT_MODE === '1'
let state: 'absent' | 'starting' | 'ready' | 'failed' = 'absent'
let initialization: Promise<void> | undefined
let window: BrowserWindow | undefined
let acceptReady: (() => void) | undefined
let rejectReady: ((error: Error) => void) | undefined
const rpc = BrowserView.defineRPC<AgentRPC>({
  maxRequestTime: Infinity,
  handlers: { requests: { ready: ({ error }) => {
    if (state === 'failed') return
    if (error) { state = 'failed'; rejectReady?.(host.environmentError(error)) }
    else { state = 'ready'; acceptReady?.() }
  } } },
})
const host = await startDesktopAgentHost({
  manifest, siteRoot: import.meta.dir + '/../site',
  shutdown: () => Utils.quit(),
  renderer: {
    status: () => state,
    request: async (method, params) => {
      await initialize()
      return await rpc.request.invoke({ method, params })
    },
    drain: async () => {
      if (state === 'absent' || state === 'failed') return
      await initialization
      const result = await rpc.request.invoke({ method: 'drain' })
      if (!result.ok) throw host.environmentError(result.error.message)
    },
  },
})
function initialize(): Promise<void> {
  if (initialization) return initialization
  state = 'starting'
  initialization = (async () => {
    const preload = await Bun.file(import.meta.dir + '/../views/agent/index.js').text()
    let timeout: ReturnType<typeof setTimeout>
    const ready = new Promise<void>((resolve, reject) => {
      acceptReady = resolve
      rejectReady = reject
      timeout = setTimeout(() => reject(host.environmentError('The hidden app or its stores did not become ready within 20 seconds.')), 20000)
    })
    try {
      window = new BrowserWindow({ title: manifest.appName, url: host.origin, rpc,
        preload, hidden: background, activate: !background,
        frame: { x: 120, y: 100, width: 1200, height: 800 },
      })
      window.on('close', () => {
        state = 'failed'
        rejectReady?.(host.environmentError('The app window was closed.'))
        void host.close().finally(() => Utils.quit())
      })
      await ready
    } finally { clearTimeout(timeout!) }
  })().catch(error => { state = 'failed'; throw error })
  return initialization
}
if (!background) void initialize().catch(host.reportError)
`
}

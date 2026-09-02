// Semantic agent proof of concept: the Studio endpoint. One handler, a switch on the sub-path.
import { FS } from '@shared'
import type { StudioProjectSession } from '../StudioProjectSession'
import { askQuestion, reviewView } from './AgentPocRun'
import { buildSemanticSnapshot, fieldStory, inspect, overview, type SemanticSnapshot, snapshotToJson, trace } from './SemanticSnapshot'

type Json = Record<string, unknown>

async function snapshotFor(session: StudioProjectSession): Promise<SemanticSnapshot> {
  const parsed = await session.agentPocParse()
  return buildSemanticSnapshot(session.projectRoot, session.appName, parsed.files, parsed.diagnostics)
}

/** renderIdToSnapshotId maps Studio's `<abs path>:<start>:<end>` render id to the snapshot's relative form. */
function renderIdToSnapshotId(session: StudioProjectSession, renderId: string | undefined): string | undefined {
  if (renderId === undefined) {
    return undefined
  }
  const match = /^(.*):(\d+):(\d+)$/.exec(renderId)
  if (match === null) {
    return undefined
  }
  const path = FS.relativePath(session.projectRoot, match[1]!)
  return `render:${path}:${match[2]}:${match[3]}`
}

export const AgentPoc = {
  async handle(session: StudioProjectSession, command: string, body: Json): Promise<unknown> {
    const snapshot = await snapshotFor(session)
    switch (command) {
      case 'overview':
        return overview(snapshot)
      case 'inspect':
        return inspect(snapshot, String(body['target'] ?? ''))
      case 'trace':
        return trace(snapshot, String(body['target'] ?? ''), String(body['relationship'] ?? ''))
      case 'field':
        return fieldStory(snapshot, String(body['target'] ?? ''))
      case 'snapshot':
        return snapshotToJson(snapshot)
      case 'review': {
        const renderId = renderIdToSnapshotId(session, typeof body['renderId'] === 'string' ? body['renderId'] : undefined)
        const render = renderId === undefined ? undefined : snapshot.nodes.get(renderId)
        const viewName = typeof body['viewName'] === 'string' && body['viewName'] !== ''
          ? body['viewName']
          : render === undefined
          ? 'DocumentEditor'
          : String(render.detail?.['owner'])
        const result = await reviewView(snapshot, {
          ...(typeof body['focus'] === 'string' ? { focus: body['focus'] } : {}),
          ...(renderId === undefined ? {} : { renderId }),
          ...(typeof body['scenario'] === 'string' ? { scenario: body['scenario'] } : {}),
          viewName,
        })
        const design = snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to.replace('design:', '')
        const designNode = design === undefined ? undefined : snapshot.nodes.get(`design:${design}`)
        return { ...result, designName: design, designPath: designNode?.path, viewName }
      }
      case 'ask': {
        const files = await Promise.all((await session.files()).map(async file => ({
          content: (await session.readFile(file.path)).content,
          path: file.path,
        })))
        return await askQuestion(snapshot, String(body['question'] ?? ''), body['mode'] === 'source' ? 'source' : 'semantic', files)
      }
      default:
        return { error: `Unknown agent PoC command: ${command}` }
    }
  },
} as const

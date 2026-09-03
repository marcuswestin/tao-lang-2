// Semantic agent proof of concept: the Studio endpoint. One handler, a switch on the sub-path.
import { FS } from '@shared'
import { StudioProjectSession } from '../StudioProjectSession'
import { askQuestion, reviewView } from './AgentPocRun'
import { planFeature } from './FeaturePlan'
import {
  buildSemanticSnapshot,
  fieldStory,
  inspect,
  overview,
  type SemanticSnapshot,
  snapshotToJson,
  trace,
} from './SemanticSnapshot'

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

/**
 * normalizeChange resolves the model's bundle operand against Tao facts: the bundle must be a member of the
 * app's design; when the model wrote the design name or a prefixed id, the bundle named in its own text is used.
 * The resolution is recorded so the panel can show it was Tao, not the model, that fixed the operand.
 */
function normalizeChange(
  snapshot: SemanticSnapshot,
  design: string,
  viewName: string,
  change: Json,
  findings: { text: string }[],
): Json {
  const original = String(change['bundle'] ?? '')
  const members = [...snapshot.nodes.values()].filter(n => n.kind === 'bundle' && n.detail?.['design'] === design).map(
    n => n.name,
  )
  const viewStyles = [
    ...new Set(
      snapshot.edges.filter(e =>
        e.rel === 'styled-by' && String((snapshot.nodes.get(e.from)?.detail ?? {})['owner']) === viewName
      )
        .map(e => snapshot.nodes.get(e.to)?.name ?? ''),
    ),
  ]
  const stripped = original.replace(/^bundle:/, '').replace(new RegExp(`^${design}\\.`), '')
  let resolved: string | undefined = members.includes(stripped) ? stripped : undefined
  let note = resolved === undefined ? '' : `bundle ${stripped} is a member of ${design}`
  if (resolved === undefined) {
    const text = [String(change['rationale'] ?? ''), ...findings.map(f => f.text)].join(' ')
    const mentioned = viewStyles.find(name => text.includes(name))
      ?? members.find(name => new RegExp(`\\b${name}\\b`).test(text))
    if (mentioned !== undefined) {
      resolved = mentioned
      note = `model wrote "${original}", which is not a bundle; its own text names ${mentioned}`
    }
  }
  if (resolved === undefined) {
    return {
      original,
      resolved: undefined,
      note: `"${original}" is not a member of ${design} and no bundle is named in the model's text`,
      viewStyles,
    }
  }
  change['bundle'] = resolved
  // A value equal to the current one is not a change; say so instead of producing a reordering edit.
  const entries =
    ((snapshot.nodes.get(`bundle:${design}.${resolved}`)?.detail ?? {})['entries'] as string[] | undefined)
      ?? []
  const key = String(change['key'] ?? '')
  const current = entries.find(entry => entry.split(' ')[0] === key)
  const requested = `${key} ${String(change['value'] ?? '')}`
  if (current === requested) {
    return {
      original,
      resolved: undefined,
      note: `${resolved} already has ${current}; the model requested no change (no-op rejected)`,
      viewStyles,
    }
  }
  return {
    current,
    original,
    resolved,
    note: `${note}${current === undefined ? '' : `; current ${current}`}`,
    usedByThisView: viewStyles.includes(resolved),
    viewStyles,
  }
}

export const AgentPoc = {
  async handle(session: StudioProjectSession, command: string, body: Json): Promise<unknown> {
    const snapshot = await snapshotFor(session)
    if (command === 'overview') {
      return overview(snapshot)
    }
    if (command === 'inspect') {
      return inspect(snapshot, String(body['target'] ?? ''))
    }
    if (command === 'trace') {
      return trace(snapshot, String(body['target'] ?? ''), String(body['relationship'] ?? ''))
    }
    if (command === 'field') {
      return fieldStory(snapshot, String(body['target'] ?? ''))
    }
    if (command === 'snapshot') {
      return snapshotToJson(snapshot)
    }
    if (command === 'review') {
      const renderId = renderIdToSnapshotId(
        session,
        typeof body['renderId'] === 'string' ? body['renderId'] : undefined,
      )
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
      const design = snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to
        .replace('design:', '')
      const designNode = design === undefined ? undefined : snapshot.nodes.get(`design:${design}`)
      const value = result.value as { change?: Json; findings?: { text: string }[] } | undefined
      const normalization = value?.change === undefined || design === undefined
        ? undefined
        : normalizeChange(snapshot, design, viewName, value.change, value.findings ?? [])
      return { ...result, designName: design, designPath: designNode?.path, normalization, viewName }
    }
    if (command === 'plan-feature') {
      const plan = await planFeature(
        snapshot,
        String(body['request'] ?? ''),
        async path => (await session.readFile(path)).content,
      )
      return {
        ...plan,
        edits: plan.edits.map(edit => ({
          ...edit,
          diff: StudioProjectSession.testing.sourceActionProposalDiff(edit.path, edit.before, edit.after),
        })),
      }
    }
    if (command === 'apply-feature') {
      const edits = (body['edits'] as { path: string; after: string }[]).map(edit => ({
        content: edit.after,
        path: edit.path,
      }))
      return await session.applyAgentPocFiles({
        edits,
        writeId: `agent-poc-feature:${String(body['writeId'] ?? crypto.randomUUID())}`,
      })
    }
    if (command === 'undo-feature') {
      return await session.undoAgentPocFiles(`agent-poc-feature-undo:${crypto.randomUUID()}`)
    }
    if (command === 'ask') {
      const files = await Promise.all((await session.files()).map(async file => ({
        content: (await session.readFile(file.path)).content,
        path: file.path,
      })))
      return await askQuestion(
        snapshot,
        String(body['question'] ?? ''),
        body['mode'] === 'source' ? 'source' : 'semantic',
        files,
      )
    }
    return { error: `Unknown agent PoC command: ${command}` }
  },
} as const

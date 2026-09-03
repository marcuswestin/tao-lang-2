// Semantic agent proof of concept: "add a feature by describing it".
//
// The model decides the feature's shape (entity, field, kind, label, scenario name). Tao decides every
// placement from the semantic snapshot by copying the pattern of an analogous existing field, and lowers the
// plan into formatted source edits across the data, view, and entry files. Only yes/no fields lower; other
// kinds produce an honest unsupported step. Nothing here is a production change model.
import Formatter from '@formatter'
import { type AgentRunResult, runAgentJob } from './AgentPocRun'
import { type SemanticSnapshot, type SnapshotNode } from './SemanticSnapshot'

type Json = Record<string, unknown>

export type FeatureShape = {
  featureName: string
  entity: string
  fieldName: string
  fieldKind: 'yes/no' | 'text' | 'number'
  label: string
  presentIn: string
  scenarioName: string
  summary: string
}

export type PlanStep = {
  file: string
  action: string
  decidedBy: 'model' | 'tao' | 'poc-hard-coded'
  evidence: string[]
  status: 'ready' | 'unsupported'
  note?: string
}

export type FeatureEdit = { path: string; before: string; after: string }

export type FeaturePlan = {
  shape: FeatureShape
  steps: PlanStep[]
  edits: FeatureEdit[]
  packet: Json
  model: AgentRunResult
  problems: string[]
}

type ReadFile = (path: string) => Promise<string>

function detail(node: SnapshotNode | undefined): Json {
  return (node?.detail ?? {}) as Json
}

/** analogies lists, per entity, the yes/no fields that already have the full write + present pattern. */
function analogies(snapshot: SemanticSnapshot): Json[] {
  const result: Json[] = []
  for (const field of [...snapshot.nodes.values()].filter(n => n.kind === 'field' && detail(n)['type'] === 'yes/no')) {
    const writers = snapshot.edges.filter(e => e.rel === 'writes' && e.to === field.id).map(e => e.from)
    const reads = snapshot.edges.filter(e => e.rel === 'reads' && e.to === field.id && e.from.startsWith('view:'))
    for (const read of reads) {
      const render = innermostRender(snapshot, read.evidence)
      if (render !== undefined && writers.length > 0) {
        result.push({
          field: field.id,
          presentedIn: read.from,
          render: render.name,
          renderId: render.id,
          writtenBy: writers[0],
        })
      }
    }
  }
  return result
}

function innermostRender(snapshot: SemanticSnapshot, evidence: string): SnapshotNode | undefined {
  const match = /^src:(.+):(\d+)-(\d+)$/.exec(evidence)
  if (match === null) {
    return undefined
  }
  const [path, start] = [match[1]!, Number(match[2])]
  return [...snapshot.nodes.values()]
    .filter(n => n.kind === 'render' && n.path === path && n.start! <= start && n.end! >= start)
    .sort((a, b) => (b.start! - a.start!))[0]
}

export function featurePacket(snapshot: SemanticSnapshot): Json {
  const entities = [...snapshot.nodes.values()].filter(n => n.kind === 'entity')
  return {
    app: snapshot.appName,
    entities: entities.map(n =>
      `${n.name}/${String(detail(n)['singular'])}: ${
        (detail(n)['fields'] as { name: string; type: string }[]).map(f => `${f.name} ${f.type}`).join(', ')
      }`
    ),
    viewsByEntity: entities.map(entity => ({
      entity: entity.name,
      views: [...snapshot.nodes.values()].filter(n =>
        n.kind === 'view' && (detail(n)['parameters'] as string[]).some(p => p.includes(`(entity ${entity.name})`))
      ).map(n => n.name),
    })),
    existingPatterns: analogies(snapshot),
    scenarioGroups: [
      ...new Set([...snapshot.nodes.values()].filter(n => n.kind === 'scenario').map(n => String(detail(n)['group']))),
    ],
  }
}

export async function planFeature(
  snapshot: SemanticSnapshot,
  request: string,
  readFile: ReadFile,
): Promise<FeaturePlan> {
  const packet = featurePacket(snapshot)
  const entityNames = [...snapshot.nodes.values()].filter(n => n.kind === 'entity').map(n => n.name)
  const viewNames = [...snapshot.nodes.values()].filter(n => n.kind === 'view').map(n => n.name)
  const model = await runAgentJob({
    call: async () => 'no tools',
    instructions: [
      'You turn a one-line feature request for a Tao app into a typed feature shape. Tao will place and write the code; you only choose the shape.',
      'Pick the entity the feature belongs to, a new CapitalizedFieldName not already in that entity, the field kind (yes/no for a flag), a short human label, the view that should present it (one that takes the entity, preferably where a similar field is presented), and a short lowercase scenario name.',
    ].join(' '),
    maxToolCalls: 0,
    outputSchema: {
      properties: {
        featureName: { description: 'Two or three words', type: 'string' },
        entity: { enum: entityNames, type: 'string' },
        fieldName: { description: 'New capitalized identifier, e.g. Archived', type: 'string' },
        fieldKind: { enum: ['yes/no', 'text', 'number'], type: 'string' },
        label: { description: 'Label shown next to the control, e.g. Archived', type: 'string' },
        presentIn: { enum: viewNames, type: 'string' },
        scenarioName: { description: 'lowercase, one word, e.g. archived', type: 'string' },
        summary: { description: 'One sentence saying what the feature does', type: 'string' },
      },
      required: ['featureName', 'entity', 'fieldName', 'fieldKind', 'label', 'presentIn', 'scenarioName', 'summary'],
      type: 'object',
    },
    prompt: `Feature request: ${request}\n\nProject facts:\n${JSON.stringify(packet)}`,
    tools: [],
  })
  const problems: string[] = []
  const shape = model.value as FeatureShape | undefined
  if (model.status !== 'ok' || shape === undefined) {
    return {
      edits: [],
      model,
      packet,
      problems: [model.message ?? 'model failure'],
      shape: shape ?? emptyShape(),
      steps: [],
    }
  }
  return { ...(await lowerFeature(snapshot, shape, readFile, problems)), model, packet, problems, shape }
}

function emptyShape(): FeatureShape {
  return {
    entity: '',
    featureName: '',
    fieldKind: 'yes/no',
    fieldName: '',
    label: '',
    presentIn: '',
    scenarioName: '',
    summary: '',
  }
}

type Edit = { start: number; end: number; replacement: string }

function applyEdits(source: string, edits: Edit[]): string {
  let result = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

export async function lowerFeature(
  snapshot: SemanticSnapshot,
  shape: FeatureShape,
  readFile: ReadFile,
  problems: string[],
): Promise<Pick<FeaturePlan, 'steps' | 'edits'>> {
  const steps: PlanStep[] = []
  const edits: FeatureEdit[] = []
  const entity = snapshot.nodes.get(`entity:${shape.entity}`)
  const chosenView = snapshot.nodes.get(`view:${shape.presentIn}`)
  if (entity === undefined || chosenView === undefined) {
    problems.push(`Unknown entity or view: ${shape.entity}, ${shape.presentIn}`)
    return { edits, steps }
  }
  const singular = String(detail(entity)['singular'])
  // The model may name the screen; the pattern usually lives in a view the screen renders. Follow `renders`
  // edges to the nearest view that already presents a yes/no field of this entity, and say so.
  const patterns = analogies(snapshot).filter(a => String(a['field']).startsWith(`field:${singular}.`))
  const candidates = [
    chosenView.id,
    ...snapshot.edges.filter(e => e.rel === 'renders' && e.from === chosenView.id).map(e => e.to),
  ]
  const viewId = candidates.find(id => patterns.some(a => a['presentedIn'] === id)) ?? chosenView.id
  const view = snapshot.nodes.get(viewId)!
  if (view.id !== chosenView.id) {
    steps.push({
      action:
        `present in ${view.name} instead of ${chosenView.name}: ${chosenView.name} renders ${view.name}, which already presents a ${singular} yes/no field`,
      decidedBy: 'tao',
      evidence: [
        snapshot.edges.find(e => e.rel === 'renders' && e.from === chosenView.id && e.to === view.id)?.evidence
          ?? view.id,
      ],
      file: view.path!,
      status: 'ready',
    })
    shape.presentIn = view.name
  }
  const fields = detail(entity)['fields'] as { name: string; type: string }[]
  if (!/^[A-Z][A-Za-z0-9]*$/.test(shape.fieldName)) {
    problems.push(`Field name is not a capitalized identifier: ${shape.fieldName}`)
  }
  if (fields.some(f => f.name === shape.fieldName)) {
    problems.push(`${singular}.${shape.fieldName} already exists`)
  }
  const parameter = (detail(view)['parameters'] as string[]).find(p => p.includes(`(entity ${shape.entity})`))?.split(
    ' ',
  )[0]
  if (parameter === undefined) {
    problems.push(`${shape.presentIn} does not take a ${singular} parameter`)
  }
  const pattern = patterns.find(a => a['presentedIn'] === view.id)
  if (pattern === undefined) {
    problems.push(`${shape.presentIn} has no existing yes/no ${singular} field to copy the pattern from`)
  }
  if (shape.fieldKind !== 'yes/no') {
    steps.push({
      action: `add ${singular}.${shape.fieldName} ${shape.fieldKind}`,
      decidedBy: 'model',
      evidence: [entity.id],
      file: entity.path!,
      note: 'this PoC lowers yes/no fields only',
      status: 'unsupported',
    })
    return { edits, steps }
  }
  if (problems.length > 0 || parameter === undefined || pattern === undefined) {
    return { edits, steps }
  }
  const F = shape.fieldName
  const analogField = snapshot.nodes.get(String(pattern['field']))!
  const analogAction = snapshot.nodes.get(String(pattern['writtenBy']))!
  const analogRender = snapshot.nodes.get(String(pattern['renderId']))!
  const actionName = `Set${F}`
  const actionOwner = analogAction.name.split('.')[0]

  // 1. Data file: the new field right after the analogous field.
  const dataBefore = await readFile(entity.path!)
  // Insert after the whole line so a trailing comment on the analogous field stays with it.
  const fieldLineEnd = dataBefore.indexOf('\n', analogField.end!)
  const dataAfter = await Formatter.formatCode(applyEdits(dataBefore, [{
    end: fieldLineEnd,
    replacement: `\n   ${F} yes / no`,
    start: fieldLineEnd,
  }]))
  edits.push({ after: dataAfter, before: dataBefore, path: entity.path! })
  steps.push({
    action: `add field ${singular}.${F} yes / no after ${analogField.name}`,
    decidedBy: 'model',
    evidence: [analogField.id, `src:${entity.path}:${analogField.start}-${analogField.end}`],
    file: entity.path!,
    status: 'ready',
  })

  // 2. View file: the action after the analogous action, the control after the analogous render.
  const viewBefore = await readFile(view.path!)
  const viewAfter = await Formatter.formatCode(applyEdits(viewBefore, [
    {
      end: analogAction.end!,
      replacement:
        `\n   action ${actionName}(Value boolean) {\n      update ${parameter} {\n         ${F}: Value\n   }  }`,
      start: analogAction.end!,
    },
    {
      end: analogRender.end!,
      replacement: `\n\n            #mark${F}\n            Checkbox(Value: ${parameter}.${F} is ${F}, Label: ${
        JSON.stringify(shape.label)
      }) {\n               on change ${actionName}\n            }`,
      start: analogRender.end!,
    },
  ]))
  edits.push({ after: viewAfter, before: viewBefore, path: view.path! })
  steps.push({
    action:
      `add action ${actionOwner}.${actionName}(Value boolean) writing ${singular}.${F}, after ${analogAction.name}`,
    decidedBy: 'tao',
    evidence: [analogAction.id, `src:${view.path}:${analogAction.start}-${analogAction.end}`],
    file: view.path!,
    status: 'ready',
  })
  steps.push({
    action:
      `render Checkbox #mark${F} bound to ${parameter}.${F} after ${analogRender.name}, invoking ${actionName} on change`,
    decidedBy: 'tao',
    evidence: [analogRender.id],
    file: view.path!,
    status: 'ready',
  })

  // 3. Entry file: a fixture row with the flag set, and a scenario rendering the view with it.
  const entryPath = [...snapshot.nodes.values()].find(n => n.kind === 'app' && n.name === snapshot.appName)?.path
  const fixture = [...snapshot.nodes.values()].find(n => n.kind === 'fixture' && n.path === entryPath)
  if (entryPath === undefined || fixture === undefined) {
    steps.push({
      action: 'add scenario',
      decidedBy: 'tao',
      evidence: [],
      file: entryPath ?? '?',
      note: 'no fixture declared in the app entry file',
      status: 'unsupported',
    })
    return { edits, steps }
  }
  const entryBefore = await readFile(entryPath)
  const fixtureText = entryBefore.slice(fixture.start, fixture.end)
  const bindings = [...fixtureText.matchAll(/(\w+) = create (\w+)/g)].map(m => ({ entity: m[2]!, handle: m[1]! }))
  const handle = `${shape.scenarioName.replace(/[^a-z0-9]/gi, '')}${singular}`.replace(/^./, c => c.toUpperCase())
  const rowFields: string[] = []
  const hardCoded: string[] = []
  for (const field of fields) {
    const node = snapshot.nodes.get(`field:${singular}.${field.name}`)
    const info = detail(node)
    if (field.name === F) {
      continue
    }
    if (info['hasDefault'] === true || info['optional'] === true) {
      continue
    }
    if (field.type === 'text') {
      rowFields.push(`${field.name}: ${JSON.stringify(`${shape.label} sample`)}`)
      hardCoded.push(`${field.name} filled with sample text`)
    } else if (field.type === 'number') {
      rowFields.push(`${field.name}: 1`)
      hardCoded.push(`${field.name} filled with 1`)
    } else if (field.type === 'relation') {
      const target = [...snapshot.nodes.values()].find(n => n.kind === 'entity' && detail(n)['singular'] === field.name)
      const existing = target === undefined
        ? undefined
        : bindings.find(b => b.entity === String(detail(target)['singular']))
      if (existing !== undefined) {
        rowFields.push(`${field.name}: ${existing.handle}`)
        hardCoded.push(`${field.name} bound to existing fixture row ${existing.handle}`)
      }
    }
  }
  rowFields.push(`${F}: true`)
  const closing = entryBefore.lastIndexOf('}', fixture.end! - 1)
  // A file-private view cannot be a scenario subject from the entry file; use the nearest visible view that
  // renders it and takes the same entity, which is the screen a person would open anyway.
  const visible = (candidate: SnapshotNode) => detail(candidate)['visibility'] !== 'file'
  const takesEntity = (candidate: SnapshotNode) =>
    (detail(candidate)['parameters'] as string[]).some(p => p.includes(`(entity ${shape.entity})`))
  const subject = visible(view)
    ? view
    : snapshot.edges.filter(e => e.rel === 'renders' && e.to === view.id).map(e => snapshot.nodes.get(e.from)!).find(
      c => visible(c) && takesEntity(c),
    )
  if (subject === undefined) {
    steps.push({
      action: 'add scenario',
      decidedBy: 'tao',
      evidence: [view.id],
      file: entryPath,
      note: `${view.name} is file-private and no visible view rendering it takes a ${singular}`,
      status: 'unsupported',
    })
    return { edits, steps }
  }
  const subjectParameter = (detail(subject)['parameters'] as string[]).find(p =>
    p.includes(`(entity ${shape.entity})`)
  )!.split(' ')[0]!
  // `create <Singular>` in the fixture resolves through the entity's imported plural declaration.
  const dataImport = /^use (.+) from @data$/m.exec(entryBefore)
  const dataImportNames = dataImport === null ? [] : dataImport[1]!.split(',').map(name => name.trim())
  const dataImportEdits: Edit[] = dataImportNames.includes(shape.entity)
    ? []
    : dataImport === null
    ? [{ end: 0, replacement: `use ${shape.entity} from @data\n`, start: 0 }]
    : [{
      end: dataImport.index + dataImport[0].length,
      replacement: `use ${[...dataImportNames, shape.entity].sort().join(', ')} from @data`,
      start: dataImport.index,
    }]
  const useLine = entryBefore.split('\n').findIndex(line => /^use .* from @ui$/.test(line))
  const alreadyImported = new RegExp(`^use .*\\b${subject.name}\\b.* from @ui$`, 'm').test(entryBefore)
  const useInsertOffset = useLine < 0 ? 0 : entryBefore.split('\n').slice(0, useLine + 1).join('\n').length + 1
  const scenario = `\nscenarios ${subject.name} ${
    JSON.stringify(shape.featureName)
  } {\n   fixture ${fixture.name}\n   device phone\n   appearance light\n   network online\n   locale "en"\n   scenario ${
    JSON.stringify(shape.scenarioName)
  } {\n      render (${subjectParameter}: ${handle})\n}  }\n`
  const entryAfter = await Formatter.formatCode(applyEdits(entryBefore, [
    { end: closing, replacement: `   ${handle} = create ${singular} { ${rowFields.join(', ')} }\n`, start: closing },
    { end: entryBefore.length, replacement: scenario, start: entryBefore.length },
    ...(alreadyImported
      ? []
      : [{ end: useInsertOffset, replacement: `use ${subject.name} from @ui\n`, start: useInsertOffset }]),
    ...dataImportEdits,
  ]))
  edits.push({ after: entryAfter, before: entryBefore, path: entryPath })
  steps.push({
    action: `add fixture row ${handle} = create ${singular} { ${rowFields.join(', ')} } to ${fixture.name}${
      dataImportEdits.length === 0 ? '' : `, importing ${shape.entity} from @data`
    }`,
    decidedBy: 'poc-hard-coded',
    evidence: [fixture.id],
    file: entryPath,
    note: hardCoded.join('; '),
    status: 'ready',
  })
  steps.push({
    action:
      `add scenarios ${subject.name} "${shape.featureName}" / "${shape.scenarioName}" rendering (${subjectParameter}: ${handle})${
        alreadyImported ? '' : `, importing ${subject.name} from @ui`
      }${subject.id === view.id ? '' : ` (${view.name} is file-private; ${subject.name} renders it)`}`,
    decidedBy: 'tao',
    evidence: [subject.id, fixture.id],
    file: entryPath,
    status: 'ready',
  })
  return { edits, steps }
}

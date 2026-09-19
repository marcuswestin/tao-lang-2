// Feature lowering: the model chooses a shape (which entity, which words, which view) and Tao decides
// every placement from the semantic snapshot, lowering the shape into formatted source edits. The
// agent-chat write tools call these; nothing here is a production change model.
import Formatter from '@formatter'
import { Errors } from '@shared'
import { type SemanticSnapshot, type SnapshotNode, type SnapshotText } from './SemanticSnapshot'

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

export type RewordShape = {
  featureName: string
  newText: string
  summary: string
  textHandle: string
}

type PlanStep = {
  file: string
  action: string
  decidedBy: 'model' | 'tao' | 'poc-hard-coded'
  evidence: string[]
  status: 'ready' | 'unsupported'
  note?: string
}

type FeatureEdit = { path: string; before: string; after: string }

type Edit = { start: number; end: number; replacement: string }

/** FeatureLowering is what a lowering hands back: the steps it decided and the edits that realise them. */
export type FeatureLowering = {
  steps: PlanStep[]
  edits: FeatureEdit[]
}

type ReadFile = (path: string) => Promise<string>

function detail(node: SnapshotNode | undefined): Json {
  return (node?.detail ?? {}) as Json
}

type FeatureFieldSample = Readonly<{ note: string; value: string }>

/**
 * The value this PoC invents for a required field of a fixture row it is writing. A field type with
 * no entry here — and a relation with no existing fixture row to point at — is left out of the row.
 */
function sampleFieldValue(
  field: Readonly<{ name: string; type: string }>,
  context: Readonly<{
    bindings: readonly Readonly<{ entity: string; handle: string }>[]
    label: string
    snapshot: SemanticSnapshot
  }>,
): FeatureFieldSample | undefined {
  const samples: Readonly<Record<string, () => FeatureFieldSample | undefined>> = {
    number: () => ({ note: 'filled with 1', value: '1' }),
    relation: () => {
      const target = [...context.snapshot.nodes.values()].find(n =>
        n.kind === 'entity' && detail(n)['singular'] === field.name
      )
      const existing = target === undefined
        ? undefined
        : context.bindings.find(b => b.entity === String(detail(target)['singular']))
      return existing === undefined
        ? undefined
        : { note: `bound to existing fixture row ${existing.handle}`, value: existing.handle }
    },
    text: () => ({ note: 'filled with sample text', value: JSON.stringify(`${context.label} sample`) }),
  }
  return samples[field.type]?.()
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

// ---- Text candidates -----------------------------------------------------------------------------

export type TextCandidate = {
  handle: string
  view: string
  path: string
  start: number
  end: number
  text: string
  renderId: string
}

/** textCandidates lists every string literal a view renders, in source order, with a short model handle. */
export function textCandidates(snapshot: SemanticSnapshot): TextCandidate[] {
  const renders = [...snapshot.nodes.values()].filter(n => n.kind === 'render' && detail(n)['texts'] !== undefined)
    .sort((a, b) => (a.path === b.path ? a.start! - b.start! : a.path!.localeCompare(b.path!)))
  const candidates: TextCandidate[] = []
  for (const render of renders) {
    for (const text of detail(render)['texts'] as SnapshotText[]) {
      candidates.push({
        end: text.end,
        handle: `T${candidates.length + 1}`,
        path: render.path!,
        renderId: render.id,
        start: text.start,
        text: text.text,
        view: String(detail(render)['owner']),
      })
    }
  }
  return candidates
}

/** interpolationsIn lists the `{ ... }` expressions of a Tao string, trimmed, in order. */
function interpolationsIn(text: string): string[] {
  return [...text.matchAll(/\{([^}]*)\}/g)].map(match => match[1]!.trim())
}

function unquote(text: string): string {
  return /^".*"$/s.test(text) ? text.slice(1, -1) : text
}

function applyEdits(source: string, edits: Edit[]): string {
  // Applying back to front keeps earlier offsets valid, but only while the ranges are disjoint. Two edits
  // that share a start offset — an inserted import line and a replaced `use` line on the same first line —
  // would otherwise apply in array order, and the second would swallow what the first just inserted.
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end)
  for (const [index, edit] of ordered.entries()) {
    const next = ordered[index + 1]
    if (next !== undefined && next.end > edit.start) {
      Errors.throwUnexpected(
        `Two edits overlap at ${edit.start}: ${JSON.stringify(next)} and ${JSON.stringify(edit)}.`,
      )
    }
  }
  let result = source
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/** mergeImportEdit adds one name to a `use ... from <module>` line, or writes the line when there is none. */
function mergeImportEdit(source: string, module: string, name: string): Edit[] {
  const line = new RegExp(`^use (.+) from ${module.replace('/', '\\/')}$`, 'm').exec(source)
  if (line === null) {
    return [{ end: 0, replacement: `use ${name} from ${module}\n`, start: 0 }]
  }
  const names = line[1]!.split(',').map(entry => entry.trim())
  if (names.includes(name)) {
    return []
  }
  return [{
    end: line.index + line[0].length,
    replacement: `use ${[...names, name].sort().join(', ')} from ${module}`,
    start: line.index,
  }]
}

// ---- Reword lowering -----------------------------------------------------------------------------

/**
 * lowerReword swaps one string literal in place. Tao checks the replacement against the original: every
 * `{ ... }` placeholder it uses must already exist in that text or name a field of the entity the view
 * takes, so a reword can rearrange what the screen says but never invent a value that would not compile.
 */
export async function lowerReword(
  snapshot: SemanticSnapshot,
  candidates: TextCandidate[],
  shape: RewordShape,
  readFile: ReadFile,
  problems: string[],
): Promise<FeatureLowering> {
  const steps: PlanStep[] = []
  const edits: FeatureEdit[] = []
  const target = candidates.find(c => c.handle === shape.textHandle)
  if (target === undefined) {
    problems.push(`${shape.textHandle} is not one of the texts this app shows`)
    return { edits, steps }
  }
  const before = unquote(target.text)
  const after = unquote(shape.newText.trim())
  if (after.includes('"')) {
    problems.push('the replacement text contains a quote, which would not parse')
    return { edits, steps }
  }
  if (after === before) {
    problems.push(`${target.view} already shows "${before}"; the model requested no change (no-op rejected)`)
    return { edits, steps }
  }
  if (after === '') {
    problems.push('the replacement text is empty')
    return { edits, steps }
  }
  // A placeholder may be one already in this text, or any field of an entity the owning view takes.
  const view = snapshot.nodes.get(`view:${target.view}`)
  const reachable = new Set(interpolationsIn(before))
  for (const parameter of (detail(view)['parameters'] as string[] | undefined) ?? []) {
    const match = /^(\w+) \(entity (\w+)\)$/.exec(parameter)
    const entity = match === null ? undefined : snapshot.nodes.get(`entity:${match[2]}`)
    for (const field of (detail(entity)['fields'] as { name: string }[] | undefined) ?? []) {
      reachable.add(`${match![1]!}.${field.name}`)
    }
  }
  const used = interpolationsIn(after)
  const invented = used.filter(expression => !reachable.has(expression))
  if (invented.length > 0) {
    problems.push(
      `the replacement uses ${invented.map(e => `{ ${e} }`).join(', ')}, which ${
        invented.length === 1 ? 'is not a value' : 'are not values'
      } ${target.view} can show`,
    )
    return { edits, steps }
  }
  const dropped = [...new Set(interpolationsIn(before))].filter(expression => !used.includes(expression))
  const source = await readFile(target.path)
  const formatted = await Formatter.formatCode(
    applyEdits(source, [{ end: target.end, replacement: JSON.stringify(after), start: target.start }]),
  )
  edits.push({ after: formatted, before: source, path: target.path })
  steps.push({
    action: `reword ${target.view}: ${target.text} → ${JSON.stringify(after)}`,
    decidedBy: 'model',
    evidence: [target.renderId, `src:${target.path}:${target.start}-${target.end}`],
    file: target.path,
    note: `every placeholder it uses resolves${
      dropped.length === 0 ? '' : `; it no longer shows ${dropped.map(e => `{ ${e} }`).join(', ')}`
    }`,
    status: 'ready',
  })
  return { edits, steps }
}

// ---- Flag lowering -------------------------------------------------------------------------------

export async function lowerFeature(
  snapshot: SemanticSnapshot,
  shape: FeatureShape,
  readFile: ReadFile,
  problems: string[],
): Promise<FeatureLowering> {
  const steps: PlanStep[] = []
  // An app may declare its entity, its view, and its entry in one file, so every placement is collected as
  // a range edit against that file's original text and the file is rewritten once. Producing one whole-file
  // edit per placement would silently drop all but the last.
  const pending = new Map<string, Edit[]>()
  const stage = (path: string, ...list: Edit[]) => pending.set(path, [...(pending.get(path) ?? []), ...list])
  const materialize = async (): Promise<FeatureLowering> => {
    const edits: FeatureEdit[] = []
    for (const [path, list] of pending) {
      const before = await readFile(path)
      edits.push({ after: await Formatter.formatCode(applyEdits(before, list)), before, path })
    }
    return { edits, steps }
  }
  const entity = snapshot.nodes.get(`entity:${shape.entity}`)
  const chosenView = snapshot.nodes.get(`view:${shape.presentIn}`)
  if (entity === undefined || chosenView === undefined) {
    problems.push(`Unknown entity or view: ${shape.entity}, ${shape.presentIn}`)
    return await materialize()
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
  // The model often writes the field name in the case it would use in prose. Tao knows the convention, so
  // it repairs the name and says it did, rather than refusing a shape that is right in every other way.
  if (/^[a-z][A-Za-z0-9]*$/.test(shape.fieldName)) {
    const repaired = shape.fieldName.replace(/^./, character => character.toUpperCase())
    steps.push({
      action: `capitalize the field name: ${shape.fieldName} → ${repaired}`,
      decidedBy: 'tao',
      evidence: [entity.id],
      file: entity.path!,
      note: 'Tao field names are capitalized; the model wrote it in prose case',
      status: 'ready',
    })
    shape.fieldName = repaired
  }
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
  if (shape.fieldKind !== 'yes/no') {
    steps.push({
      action: `add ${singular}.${shape.fieldName} ${shape.fieldKind}`,
      decidedBy: 'model',
      evidence: [entity.id],
      file: entity.path!,
      note: 'this PoC lowers yes/no fields only',
      status: 'unsupported',
    })
    return await materialize()
  }
  if (problems.length > 0 || parameter === undefined) {
    return await materialize()
  }
  const F = shape.fieldName
  const actionName = `Set${F}`

  // Anchors. With an analogous yes/no field, every placement copies that field's own pattern. Without one
  // — a first flag in an app that has none — Tao falls back to the view's structure: after the last field,
  // before the view's render block, and after the last thing the view renders.
  const analogField = pattern === undefined ? undefined : snapshot.nodes.get(String(pattern['field']))
  // The analogous writer is only usable as an anchor when it lives in the file the edit is staged against.
  // Its offsets mean nothing in another file, and splicing at them lands inside whatever text sits there.
  const analogWriter = pattern === undefined ? undefined : snapshot.nodes.get(String(pattern['writtenBy']))
  const analogAction = analogWriter?.path === view.path ? analogWriter : undefined
  const analogRender = pattern === undefined ? undefined : snapshot.nodes.get(String(pattern['renderId']))
  const entityFields = [...snapshot.nodes.values()].filter(n =>
    n.kind === 'field' && detail(n)['entity'] === entity.name
  )
  const lastField = entityFields.sort((a, b) => b.end! - a.end!)[0]
  const viewRenders = [...snapshot.nodes.values()].filter(n =>
    n.kind === 'render' && n.path === view.path && detail(n)['owner'] === view.name
  )
  const rootRender = [...viewRenders].sort((a, b) => a.start! - b.start!)[0]
  // The last thing the view renders is the one that starts last, not the one that ends last: the render
  // that ends last is the outermost container, and putting the control after it lands outside the card.
  const lastRender = [...viewRenders].sort((a, b) => b.start! - a.start!)[0]
  const fieldAnchor = analogField ?? lastField
  if (fieldAnchor === undefined || rootRender === undefined || lastRender === undefined) {
    problems.push(`${view.name} renders nothing, or ${entity.name} declares no fields, so there is nothing to copy`)
    return await materialize()
  }
  const actionOwner = analogAction === undefined ? view.name : analogAction.name.split('.')[0]
  if (pattern === undefined) {
    steps.push({
      action: `place the flag from ${view.name}'s own structure: ${entity.name} has no yes/no field to copy`,
      decidedBy: 'tao',
      evidence: [entity.id, view.id],
      file: view.path!,
      note: `field after ${fieldAnchor.name}, action before the render block, control after ${lastRender.name}`,
      status: 'ready',
    })
  }

  // 1. Data file: the new field right after the anchor field.
  const dataBefore = await readFile(entity.path!)
  // Insert after the whole line so a trailing comment on the anchor field stays with it.
  const fieldLineEnd = dataBefore.indexOf('\n', fieldAnchor.end!)
  stage(entity.path!, { end: fieldLineEnd, replacement: `\n   ${F} yes / no`, start: fieldLineEnd })
  steps.push({
    action: `add field ${singular}.${F} yes / no after ${fieldAnchor.name}`,
    decidedBy: 'model',
    evidence: [fieldAnchor.id, `src:${entity.path}:${fieldAnchor.start}-${fieldAnchor.end}`],
    file: entity.path!,
    status: 'ready',
  })

  // 2. View file: the action, then the control the person taps.
  const viewBefore = await readFile(view.path!)
  const actionText = `action ${actionName}(Value boolean) {\n      update ${parameter} {\n         ${F}: Value\n   }  }`
  const actionEdit: Edit = analogAction !== undefined
    ? { end: analogAction.end!, replacement: `\n   ${actionText}`, start: analogAction.end! }
    : (() => {
      const lineStart = viewBefore.lastIndexOf('\n', rootRender.start! - 1) + 1
      return { end: lineStart, replacement: `   ${actionText}\n`, start: lineStart }
    })()
  const renderAnchorEnd = (analogRender ?? lastRender).end!
  // Copying a pattern brings the control's element with it; placing a first flag does not, so the view's
  // stdlib import has to gain Checkbox or the file will not resolve it.
  const checkboxImportEdits = mergeImportEdit(viewBefore, '@tao/ui', 'Checkbox')
  stage(
    view.path!,
    ...checkboxImportEdits,
    actionEdit,
    {
      end: renderAnchorEnd,
      replacement: `\n\n            #mark${F}\n            Checkbox(Value: ${parameter}.${F} is ${F}, Label: ${
        JSON.stringify(shape.label)
      }) {\n               on change ${actionName}\n            }`,
      start: renderAnchorEnd,
    },
  )
  steps.push({
    action: `add action ${actionOwner}.${actionName}(Value boolean) writing ${singular}.${F}, ${
      analogAction === undefined ? `before ${view.name}'s render block` : `after ${analogAction.name}`
    }`,
    decidedBy: 'tao',
    evidence: analogAction === undefined
      ? [view.id, `src:${view.path}:${rootRender.start}-${rootRender.end}`]
      : [analogAction.id, `src:${view.path}:${analogAction.start}-${analogAction.end}`],
    file: view.path!,
    status: 'ready',
  })
  steps.push({
    action: `render Checkbox #mark${F} bound to ${parameter}.${F} after ${
      (analogRender ?? lastRender).name
    }, invoking ${actionName} on change${checkboxImportEdits.length === 0 ? '' : ', importing Checkbox from @tao/ui'}`,
    decidedBy: 'tao',
    evidence: [(analogRender ?? lastRender).id],
    file: view.path!,
    status: 'ready',
  })

  // 3. Entry file: a fixture row with the flag set, and a scenario rendering the view with it.
  const entryPath = [...snapshot.nodes.values()].find(n => n.kind === 'app' && n.name === snapshot.appName)?.path
  const fixture = [...snapshot.nodes.values()].find(n => n.kind === 'fixture' && n.path === entryPath)
  if (entryPath === undefined || fixture === undefined) {
    steps.push({
      action: 'add a scenario showing the new control',
      decidedBy: 'tao',
      evidence: [],
      file: entryPath ?? '?',
      note:
        'this app declares no fixture in its entry file, so there is no sample row to switch on; the two edits above still stand',
      status: 'unsupported',
    })
    return await materialize()
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
    const sample = sampleFieldValue(field, { bindings, label: shape.label, snapshot })
    if (sample !== undefined) {
      rowFields.push(`${field.name}: ${sample.value}`)
      hardCoded.push(`${field.name} ${sample.note}`)
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
    return await materialize()
  }
  const subjectParameter = (detail(subject)['parameters'] as string[]).find(p =>
    p.includes(`(entity ${shape.entity})`)
  )!.split(' ')[0]!
  // `create <Singular>` in the fixture resolves through the entity's imported plural declaration.
  // A declaration the entry file declares itself needs no import, and importing it from a folder the project
  // may not even have is a change that cannot resolve. One-file apps declare both here.
  const entityIsLocal = entity.path === entryPath
  const subjectIsLocal = subject.path === entryPath
  const dataImport = /^use (.+) from @data$/m.exec(entryBefore)
  const dataImportNames = dataImport === null ? [] : dataImport[1]!.split(',').map(name => name.trim())
  const dataImportEdits: Edit[] = entityIsLocal || dataImportNames.includes(shape.entity)
    ? []
    : dataImport === null
    ? [{ end: 0, replacement: `use ${shape.entity} from @data\n`, start: 0 }]
    : [{
      end: dataImport.index + dataImport[0].length,
      replacement: `use ${[...dataImportNames, shape.entity].sort().join(', ')} from @data`,
      start: dataImport.index,
    }]
  const useLine = entryBefore.split('\n').findIndex(line => /^use .* from @ui$/.test(line))
  const alreadyImported = subjectIsLocal
    || new RegExp(`^use .*\\b${subject.name}\\b.* from @ui$`, 'm').test(entryBefore)
  const useInsertOffset = useLine < 0 ? 0 : entryBefore.split('\n').slice(0, useLine + 1).join('\n').length + 1
  const scenario = `\nscenarios ${subject.name} ${
    JSON.stringify(shape.featureName)
  } {\n   fixture ${fixture.name}\n   device phone\n   appearance light\n   network online\n   locale "en"\n   scenario ${
    JSON.stringify(shape.scenarioName)
  } {\n      render (${subjectParameter}: ${handle})\n}  }\n`
  stage(
    entryPath,
    { end: closing, replacement: `   ${handle} = create ${singular} { ${rowFields.join(', ')} }\n`, start: closing },
    { end: entryBefore.length, replacement: scenario, start: entryBefore.length },
    ...(alreadyImported
      ? []
      : [{ end: useInsertOffset, replacement: `use ${subject.name} from @ui\n`, start: useInsertOffset }]),
    ...dataImportEdits,
  )
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
  return await materialize()
}

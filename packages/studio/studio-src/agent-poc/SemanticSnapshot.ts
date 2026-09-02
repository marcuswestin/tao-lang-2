// Semantic agent proof of concept: a throwaway semantic snapshot of one Tao app.
//
// Every relationship carries an `origin`: `compiler` means it came from a resolved cross-reference or
// declaration structure in the linked AST; `poc-derived` means a name-matching heuristic this PoC
// applies (documented in `via`). Nothing here is a production graph, identity, or query design.
import { ASTUtils } from '@ast-utils'
import { AST, type ParsedFile } from '@parser'
import { type Diagnostic, FS } from '@shared'

export type SnapshotOrigin = 'compiler' | 'poc-derived'

export type SnapshotNode = {
  id: string
  kind: 'app' | 'view' | 'element' | 'entity' | 'field' | 'action' | 'query' | 'state' | 'render' | 'design' | 'bundle'
    | 'token' | 'scenario' | 'fixture'
  name: string
  path?: string
  start?: number
  end?: number
  detail?: Record<string, unknown>
}

export type SnapshotEdge = {
  from: string
  to: string
  rel: 'renders' | 'styled-by' | 'writes' | 'reads' | 'invokes' | 'covers' | 'uses-design' | 'declares' | 'queries'
  origin: SnapshotOrigin
  via: string
  evidence: string
}

export type SemanticSnapshot = {
  projectRoot: string
  appName: string
  nodes: Map<string, SnapshotNode>
  edges: SnapshotEdge[]
  diagnostics: readonly Diagnostic[]
}

type Files = readonly ParsedFile[]

export function buildSemanticSnapshot(
  projectRoot: string,
  appName: string,
  files: Files,
  diagnostics: readonly Diagnostic[],
): SemanticSnapshot {
  const snapshot: SemanticSnapshot = { appName, diagnostics, edges: [], nodes: new Map(), projectRoot }
  const rel = (path: string) => FS.relativePath(projectRoot, path)
  const projectFiles = files.filter(file => !rel(file.path).startsWith('..'))
  const add = (node: SnapshotNode) => {
    snapshot.nodes.set(node.id, node)
    return node
  }
  const edge = (e: SnapshotEdge) => snapshot.edges.push(e)
  const loc = (node: AST.Node) => {
    const path = rel(AST.getDocument(node).uri.fsPath)
    return { end: node.$cstNode?.end ?? 0, path, start: node.$cstNode?.offset ?? 0 }
  }
  const src = (node: AST.Node) => {
    const l = loc(node)
    return `src:${l.path}:${l.start}-${l.end}`
  }

  // Entities and fields (declaration structure: compiler origin).
  const entityBySingular = new Map<string, AST.EntityDataDeclaration>()
  const entityByPlural = new Map<string, AST.EntityDataDeclaration>()
  for (const file of files) {
    for (const entity of AST.streamAllContents(file.ast).filter(AST.isEntityDataDeclaration)) {
      entityBySingular.set(entity.singularName, entity)
      entityByPlural.set(entity.name, entity)
      const fields = entity.block.entries.filter(AST.isEntityDataField)
      add({
        detail: {
          fields: fields.map(field => ({
            name: field.name,
            type: field.boolean ? `yes/no${field.negativeName === undefined ? '' : ` (no: ${field.negativeName})`}` : field.primitive ?? 'relation',
            ...(field.optional ? { optional: true } : {}),
          })),
          singular: entity.singularName,
        },
        id: `entity:${entity.name}`,
        kind: 'entity',
        name: entity.name,
        ...loc(entity),
      })
      for (const field of fields) {
        add({
          detail: { entity: entity.name, type: field.boolean ? 'yes/no' : field.primitive ?? 'relation' },
          id: `field:${entity.singularName}.${field.name}`,
          kind: 'field',
          name: `${entity.singularName}.${field.name}`,
          ...loc(field),
        })
      }
    }
  }

  // Designs (declaration structure: compiler origin).
  for (const file of files) {
    for (const design of AST.streamAllContents(file.ast).filter(AST.isDesignDeclaration)) {
      const members: string[] = []
      for (const member of design.block.members) {
        if (AST.isDesignToken(member)) {
          add({ detail: { design: design.name, value: member.value }, id: `token:${design.name}.${member.name}`, kind: 'token', name: member.name, ...loc(member) })
          members.push(member.name)
        } else if (AST.isDesignBundle(member) || AST.isDesignStylesBlock(member) || AST.isDesignTextBlock(member)) {
          const entries = AST.isDesignBundle(member) ? [member] : member.entries
          for (const entry of entries) {
            add({
              detail: { design: design.name, entries: entry.spec.entries.map(e => ASTUtils.layoutEntryValues(e).join(' ')) },
              id: `bundle:${design.name}.${entry.name}`,
              kind: 'bundle',
              name: entry.name,
              ...loc(entry),
            })
            members.push(entry.name)
          }
        } else if (AST.isDesignColorsBlock(member)) {
          for (const entry of member.entries) {
            add({ detail: { design: design.name, value: entry.$cstNode?.text ?? '' }, id: `token:${design.name}.${entry.name}`, kind: 'token', name: entry.name, ...loc(entry) })
            members.push(entry.name)
          }
        } else if (AST.isDesignSizesBlock(member)) {
          for (const entry of member.entries) {
            add({ detail: { design: design.name, value: entry.$cstNode?.text ?? '' }, id: `token:${design.name}.${entry.name}`, kind: 'token', name: entry.name, ...loc(entry) })
            members.push(entry.name)
          }
        }
      }
      add({ detail: { members }, id: `design:${design.name}`, kind: 'design', name: design.name, ...loc(design) })
    }
  }

  // Apps and their selected design (resolved reference: compiler origin).
  let selectedDesign: string | undefined
  for (const file of projectFiles) {
    for (const app of AST.streamAllContents(file.ast).filter(AST.isAppDeclaration)) {
      add({ id: `app:${app.name}`, kind: 'app', name: app.name, ...loc(app) })
      for (const property of AST.streamAllContents(app).filter(AST.isAppProperty)) {
        const value = property.value
        const target = AST.isValueReference(value) ? value.target.ref : undefined
        if (property.name === 'Design' && AST.isDesignDeclaration(target)) {
          edge({ evidence: src(property), from: `app:${app.name}`, origin: 'compiler', rel: 'uses-design', to: `design:${target.name}`, via: 'app Design property resolves to the design declaration' })
          if (app.name === appName) {
            selectedDesign = target.name
          }
        }
      }
    }
  }

  const entityOfValue = (declaration: AST.Node | undefined): AST.EntityDataDeclaration | undefined => {
    if (AST.isParameterDeclaration(declaration)) {
      const type = declaration.inlineType?.type ?? declaration.type
      const root = AST.isNamedTypeReference(type) ? type.root : undefined
      return root === undefined ? undefined : entityBySingular.get(root)
    }
    if (AST.isEntityQueryDeclaration(declaration)) {
      return entityByPlural.get(declaration.sourceName ?? declaration.name)
    }
    return undefined
  }

  // Views, actions, states, queries, renders.
  for (const file of projectFiles) {
    for (const view of AST.streamAllContents(file.ast).filter(AST.isViewDeclaration)) {
      const viewId = `view:${view.name}`
      const parameters = AST.parametersOf(view).map(parameter => {
        const type = parameter.inlineType?.type ?? parameter.type
        const typeText = type?.$cstNode?.text ?? ''
        const name = parameter.inlineType?.name ?? (AST.isNamedTypeReference(parameter.type) ? parameter.type.root : typeText)
        const entity = entityOfValue(parameter)
        return `${name}${entity === undefined ? (typeText === name ? '' : ` ${typeText}`) : ` (entity ${entity.name})`}`
      })
      const statements = AST.blockStatements(view)
      const states = statements.filter(AST.isStateDeclaration).map(state => state.name)
      const queries = statements.filter(AST.isEntityQueryDeclaration)
      const actions = statements.filter(AST.isActionDeclaration)
      add({
        detail: { actions: actions.map(action => action.name), parameters, queries: queries.map(query => query.name), states },
        id: viewId,
        kind: 'view',
        name: view.name,
        ...loc(view),
      })
      for (const state of statements.filter(AST.isStateDeclaration)) {
        add({ id: `state:${view.name}.${state.name}`, kind: 'state', name: `${view.name}.${state.name}`, ...loc(state) })
      }
      for (const query of queries) {
        const entity = entityOfValue(query)
        add({ detail: { source: query.source?.$cstNode?.text }, id: `query:${view.name}.${query.name}`, kind: 'query', name: `${view.name}.${query.name}`, ...loc(query) })
        if (entity !== undefined) {
          edge({ evidence: src(query), from: viewId, origin: 'poc-derived', rel: 'queries', to: `entity:${entity.name}`, via: 'query name matched to the entity collection name' })
        }
      }
      for (const action of actions) {
        const actionId = `action:${view.name}.${action.name}`
        add({ detail: { parameters: AST.parametersOf(action).map(p => p.$cstNode?.text ?? '') }, id: actionId, kind: 'action', name: `${view.name}.${action.name}`, ...loc(action) })
        edge({ evidence: src(action), from: viewId, origin: 'compiler', rel: 'declares', to: actionId, via: 'action declared inside the view block' })
        for (const node of AST.streamAllContents(action)) {
          if (AST.isUpdateStatement(node)) {
            const target = node.target
            const declaration = AST.isValueReference(target) ? target.target.ref : AST.isMemberAccessExpression(target) ? target.target.ref : undefined
            const entity = entityOfValue(declaration)
            for (const field of node.block.fields) {
              if (field.label !== undefined) {
                edge({
                  evidence: src(field),
                  from: actionId,
                  origin: 'poc-derived',
                  rel: 'writes',
                  to: entity === undefined ? `field:?.${field.label}` : `field:${entity.singularName}.${field.label}`,
                  via: 'update target typed by a view parameter or query whose declared type names the entity',
                })
              }
            }
          } else if (AST.isCreateStatement(node)) {
            const entity = node.entity.ref
            if (entity !== undefined) {
              for (const field of node.block.fields) {
                if (field.label !== undefined) {
                  edge({ evidence: src(field), from: actionId, origin: 'compiler', rel: 'writes', to: `field:${entity.singularName}.${field.label}`, via: 'create statement resolves the entity reference' })
                }
              }
            }
          }
        }
      }
      // Field reads anywhere in the view (renders, actions, states).
      for (const access of AST.streamAllContents(view).filter(AST.isMemberAccessExpression)) {
        const entity = entityOfValue(access.target.ref)
        const member = access.members[0]
        if (entity !== undefined && member !== undefined) {
          const owner = AST.findOwningAction(access)
          edge({
            evidence: src(access),
            from: owner === undefined ? viewId : `action:${view.name}.${owner.name}`,
            origin: 'poc-derived',
            rel: 'reads',
            to: `field:${entity.singularName}.${member}`,
            via: 'member access on a value whose declared type names the entity',
          })
        }
      }
      for (const render of AST.streamAllContents(view).filter(AST.isRender)) {
        const l = loc(render)
        const renderId = `render:${l.path}:${l.start}:${l.end}`
        const target = render.view?.ref
        const targetPath = target === undefined ? undefined : rel(AST.getDocument(target).uri.fsPath)
        const isProjectView = target !== undefined && targetPath !== undefined && !targetPath.startsWith('..')
        const layout = (render.layoutClause?.entries ?? []).map(entry => ASTUtils.layoutEntryValues(entry))
        const tag = AST.testTagForRender(render)
        add({
          detail: {
            ...(tag === undefined ? {} : { tag: `#${tag}` }),
            layout: layout.map(values => values.join(' ')),
            owner: view.name,
            target: target?.name ?? (AST.isRenderStatement(render) && render.injection !== undefined ? 'inject' : '?'),
          },
          id: renderId,
          kind: 'render',
          name: `${target?.name ?? 'inject'}${tag === undefined ? '' : ` #${tag}`}`,
          ...l,
        })
        if (target !== undefined) {
          if (isProjectView) {
            edge({ evidence: src(render), from: viewId, origin: 'compiler', rel: 'renders', to: `view:${target.name}`, via: 'render resolves the view reference' })
          } else {
            const elementId = `element:${target.name}`
            if (!snapshot.nodes.has(elementId)) {
              add({ id: elementId, kind: 'element', name: target.name })
            }
            edge({ evidence: src(render), from: viewId, origin: 'compiler', rel: 'renders', to: elementId, via: 'render resolves the stdlib element reference' })
          }
        }
        for (const values of layout) {
          const bundleName = values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined
          const designName = selectedDesign ?? ''
          if (bundleName !== undefined && snapshot.nodes.has(`bundle:${designName}.${bundleName}`)) {
            edge({ evidence: src(render), from: renderId, origin: 'poc-derived', rel: 'styled-by', to: `bundle:${designName}.${bundleName}`, via: 'single-word layout entry name-matched to a member of the app-selected design (same rule as the Studio inspector)' })
          }
        }
        for (const handler of AST.streamAllContents(render).filter(AST.isEventHandler)) {
          if (nearestRender(handler) !== render) {
            continue
          }
          const action = handler.action?.target.ref
          if (AST.isActionDeclaration(action)) {
            const owner = AST.findOwningView(action)
            edge({ evidence: src(handler), from: renderId, origin: 'compiler', rel: 'invokes', to: `action:${owner?.name ?? ''}.${action.name}`, via: `on ${handler.event} resolves the action reference` })
          }
        }
      }
    }
  }

  // Scenarios and fixtures (resolved subject reference: compiler origin).
  for (const file of projectFiles) {
    for (const fixture of AST.streamAllContents(file.ast).filter(AST.isFixtureDeclaration)) {
      add({ id: `fixture:${fixture.name}`, kind: 'fixture', name: fixture.name, ...loc(fixture) })
    }
    for (const group of AST.streamAllContents(file.ast).filter(AST.isScenarioGroupDeclaration)) {
      const subject = group.subject?.ref
      const subjectId = subject === undefined ? undefined : AST.isViewDeclaration(subject) ? `view:${subject.name}` : `app:${subject.name}`
      for (const scenario of AST.scenarioDeclarations(group)) {
        const id = `scenario:${group.name}/${scenario.name}`
        const clauses = [...group.block.entries, ...scenario.block.entries].filter(entry => !AST.isScenarioDeclaration(entry))
          .map(entry => entry.$cstNode?.text.split('\n')[0] ?? '')
        add({ detail: { clauses, group: group.name, subject: subjectId }, id, kind: 'scenario', name: `${group.name}/${scenario.name}`, ...loc(scenario) })
        if (subjectId !== undefined) {
          edge({ evidence: src(scenario), from: id, origin: 'compiler', rel: 'covers', to: subjectId, via: 'scenario group subject resolves the declaration reference' })
        }
      }
    }
  }
  return snapshot
}

function nearestRender(node: AST.Node): AST.Node | undefined {
  let current: AST.Node | undefined = node.$container
  while (current !== undefined && !AST.isRender(current)) {
    current = current.$container
  }
  return current
}

// ---- Queries -------------------------------------------------------------------------------------

type Json = Record<string, unknown>

export function overview(snapshot: SemanticSnapshot, budget = 4000): Json {
  const nodes = [...snapshot.nodes.values()]
  const result = {
    app: snapshot.appName,
    design: snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to,
    diagnostics: snapshot.diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning').length,
    entities: nodes.filter(n => n.kind === 'entity').map(n => `${n.name}/${String((n.detail as Json)['singular'])}: ${((n.detail as Json)['fields'] as { name: string }[]).map(f => f.name).join(', ')}`),
    views: nodes.filter(n => n.kind === 'view').map(n =>
      `${n.id} (${n.path}; renders ${snapshot.edges.filter(e => e.from === n.id && e.rel === 'renders').length}, actions ${
        ((n.detail as Json)['actions'] as string[]).length
      }, scenarios ${snapshot.edges.filter(e => e.to === n.id && e.rel === 'covers').length})`
    ),
    bundles: nodes.filter(n => n.kind === 'bundle' && (n.detail as Json)['design'] === selectedDesignName(snapshot)).map(n => n.name),
    hint: 'Call inspect(id) for one view, entity, field, action, bundle, or scenario. Call trace(id, relationship) to follow reads/writes/renders/styled-by/covers/invokes.',
  }
  return truncate(result, budget)
}

function selectedDesignName(snapshot: SemanticSnapshot): string | undefined {
  return snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to.replace('design:', '')
}

export function resolveTarget(snapshot: SemanticSnapshot, target: string): SnapshotNode | undefined {
  const direct = snapshot.nodes.get(target)
  if (direct !== undefined) {
    return direct
  }
  const design = selectedDesignName(snapshot)
  const candidates = [
    `view:${target}`, `entity:${target}`, `field:${target}`, `action:${target}`, `bundle:${design}.${target}`, `token:${design}.${target}`,
    `app:${target}`, `scenario:${target}`,
  ]
  for (const id of candidates) {
    const node = snapshot.nodes.get(id)
    if (node !== undefined) {
      return node
    }
  }
  return [...snapshot.nodes.values()].find(node => node.name === target || node.name.endsWith(`.${target}`))
}

export function inspect(snapshot: SemanticSnapshot, target: string, budget = 3600): Json {
  const node = resolveTarget(snapshot, target)
  if (node === undefined) {
    return { error: `Unknown target: ${target}`, hint: 'Use an id from overview() such as view:DocumentEditor or Document.Final.' }
  }
  const out = edgesFrom(snapshot, node.id)
  const inn = edgesTo(snapshot, node.id)
  const result: Json = {
    id: node.id,
    kind: node.kind,
    ...(node.path === undefined ? {} : { source: `src:${node.path}:${node.start}-${node.end}` }),
    ...(node.detail ?? {}),
  }
  if (node.kind === 'view') {
    result['renders'] = [...snapshot.nodes.values()].filter(n => n.kind === 'render' && (n.detail as Json)['owner'] === node.name).map(n =>
      `${n.id} ${String((n.detail as Json)['target'])}${(n.detail as Json)['tag'] === undefined ? '' : ` ${String((n.detail as Json)['tag'])}`} [${
        ((n.detail as Json)['layout'] as string[]).join(', ')
      }]`
    )
    result['stylesUsed'] = uniq(snapshot.edges.filter(e => e.rel === 'styled-by' && e.from.startsWith('render:') && (snapshot.nodes.get(e.from)?.detail as Json)['owner'] === node.name).map(e => e.to))
      .map(id => `${id} [${((snapshot.nodes.get(id)?.detail as Json)['entries'] as string[]).join(', ')}] (poc-derived)`)
    result['reads'] = fact(out.filter(e => e.rel === 'reads'))
    result['rendersViews'] = fact(out.filter(e => e.rel === 'renders'))
    result['renderedBy'] = fact(inn.filter(e => e.rel === 'renders'))
    result['coveredByScenarios'] = fact(inn.filter(e => e.rel === 'covers'))
    result['diagnostics'] = snapshot.diagnostics.filter(d => d.filePath !== undefined && node.path !== undefined && d.filePath.endsWith(node.path))
      .slice(0, 5).map(d => `${d.severity}: ${d.message}`)
  } else if (node.kind === 'entity') {
    result['writtenBy'] = fact(snapshot.edges.filter(e => e.rel === 'writes' && e.to.startsWith(`field:${String((node.detail as Json)['singular'])}.`)))
    result['readBy'] = fact(snapshot.edges.filter(e => e.rel === 'reads' && e.to.startsWith(`field:${String((node.detail as Json)['singular'])}.`)))
  } else if (node.kind === 'field') {
    result['writtenBy'] = fact(inn.filter(e => e.rel === 'writes'))
    result['readBy'] = fact(inn.filter(e => e.rel === 'reads'))
  } else if (node.kind === 'action') {
    result['writes'] = fact(out.filter(e => e.rel === 'writes'))
    result['reads'] = fact(out.filter(e => e.rel === 'reads'))
    result['invokedBy'] = fact(inn.filter(e => e.rel === 'invokes'))
  } else if (node.kind === 'bundle' || node.kind === 'token') {
    const users = inn.filter(e => e.rel === 'styled-by')
    result['usedByRenders'] = fact(users)
    result['blastRadius'] = users.length
    result['usedInViews'] = uniq(users.map(e => String((snapshot.nodes.get(e.from)?.detail as Json)['owner'])))
  } else if (node.kind === 'scenario') {
    result['covers'] = fact(out.filter(e => e.rel === 'covers'))
  } else if (node.kind === 'app') {
    result['design'] = fact(out.filter(e => e.rel === 'uses-design'))
    result['scenarios'] = fact(inn.filter(e => e.rel === 'covers'))
  }
  return truncate(result, budget)
}

export function trace(snapshot: SemanticSnapshot, target: string, relationship: string, budget = 3600): Json {
  const node = resolveTarget(snapshot, target)
  if (node === undefined) {
    return { error: `Unknown target: ${target}` }
  }
  const rel = relationship.replace(/_/g, '-')
  const edges = snapshot.edges.filter(e => e.rel === rel && (e.from === node.id || e.to === node.id))
  if (edges.length === 0) {
    const supported = uniq(snapshot.edges.filter(e => e.from === node.id || e.to === node.id).map(e => e.rel))
    return { id: node.id, relationship: rel, results: [], supportedRelationships: supported, note: 'No edges of that relationship for this target.' }
  }
  return truncate({ id: node.id, relationship: rel, results: fact(edges) }, budget)
}

/** answerCrossCutting answers the fixed benchmark "what can change a field and where is it presented" from edges. */
export function fieldStory(snapshot: SemanticSnapshot, field: string): Json {
  const node = resolveTarget(snapshot, field)
  if (node === undefined || node.kind !== 'field') {
    return { error: `Unknown field: ${field}` }
  }
  const writers = snapshot.edges.filter(e => e.rel === 'writes' && e.to === node.id)
  const readers = snapshot.edges.filter(e => e.rel === 'reads' && e.to === node.id)
  return {
    field: node.id,
    writtenBy: fact(writers),
    readBy: fact(readers),
    invokers: fact(snapshot.edges.filter(e => e.rel === 'invokes' && writers.some(w => w.from === e.to))),
  }
}

/** fact renders one edge as a compact line: `from -> to [origin] evidence`. */
function fact(edges: readonly SnapshotEdge[]): string[] {
  return edges.map(e => `${e.from} -> ${e.to} [${e.origin}] ${e.evidence}`)
}

function edgesFrom(snapshot: SemanticSnapshot, id: string): SnapshotEdge[] {
  return snapshot.edges.filter(e => e.from === id)
}

function edgesTo(snapshot: SemanticSnapshot, id: string): SnapshotEdge[] {
  return snapshot.edges.filter(e => e.to === id)
}

function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** truncate is the PoC's crude token budget: drop array tails until the JSON fits. */
function truncate(value: Json, budget: number): Json {
  let text = JSON.stringify(value)
  if (text.length <= budget) {
    return value
  }
  const trimmed: Json = { ...value }
  for (const key of Object.keys(trimmed)) {
    const entry = trimmed[key]
    if (Array.isArray(entry) && entry.length > 10) {
      trimmed[key] = [...entry.slice(0, 10), `… ${entry.length - 10} more (raise budget or narrow the query)`]
    }
    text = JSON.stringify(trimmed)
    if (text.length <= budget) {
      break
    }
  }
  return { ...trimmed, truncated: true }
}

export function snapshotToJson(snapshot: SemanticSnapshot): Json {
  return {
    app: snapshot.appName,
    edges: snapshot.edges,
    nodes: [...snapshot.nodes.values()],
    diagnostics: snapshot.diagnostics.map(d => ({ file: d.filePath, message: d.message, severity: d.severity })),
  }
}

// Semantic agent proof of concept: a throwaway semantic snapshot of one Tao app.
//
// Every relationship carries an `origin`: `compiler` means it came from a resolved cross-reference or
// declaration structure in the linked AST; `poc-derived` means a name-matching heuristic this PoC
// applies (documented in `via`). Nothing here is a production graph, identity, or query design.
import { ASTUtils } from '@ast-utils'
import { AST, type ParsedFile } from '@parser'
import { type Diagnostic, FS, Switch } from '@shared'

type SnapshotOrigin = 'compiler' | 'poc-derived'

export type SnapshotNode = {
  id: string
  kind:
    | 'app'
    | 'view'
    | 'element'
    | 'entity'
    | 'field'
    | 'action'
    | 'query'
    | 'state'
    | 'render'
    | 'design'
    | 'bundle'
    | 'token'
    | 'scenario'
    | 'fixture'
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
            type: field.boolean
              ? `yes/no${field.negativeName === undefined ? '' : ` (no: ${field.negativeName})`}`
              : field.primitive ?? 'relation',
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
          detail: {
            entity: entity.name,
            hasDefault: (field.traits?.traits ?? []).some(trait =>
              trait.defaultValue !== undefined || trait.defaultCase !== undefined
            ),
            ...(field.optional ? { optional: true } : {}),
            type: field.boolean ? 'yes/no' : field.primitive ?? 'relation',
          },
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
          add({
            detail: { design: design.name, value: member.value },
            id: `token:${design.name}.${member.name}`,
            kind: 'token',
            name: member.name,
            ...loc(member),
          })
          members.push(member.name)
        } else if (AST.isDesignBundle(member) || AST.isDesignStylesBlock(member) || AST.isDesignTextBlock(member)) {
          const entries = AST.isDesignBundle(member) ? [member] : member.entries
          for (const entry of entries) {
            add({
              detail: {
                design: design.name,
                entries: entry.spec.entries.map(e => ASTUtils.layoutEntryValues(e).join(' ')),
              },
              id: `bundle:${design.name}.${entry.name}`,
              kind: 'bundle',
              name: entry.name,
              ...loc(entry),
            })
            members.push(entry.name)
          }
        } else if (AST.isDesignColorsBlock(member)) {
          for (const entry of member.entries) {
            add({
              detail: { design: design.name, value: entry.$cstNode?.text ?? '' },
              id: `token:${design.name}.${entry.name}`,
              kind: 'token',
              name: entry.name,
              ...loc(entry),
            })
            members.push(entry.name)
          }
        } else if (AST.isDesignSizesBlock(member)) {
          for (const entry of member.entries) {
            add({
              detail: { design: design.name, value: entry.$cstNode?.text ?? '' },
              id: `token:${design.name}.${entry.name}`,
              kind: 'token',
              name: entry.name,
              ...loc(entry),
            })
            members.push(entry.name)
          }
        }
      }
      add({ detail: { members }, id: `design:${design.name}`, kind: 'design', name: design.name, ...loc(design) })
    }
  }

  // Apps and their selected design (resolved reference: compiler origin).
  let selectedDesign: string | undefined
  // `app Stub = Base with { ... }` takes everything it does not override from the app it derives from,
  // including the design. Reading the design only off the app whose name matches leaves a derived app with
  // no design at all, and then every bundle in the project looks unused.
  const derivedFrom = new Map<string, string>()
  for (const file of projectFiles) {
    for (const app of AST.streamAllContents(file.ast).filter(AST.isAppDeclaration)) {
      // `Base with { ... }` parses as a refinement expression whose target is the app it refines.
      const value = app.value
      const base = value === undefined
        ? undefined
        : AST.isRefinementExpression(value)
        ? value.target.ref
        : AST.isValueReference(value)
        ? value.target.ref
        : undefined
      if (AST.isAppDeclaration(base)) {
        derivedFrom.set(app.name, base.name)
      }
    }
  }
  const designOf = new Map<string, string>()
  for (const file of projectFiles) {
    for (const app of AST.streamAllContents(file.ast).filter(AST.isAppDeclaration)) {
      add({ id: `app:${app.name}`, kind: 'app', name: app.name, ...loc(app) })
      for (const property of AST.streamAllContents(app).filter(AST.isAppProperty)) {
        const value = property.value
        const target = AST.isValueReference(value) ? value.target.ref : undefined
        if (property.name === 'Design' && AST.isDesignDeclaration(target)) {
          edge({
            evidence: src(property),
            from: `app:${app.name}`,
            origin: 'compiler',
            rel: 'uses-design',
            to: `design:${target.name}`,
            via: 'app Design property resolves to the design declaration',
          })
          designOf.set(app.name, target.name)
        }
      }
    }
  }
  for (let name: string | undefined = appName; name !== undefined; name = derivedFrom.get(name)) {
    const design = designOf.get(name)
    if (design !== undefined) {
      selectedDesign = design
      if (name !== appName) {
        // The derived app inherits it, so the graph should say the app under inspection uses it too.
        edge({
          evidence: `app:${appName}`,
          from: `app:${appName}`,
          origin: 'compiler',
          rel: 'uses-design',
          to: `design:${design}`,
          via: `inherited from the app ${appName} derives from`,
        })
      }
      break
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
    if (AST.isForStatement(declaration)) {
      // `loop Documents / Document` binds Document to one row of the collection. Without this, every field
      // read inside a loop body is invisible, which is most of the field reads in a list-shaped UI.
      const collection = declaration.collection
      const target = AST.isValueReference(collection)
        ? collection.target.ref
        : AST.isMemberAccessExpression(collection)
        ? collection.target.ref
        : undefined
      const throughDeclaration = target === declaration ? undefined : entityOfValue(target)
      if (throughDeclaration !== undefined) {
        return throughDeclaration
      }
      const root = (collection.$cstNode?.text ?? '').split(/[^A-Za-z0-9_]/).filter(part => part !== '')[0] ?? ''
      return entityByPlural.get(root)
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
        const name = parameter.inlineType?.name
          ?? (AST.isNamedTypeReference(parameter.type) ? parameter.type.root : typeText)
        const entity = entityOfValue(parameter)
        return `${name}${entity === undefined ? (typeText === name ? '' : ` ${typeText}`) : ` (entity ${entity.name})`}`
      })
      const statements = AST.blockStatements(view)
      const states = statements.filter(AST.isStateDeclaration).map(state => state.name)
      const queries = statements.filter(AST.isEntityQueryDeclaration)
      const actions = statements.filter(AST.isActionDeclaration)
      add({
        detail: {
          actions: actions.map(action => action.name),
          parameters,
          queries: queries.map(query => query.name),
          states,
          visibility: view.visibility ?? 'file',
        },
        id: viewId,
        kind: 'view',
        name: view.name,
        ...loc(view),
      })
      for (const state of statements.filter(AST.isStateDeclaration)) {
        add({
          id: `state:${view.name}.${state.name}`,
          kind: 'state',
          name: `${view.name}.${state.name}`,
          ...loc(state),
        })
      }
      for (const query of queries) {
        const entity = entityOfValue(query)
        add({
          detail: { source: query.source?.$cstNode?.text },
          id: `query:${view.name}.${query.name}`,
          kind: 'query',
          name: `${view.name}.${query.name}`,
          ...loc(query),
        })
        if (entity !== undefined) {
          edge({
            evidence: src(query),
            from: viewId,
            origin: 'poc-derived',
            rel: 'queries',
            to: `entity:${entity.name}`,
            via: 'query name matched to the entity collection name',
          })
        }
      }
      for (const action of actions) {
        const actionId = `action:${view.name}.${action.name}`
        add({
          detail: { parameters: AST.parametersOf(action).map(p => p.$cstNode?.text ?? '') },
          id: actionId,
          kind: 'action',
          name: `${view.name}.${action.name}`,
          ...loc(action),
        })
        edge({
          evidence: src(action),
          from: viewId,
          origin: 'compiler',
          rel: 'declares',
          to: actionId,
          via: 'action declared inside the view block',
        })
        for (const node of AST.streamAllContents(action)) {
          if (AST.isUpdateStatement(node)) {
            const target = node.target
            const declaration = AST.isValueReference(target)
              ? target.target.ref
              : AST.isMemberAccessExpression(target)
              ? target.target.ref
              : undefined
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
                  edge({
                    evidence: src(field),
                    from: actionId,
                    origin: 'compiler',
                    rel: 'writes',
                    to: `field:${entity.singularName}.${field.label}`,
                    via: 'create statement resolves the entity reference',
                  })
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
        const target = ASTUtils.resolveRenderTarget(render)
        const targetName = target === undefined ? undefined : ASTUtils.renderTargetName(target)
        const targetPath = target?.kind === 'view' ? rel(AST.getDocument(target.view).uri.fsPath) : undefined
        const isProjectView = target?.kind === 'view'
          && targetPath !== undefined
          && !targetPath.startsWith('..')
        const layout = (render.layoutClause?.entries ?? []).map(entry => ASTUtils.layoutEntryValues(entry))
        const tag = AST.testTagForRender(render)
        const texts = literalTexts(render)
        add({
          detail: {
            ...(tag === undefined ? {} : { tag: `#${tag}` }),
            layout: layout.map(values => values.join(' ')),
            owner: view.name,
            target: targetName ?? (AST.isRenderStatement(render) && render.injection !== undefined ? 'inject' : '?'),
            ...(texts.length === 0 ? {} : { texts }),
          },
          id: renderId,
          kind: 'render',
          name: `${targetName ?? 'inject'}${tag === undefined ? '' : ` #${tag}`}`,
          ...l,
        })
        if (target?.kind === 'view') {
          if (isProjectView) {
            edge({
              evidence: src(render),
              from: viewId,
              origin: 'compiler',
              rel: 'renders',
              to: `view:${target.view.name}`,
              via: 'render resolves the view reference',
            })
          } else {
            const elementId = `element:${target.view.name}`
            if (!snapshot.nodes.has(elementId)) {
              add({ id: elementId, kind: 'element', name: target.view.name })
            }
            edge({
              evidence: src(render),
              from: viewId,
              origin: 'compiler',
              rel: 'renders',
              to: elementId,
              via: 'render resolves the stdlib element reference',
            })
          }
        }
        for (const values of layout) {
          const bundleName = values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined
          const designName = selectedDesign ?? ''
          if (bundleName !== undefined && snapshot.nodes.has(`bundle:${designName}.${bundleName}`)) {
            edge({
              evidence: src(render),
              from: renderId,
              origin: 'poc-derived',
              rel: 'styled-by',
              to: `bundle:${designName}.${bundleName}`,
              via:
                'single-word layout entry name-matched to a member of the app-selected design (same rule as the Studio inspector)',
            })
          }
        }
        for (const handler of AST.streamAllContents(render).filter(AST.isEventHandler)) {
          if (nearestRender(handler) !== render) {
            continue
          }
          const action = handler.action?.target.ref
          if (AST.isActionDeclaration(action)) {
            const owner = AST.findOwningView(action)
            edge({
              evidence: src(handler),
              from: renderId,
              origin: 'compiler',
              rel: 'invokes',
              to: `action:${owner?.name ?? ''}.${action.name}`,
              via: `on ${handler.event} resolves the action reference`,
            })
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
      const subjectId = subject === undefined
        ? undefined
        : AST.isViewDeclaration(subject)
        ? `view:${subject.name}`
        : `app:${subject.name}`
      for (const scenario of AST.scenarioDeclarations(group)) {
        const id = `scenario:${group.name}/${scenario.name}`
        const clauses = [...group.block.entries, ...scenario.block.entries].filter(entry =>
          !AST.isScenarioDeclaration(entry)
        )
          .map(entry => entry.$cstNode?.text.split('\n')[0] ?? '')
        add({
          detail: { clauses, group: group.name, subject: subjectId },
          id,
          kind: 'scenario',
          name: `${group.name}/${scenario.name}`,
          ...loc(scenario),
        })
        if (subjectId !== undefined) {
          edge({
            evidence: src(scenario),
            from: id,
            origin: 'compiler',
            rel: 'covers',
            to: subjectId,
            via: 'scenario group subject resolves the declaration reference',
          })
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

export type SnapshotText = { start: number; end: number; text: string }

/**
 * literalTexts lists the string literals this render passes directly — the words a person reads on screen.
 * Literals belonging to a nested render, or sitting inside an interpolation's own expression, are excluded,
 * so each literal is attributed to exactly one render. `text` is the raw source including its quotes.
 */
function literalTexts(render: AST.Node): SnapshotText[] {
  const texts: SnapshotText[] = []
  for (const node of AST.streamAllContents(render)) {
    if (!AST.isInterpolatedString(node) && !AST.isStringLiteral(node)) {
      continue
    }
    if (nearestRender(node) !== render || node.$cstNode === undefined) {
      continue
    }
    let ancestor: AST.Node | undefined = node.$container
    let nested = false
    while (ancestor !== undefined && ancestor !== render) {
      nested = nested || AST.isInterpolatedString(ancestor)
      ancestor = ancestor.$container
    }
    if (!nested) {
      texts.push({ end: node.$cstNode.end, start: node.$cstNode.offset, text: node.$cstNode.text })
    }
  }
  return texts.sort((a, b) => a.start - b.start)
}

// ---- Queries -------------------------------------------------------------------------------------

type Json = Record<string, unknown>

export function overview(snapshot: SemanticSnapshot, budget = 3000): Json {
  const nodes = [...snapshot.nodes.values()]
  const result = {
    app: snapshot.appName,
    design: snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to,
    diagnostics: snapshot.diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning').length,
    entities: nodes.filter(n => n.kind === 'entity').map(n =>
      `${n.name}/${String((n.detail as Json)['singular'])}: ${
        ((n.detail as Json)['fields'] as { name: string }[]).map(f => f.name).join(', ')
      }`
    ),
    // Compact one-line lists survive the budget; a truncated list once hid `body` and most views from the model.
    views: nodes.filter(n => n.kind === 'view').map(n =>
      `${n.name}(renders ${snapshot.edges.filter(e => e.from === n.id && e.rel === 'renders').length}, actions ${
        ((n.detail as Json)['actions'] as string[]).length
      }, scenarios ${snapshot.edges.filter(e => e.to === n.id && e.rel === 'covers').length})`
    ).join('; '),
    bundles: nodes.filter(n => n.kind === 'bundle' && (n.detail as Json)['design'] === selectedDesignName(snapshot))
      .map(n => n.name).join(', '),
    hint:
      'Call inspect(name) with the exact view, entity, field (Document.Final), action, or bundle name. Call trace(name, relationship) to follow reads/writes/renders/styled-by/covers/invokes.',
  }
  return truncate(result, budget)
}

function selectedDesignName(snapshot: SemanticSnapshot): string | undefined {
  return snapshot.edges.find(e => e.from === `app:${snapshot.appName}` && e.rel === 'uses-design')?.to.replace(
    'design:',
    '',
  )
}

export function resolveTarget(snapshot: SemanticSnapshot, target: string): SnapshotNode | undefined {
  const direct = snapshot.nodes.get(target)
  if (direct !== undefined) {
    return direct
  }
  const design = selectedDesignName(snapshot)
  const candidates = [
    `view:${target}`,
    `entity:${target}`,
    `field:${target}`,
    `action:${target}`,
    `bundle:${design}.${target}`,
    `token:${design}.${target}`,
    `app:${target}`,
    `scenario:${target}`,
  ]
  for (const id of candidates) {
    const node = snapshot.nodes.get(id)
    if (node !== undefined) {
      return node
    }
  }
  const nodes = [...snapshot.nodes.values()]
  const exact = nodes.find(node => node.name === target)
  if (exact !== undefined) {
    return exact
  }
  // `data Documents / Document` declares one entity under two names. The model is far likelier to write the
  // singular it sees on every field and parameter, and a field that merely ends in `.Document` is a worse
  // answer than the entity the name actually denotes.
  const singular = nodes.find(node => node.kind === 'entity' && node.detail?.['singular'] === target)
  return singular ?? nodes.find(node => node.name.endsWith(`.${target}`))
}

export function inspect(snapshot: SemanticSnapshot, target: string, budget = 1500): Json {
  const node = resolveTarget(snapshot, target)
  if (node === undefined) {
    return {
      error: `Unknown target: ${target}`,
      hint: 'Use an id from overview() such as view:DocumentEditor or Document.Final.',
    }
  }
  const out = edgesFrom(snapshot, node.id)
  const inn = edgesTo(snapshot, node.id)
  const outgoing = (rel: SnapshotEdge['rel']): string[] => fact(out.filter(e => e.rel === rel))
  const incoming = (rel: SnapshotEdge['rel']): string[] => fact(inn.filter(e => e.rel === rel))
  const result: Json = {
    id: node.id,
    kind: node.kind,
    ...(node.path === undefined ? {} : { source: `src:${node.path}:${node.start}-${node.end}` }),
    ...(node.detail ?? {}),
  }
  /** A design bundle and a design token are inspected the same way: by who styles with them. */
  const styledBy = (): void => {
    const users = inn.filter(e => e.rel === 'styled-by')
    result['usedByRenders'] = fact(users)
    result['blastRadius'] = users.length
    result['usedInViews'] = uniq(users.map(e => String(detailOf(snapshot, e.from)['owner'])))
  }
  /** A kind with no facts of its own beyond the id, source, and detail every node carries. */
  const noFacts = (): void => {}
  Switch.kind<SnapshotNode, void>(node, {
    action: () => {
      result['writes'] = outgoing('writes')
      result['reads'] = outgoing('reads')
      result['invokedBy'] = incoming('invokes')
    },
    app: () => {
      result['design'] = outgoing('uses-design')
      result['scenarios'] = incoming('covers')
    },
    bundle: styledBy,
    design: noFacts,
    element: noFacts,
    entity: () => {
      const fieldPrefix = `field:${String((node.detail as Json)['singular'])}.`
      const onFields = (rel: SnapshotEdge['rel']): string[] =>
        fact(snapshot.edges.filter(e => e.rel === rel && e.to.startsWith(fieldPrefix)))
      result['writtenBy'] = onFields('writes')
      result['readBy'] = onFields('reads')
    },
    field: () => {
      result['writtenBy'] = incoming('writes')
      result['readBy'] = incoming('reads')
    },
    fixture: noFacts,
    query: noFacts,
    render: noFacts,
    scenario: () => {
      result['covers'] = outgoing('covers')
    },
    state: noFacts,
    token: styledBy,
    view: () => {
      result['renders'] = [...snapshot.nodes.values()].filter(n =>
        n.kind === 'render' && (n.detail as Json)['owner'] === node.name
      ).map(n =>
        `${n.id} ${String((n.detail as Json)['target'])}${
          (n.detail as Json)['tag'] === undefined ? '' : ` ${String((n.detail as Json)['tag'])}`
        } [${((n.detail as Json)['layout'] as string[]).join(', ')}]`
      )
      result['stylesUsed'] = uniq(
        snapshot.edges.filter(e =>
          e.rel === 'styled-by' && e.from.startsWith('render:')
          && detailOf(snapshot, e.from)['owner'] === node.name
        ).map(e => e.to),
      )
        .map(id => `${id} [${(detailOf(snapshot, id)['entries'] as string[]).join(', ')}] (poc-derived)`)
      result['reads'] = outgoing('reads')
      result['rendersViews'] = outgoing('renders')
      result['renderedBy'] = incoming('renders')
      result['coveredByScenarios'] = incoming('covers')
      result['diagnostics'] = snapshot.diagnostics.filter(d =>
        d.filePath !== undefined && node.path !== undefined && d.filePath.endsWith(node.path)
      )
        .slice(0, 5).map(d => `${d.severity}: ${d.message}`)
    },
  })
  return truncate(result, budget)
}

function detailOf(snapshot: SemanticSnapshot, id: string): Json {
  return snapshot.nodes.get(id)?.detail as Json
}

export function trace(snapshot: SemanticSnapshot, target: string, relationship: string, budget = 1500): Json {
  const node = resolveTarget(snapshot, target)
  if (node === undefined) {
    return { error: `Unknown target: ${target}` }
  }
  const rel = relationship.replace(/_/g, '-')
  const edges = snapshot.edges.filter(e => e.rel === rel && (e.from === node.id || e.to === node.id))
  if (edges.length === 0) {
    const supported = uniq(snapshot.edges.filter(e => e.from === node.id || e.to === node.id).map(e => e.rel))
    return {
      id: node.id,
      relationship: rel,
      results: [],
      supportedRelationships: supported,
      note: 'No edges of that relationship for this target.',
    }
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
    if (Array.isArray(entry) && entry.length > 6) {
      trimmed[key] = [...entry.slice(0, 6), `… ${entry.length - 6} more`]
    }
    text = JSON.stringify(trimmed)
    if (text.length <= budget) {
      break
    }
  }
  return { ...trimmed, truncated: true }
}

// Studio agent chat: proving that an authored change only authored what it said it would.
//
// The scenario mode's promise is that it cannot change app code until a person allows it, and that promise
// was enforced by which tools existed. That is not enough: `proposeScenario` built its fixture by splicing
// model-supplied strings into the app's own source, and a row that closes the fixture block and opens an
// `action` produces a file the formatter accepts happily. The formatter is a syntax gate, not a scope gate.
//
// This is the scope gate. It parses the source before and after, and reports which top-level declarations
// the change actually added, removed or altered — so a tool can refuse anything beyond what it promised,
// whatever the model wrote inside its arguments.

import { AST, Parser } from '@parser'

type DeclarationChange = {
  added: readonly string[]
  removed: readonly string[]
  /** True when a declaration present in both has different source text. */
  altered: readonly string[]
}

type DeclarationOccurrence = { key: string; source: string }

let context: ReturnType<typeof Parser.createContext> | undefined

function kindOf(node: AST.Node): string | undefined {
  if (AST.isFixtureDeclaration(node)) {
    return 'fixture'
  }
  if (AST.isScenarioGroupDeclaration(node)) {
    return 'scenarios'
  }
  if (AST.isViewDeclaration(node)) {
    return 'view'
  }
  if (AST.isActionDeclaration(node)) {
    return 'action'
  }
  if (AST.isAppDeclaration(node)) {
    return 'app'
  }
  if (AST.isEntityDataDeclaration(node)) {
    // The semantic snapshot and proposeEdit call this declaration an entity. The scope gate must use the
    // same public kind or every legitimate entity replacement is refused as an unrelated data declaration.
    return 'entity'
  }
  if (AST.isDesignDeclaration(node)) {
    return 'design'
  }
  if (AST.isTestDeclaration(node)) {
    return 'test'
  }
  if (AST.isAliasDeclaration(node)) {
    return 'alias'
  }
  if (AST.isCommandDeclaration(node)) {
    return 'command'
  }
  if (AST.isDatasourceDeclaration(node)) {
    return 'datasource'
  }
  if (AST.isFunctionDeclaration(node)) {
    return 'function'
  }
  if (AST.isNavDeclaration(node)) {
    return 'nav'
  }
  if (AST.isPrimitiveDeclaration(node)) {
    return 'primitive'
  }
  if (AST.isTypeDeclaration(node)) {
    return 'type'
  }
  // ParsedStatement is intentionally broader than Tao's valid file declarations so validators can explain
  // bad placement. A future or context-only statement at file level must still be visible to this security
  // gate; silently ignoring an unfamiliar AST kind turns the next grammar addition into a scope escape.
  const type = node.$type
  const words = type.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return type.endsWith('Declaration')
    ? words.replace(/-declaration$/, '')
    : `statement-${words}`
}

/** declarations lists every top-level declaration occurrence. An array preserves duplicate names. */
async function declarations(source: string): Promise<DeclarationOccurrence[]> {
  context ??= Parser.createContext()
  const parsed = await Parser.parseSource(context, source, { validation: false })
  const found: DeclarationOccurrence[] = []
  for (const file of parsed.files) {
    for (const node of AST.streamAllContents(file.ast)) {
      const kind = kindOf(node)
      // Only top level: a view declared inside another declaration is that declaration's business.
      if (kind === undefined || node.$container?.$type !== 'TaoFile') {
        continue
      }
      const name = (node as { name?: string }).name ?? '(unnamed)'
      found.push({ key: `${kind} ${name}`, source: node.$cstNode?.text ?? '' })
    }
  }
  return found
}

/** declarationChange says what one edit did to a file's top-level declarations. */
async function declarationChange(before: string, after: string): Promise<DeclarationChange> {
  const [was, now] = await Promise.all([declarations(before), declarations(after)])
  const keys = new Set([...was.map(entry => entry.key), ...now.map(entry => entry.key)])
  const added: string[] = []
  const removed: string[] = []
  const altered: string[] = []
  for (const key of keys) {
    const beforeBodies = was.filter(entry => entry.key === key).map(entry => entry.source)
    const afterBodies = now.filter(entry => entry.key === key).map(entry => entry.source)
    // First cancel bodies that stayed byte-for-byte equal. What remains is either an altered occurrence or
    // a genuinely added/removed duplicate. A Map keyed only by name silently discarded all of these cases.
    for (let index = beforeBodies.length - 1; index >= 0; index -= 1) {
      const match = afterBodies.indexOf(beforeBodies[index]!)
      if (match >= 0) {
        beforeBodies.splice(index, 1)
        afterBodies.splice(match, 1)
      }
    }
    const changed = Math.min(beforeBodies.length, afterBodies.length)
    altered.push(...Array.from({ length: changed }, () => key))
    removed.push(...beforeBodies.slice(changed).map(() => key))
    added.push(...afterBodies.slice(changed).map(() => key))
  }
  return { added, altered, removed }
}

/**
 * requireOnly refuses a change that touched anything but the kinds a tool promised to author. The message is
 * written for the model: it names what it actually did, because a model that wrote a stray brace has no other
 * way to find out.
 */
export async function requireOnly(
  before: string,
  after: string,
  allowedKinds: readonly string[],
  /** Declarations this change is expected to rewrite, as `kind Name` — a suite gaining a check, say. */
  allowedAltered: readonly string[] = [],
  /** Exact declarations expected to be added. Supplying this also limits how many duplicates may appear. */
  allowedAdded?: readonly string[],
): Promise<string | undefined> {
  const change = await declarationChange(before, after)
  const additionsLeft = allowedAdded === undefined ? undefined : [...allowedAdded]
  const disallowedAdded = change.added.filter(entry => {
    if (!allowedKinds.includes(entry.split(' ')[0]!)) {
      return true
    }
    if (additionsLeft === undefined) {
      return false
    }
    const expected = additionsLeft.indexOf(entry)
    if (expected < 0) {
      return true
    }
    additionsLeft.splice(expected, 1)
    return false
  })
  const offending = [
    ...disallowedAdded,
    ...change.removed.map(entry => `removed ${entry}`),
    ...change.altered.filter(entry => !allowedAltered.includes(entry)).map(entry => `changed ${entry}`),
  ]
  if (offending.length === 0) {
    return undefined
  }
  const permitted = allowedKinds.length === 0
    ? 'may not add a declaration at all'
    : `may only add ${allowedKinds.join(' or ')} declarations`
  return `That would also ${
    offending.join(', ')
  }. This mode ${permitted}; check your arguments for a stray brace or quote.`
}

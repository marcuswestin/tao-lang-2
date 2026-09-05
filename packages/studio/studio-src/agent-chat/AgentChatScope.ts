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
    return 'data'
  }
  if (AST.isDesignDeclaration(node)) {
    return 'design'
  }
  if (AST.isTestDeclaration(node)) {
    return 'test'
  }
  return undefined
}

/** declarations lists a file's top-level declarations as `kind Name`, with the text of each. */
async function declarations(source: string): Promise<Map<string, string>> {
  context ??= Parser.createContext()
  const parsed = await Parser.parseSource(context, source, { validation: false })
  const found = new Map<string, string>()
  for (const file of parsed.files) {
    for (const node of AST.streamAllContents(file.ast)) {
      const kind = kindOf(node)
      // Only top level: a view declared inside another declaration is that declaration's business.
      if (kind === undefined || node.$container?.$type !== 'TaoFile') {
        continue
      }
      const name = (node as { name?: string }).name ?? '(unnamed)'
      found.set(`${kind} ${name}`, node.$cstNode?.text ?? '')
    }
  }
  return found
}

/** declarationChange says what one edit did to a file's top-level declarations. */
async function declarationChange(before: string, after: string): Promise<DeclarationChange> {
  const [was, now] = await Promise.all([declarations(before), declarations(after)])
  const added = [...now.keys()].filter(key => !was.has(key))
  const removed = [...was.keys()].filter(key => !now.has(key))
  const altered = [...now.keys()].filter(key => was.has(key) && was.get(key) !== now.get(key))
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
): Promise<string | undefined> {
  const change = await declarationChange(before, after)
  const offending = [
    ...change.added.filter(entry => !allowedKinds.includes(entry.split(' ')[0]!)),
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

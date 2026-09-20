import * as AST from './parserASTExport'

type LinkerReference = AST.Document['references'][number]

/**
 * DECLARATION_WORDS spells each grammar cross-reference type in the word a Tao author writes. A
 * reference that does not resolve is the most common mistake a newcomer makes, and Langium's own
 * message names the grammar type it was looking for — `RenderTarget`, `EntityDataField` — which is
 * an internal name no Tao program contains. An unlisted type falls back to its spaced-out spelling,
 * so a cross-reference added to the grammar later still reads as words rather than as a type name.
 */
const DECLARATION_WORDS: Readonly<Record<string, string>> = {
  ActionDeclaration: 'action',
  AppDeclaration: 'app',
  AppValueDeclaration: 'app or alias',
  CaseDeclaration: 'case',
  CaseSetCase: 'case',
  CommandDeclaration: 'command',
  ConstructorDeclaration: 'type',
  Declaration: 'declaration',
  EntityDataDeclaration: 'data entity',
  EntityDataField: 'field',
  FixtureAccountDeclaration: 'fixture account',
  FixtureDeclaration: 'fixture',
  FixtureValueDeclaration: 'fixture value',
  FunctionDeclaration: 'function',
  ListedDeclaration: 'data entity or value',
  NamedDeclaration: 'declaration',
  RefinementBaseDeclaration: 'type or value',
  RenderSlotContract: 'render slot',
  // A scene is a view and a nav is a scene, so one word covers every render target.
  RenderTarget: 'view',
  ScenarioSubjectDeclaration: 'app or view',
  StateDeclaration: 'state',
  TypeDeclaration: 'type',
  UsePackageStatement: 'package',
  ValueDeclaration: 'value',
  ViewDeclaration: 'view',
}

/** declarationWord returns the Tao word for a grammar cross-reference type. */
export function declarationWord(referenceType: string): string {
  return DECLARATION_WORDS[referenceType] ?? referenceType.replaceAll(/(?<!^)([A-Z])/g, ' $1').toLowerCase()
}

/**
 * unresolvedReferenceMessage states an unresolved cross-reference in Tao's vocabulary, or returns
 * undefined when the grammar does not declare the property as a cross-reference and Langium's own
 * message is all there is. A grammar type name must not reach an author-facing diagnostic, but the
 * name and the position the author needs both survive here.
 */
export function unresolvedReferenceMessage(reference: LinkerReference): string | undefined {
  const info = reference.error?.info
  if (info === undefined) {
    return undefined
  }
  const referenceType = AST.reflection.getTypeMetaData(info.container.$type).properties[info.property]?.referenceType
  if (referenceType === undefined) {
    return undefined
  }
  return `No ${declarationWord(referenceType)} named '${reference.$refText}' is in scope.`
}

/**
 * The head name of a bridged expression names a TypeScript export (Decisions §15), so it is not
 * expected to resolve in Tao scope and an unresolved reference there is not a linking error. Its
 * arguments are ordinary Tao values and still have to resolve, so only the head is exempt.
 */
export function bridgesToATypeScriptExport(reference: LinkerReference): boolean {
  const info = reference.error?.info
  const container = info?.container
  if (!container || !AST.isFromExpression(container.$container)) {
    return false
  }
  const bridged = container.$container.expression
  if (AST.isFunctionCallExpression(container)) {
    return container === bridged && info.property === 'function'
  }
  return AST.isValueReference(container) && container === bridged && info.property === 'target'
}

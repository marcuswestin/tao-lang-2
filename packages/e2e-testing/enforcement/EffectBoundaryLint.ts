import { FS } from '@shared'
import ts from 'typescript'

/**
 * The e2e package checks only source files expanded from its registered patterns. It recognizes direct global
 * members, literal globalThis members, and aliases/destructuring declared in the same source file.
 * Computed property names, values returned from functions, re-exports, and aliases that cross files
 * are deliberately outside this syntax-only scope.
 */
export const HOST_TEST_EFFECT_BOUNDARY_SCOPE =
  'direct globals, literal globalThis members, and same-file aliases/destructuring in participating files'

export type HostTestLintIssue = Readonly<{
  file: string
  line: number
  message: string
}>

export type HostTestSourceOptions = Readonly<{
  filePath?: string
  approvedEffectAdapter?: Readonly<{ name: string }>
}>

export type HostTestSourcesOptions = Readonly<{
  files: readonly string[]
  /** Exact root-relative file names mapped to the adapter that owns their ambient effects. */
  approvedEffectAdapters?: Readonly<Record<string, string>>
}>

type Effect =
  | 'date'
  | 'date-now'
  | 'math'
  | 'math-random'
  | 'performance'
  | 'performance-now'
  | 'crypto'
  | 'crypto-random-uuid'
  | 'crypto-random-values'
  | 'global-this'
  | 'timer'

type Scope = {
  parent?: Scope
  bindings: Map<string, Effect | undefined>
}

const timerNames = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'requestAnimationFrame',
  'requestIdleCallback',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'cancelAnimationFrame',
  'cancelIdleCallback',
])

const prohibitedImportSegments = new Set([
  'testing',
  'dev-tests',
  'studio-smoke',
  'TR-tests',
  'runtime-toolchain-tests',
])

/** lintHostTestSources reads exactly the registered participating files. */
export async function lintHostTestSources(
  root: string,
  options: HostTestSourcesOptions,
): Promise<HostTestLintIssue[]> {
  const adapterNames = options.approvedEffectAdapters ?? {}
  const issues = await Promise.all(options.files.map(async file => {
    const rootRelativeFile = FS.relativePath(root, FS.resolvePath(file, root))
    const adapterName = adapterNames[rootRelativeFile]
    return lintHostTestSource(await FS.readText(FS.resolvePath(file, root)), {
      filePath: rootRelativeFile,
      approvedEffectAdapter: adapterName === undefined ? undefined : { name: adapterName },
    })
  }))
  return issues.flat()
}

/** lintHostTestSource is the pure, file-local form used by the enforcement self-tests. */
export function lintHostTestSource(source: string, options: HostTestSourceOptions = {}): HostTestLintIssue[] {
  const file = options.filePath ?? '<host-test-source>'
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const issues: HostTestLintIssue[] = []
  const sourceScope = newScope()
  const hasApprovedEffectAdapter = options.approvedEffectAdapter !== undefined
    && options.approvedEffectAdapter.name.trim().length !== 0

  const issue = (node: ts.Node, message: string) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    issues.push({ file, line, message })
  }

  const reportEffect = (node: ts.Node, effect: Effect) => {
    if (hasApprovedEffectAdapter) {
      return
    }
    issue(node, `Ambient effect ${effectDisplay(effect)} is forbidden; use a named host-test adapter.`)
  }

  const resolveIdentifier = (name: string, scope: Scope): Effect | undefined => {
    for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
      if (current.bindings.has(name)) {
        return current.bindings.get(name)
      }
    }
    return globalEffect(name)
  }

  const effectOf = (node: ts.Expression, scope: Scope): Effect | undefined => {
    const expression = unwrap(node)
    if (ts.isIdentifier(expression)) {
      return resolveIdentifier(expression.text, scope)
    }
    if (ts.isPropertyAccessExpression(expression)) {
      return propertyEffect(effectOf(expression.expression, scope), expression.name.text)
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
      const property = stringLiteralValue(expression.argumentExpression)
      return property === undefined ? undefined : propertyEffect(effectOf(expression.expression, scope), property)
    }
    return undefined
  }

  const visitStatements = (statements: ts.NodeArray<ts.Statement>, scope: Scope) => {
    for (const statement of statements) {
      visit(statement, scope)
    }
  }

  const visit = (node: ts.Node, scope: Scope): void => {
    if (ts.isSourceFile(node)) {
      visitStatements(node.statements, scope)
      return
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      visitStatements(node.statements, newScope(scope))
      return
    }
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier) && isProhibitedImport(node.moduleSpecifier.text)) {
        issue(
          node.moduleSpecifier,
          `Legacy testing import '${node.moduleSpecifier.text}' is forbidden in host-testing sources.`,
        )
      }
      bindImport(node.importClause, scope)
      return
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression !== undefined) {
        const specifier = stringLiteralValue(node.moduleReference.expression)
        if (specifier !== undefined && isProhibitedImport(specifier)) {
          issue(
            node.moduleReference.expression,
            `Legacy testing import '${specifier}' is forbidden in host-testing sources.`,
          )
        }
      }
      bind(scope, node.name.text)
      return
    }
    if (
      ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
      && isProhibitedImport(node.moduleSpecifier.text)
    ) {
      issue(
        node.moduleSpecifier,
        `Legacy testing import '${node.moduleSpecifier.text}' is forbidden in host-testing sources.`,
      )
      return
    }
    if (isFunctionLikeWithBody(node)) {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        bind(scope, node.name.text)
      }
      const functionScope = newScope(scope)
      for (const parameter of node.parameters) {
        bindPattern(functionScope, parameter.name)
      }
      for (const parameter of node.parameters) {
        if (parameter.initializer !== undefined) {
          visit(parameter.initializer, functionScope)
        }
        visitBindingInitializers(parameter.name, functionScope, visit)
      }
      if (node.body !== undefined) {
        visit(node.body, functionScope)
      }
      return
    }
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      bind(scope, node.name.text)
      ts.forEachChild(node, child => visit(child, scope))
      return
    }
    if (ts.isCatchClause(node)) {
      const catchScope = newScope(scope)
      if (node.variableDeclaration !== undefined) {
        bindPattern(catchScope, node.variableDeclaration.name)
      }
      visit(node.block, catchScope)
      return
    }
    if (ts.isForStatement(node)) {
      const loopScope = loopScopeFor(node.initializer, scope)
      if (node.initializer !== undefined) {
        visit(node.initializer, loopScope)
      }
      if (node.condition !== undefined) {
        visit(node.condition, loopScope)
      }
      if (node.incrementor !== undefined) {
        visit(node.incrementor, loopScope)
      }
      visit(node.statement, loopScope)
      return
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = loopScopeFor(node.initializer, scope)
      visit(node.expression, scope)
      visit(node.initializer, loopScope)
      visit(node.statement, loopScope)
      return
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer !== undefined) {
        visit(node.initializer, scope)
      }
      visitBindingInitializers(node.name, scope, visit)
      bindPattern(scope, node.name, node.initializer === undefined ? undefined : effectOf(node.initializer, scope))
      return
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      visit(node.right, scope)
      if (ts.isIdentifier(node.left)) {
        setBinding(scope, node.left.text, effectOf(node.right, scope))
      } else {
        visit(node.left, scope)
      }
      return
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const effect = effectOf(node.expression, scope)
      if (effect !== undefined && isAmbientCall(effect, node)) {
        reportEffect(node.expression, effect)
      }
      const arguments_ = node.arguments ?? []
      if (
        ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && arguments_.length === 1
      ) {
        const argument = arguments_[0]
        if (argument === undefined) {
          return
        }
        const specifier = stringLiteralValue(argument)
        if (specifier !== undefined && isProhibitedImport(specifier)) {
          issue(argument, `Legacy testing import '${specifier}' is forbidden in host-testing sources.`)
        }
      }
      if (
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && arguments_.length === 1
      ) {
        const argument = arguments_[0]
        if (argument !== undefined) {
          const specifier = stringLiteralValue(argument)
          if (specifier !== undefined && isProhibitedImport(specifier)) {
            issue(argument, `Legacy testing import '${specifier}' is forbidden in host-testing sources.`)
          }
        }
      }
      ts.forEachChild(node, child => visit(child, scope))
      return
    }
    ts.forEachChild(node, child => visit(child, scope))
  }

  visit(sourceFile, sourceScope)
  return issues
}

function newScope(parent?: Scope): Scope {
  return { parent, bindings: new Map() }
}

function bind(scope: Scope, name: string, effect?: Effect): void {
  scope.bindings.set(name, effect)
}

function setBinding(scope: Scope, name: string, effect?: Effect): void {
  for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
    if (current.bindings.has(name)) {
      current.bindings.set(name, effect)
      return
    }
  }
}

function bindImport(clause: ts.ImportClause | undefined, scope: Scope): void {
  if (clause === undefined) {
    return
  }
  if (clause.name !== undefined) {
    bind(scope, clause.name.text)
  }
  const bindings = clause.namedBindings
  if (bindings === undefined) {
    return
  }
  if (ts.isNamespaceImport(bindings)) {
    bind(scope, bindings.name.text)
    return
  }
  for (const element of bindings.elements) {
    bind(scope, element.name.text)
  }
}

function bindPattern(scope: Scope, name: ts.BindingName, effect?: Effect): void {
  if (ts.isIdentifier(name)) {
    bind(scope, name.text, effect)
    return
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue
    }
    const property = element.propertyName === undefined
      ? ts.isIdentifier(element.name) ? element.name.text : undefined
      : propertyNameText(element.propertyName)
    bindPattern(scope, element.name, property === undefined ? undefined : propertyEffect(effect, property))
  }
}

function visitBindingInitializers(
  name: ts.BindingName,
  scope: Scope,
  visit: (node: ts.Node, scope: Scope) => void,
): void {
  if (ts.isIdentifier(name)) {
    return
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue
    }
    if (element.initializer !== undefined) {
      visit(element.initializer, scope)
    }
    visitBindingInitializers(element.name, scope, visit)
  }
}

function loopScopeFor(initializer: ts.ForInitializer | undefined, scope: Scope): Scope {
  return initializer !== undefined && ts.isVariableDeclarationList(initializer) && isLexicalDeclarationList(initializer)
    ? newScope(scope)
    : scope
}

function isLexicalDeclarationList(list: ts.VariableDeclarationList): boolean {
  return (list.flags & ts.NodeFlags.Let) !== 0 || (list.flags & ts.NodeFlags.Const) !== 0
}

function globalEffect(name: string): Effect | undefined {
  if (name === 'Date') {
    return 'date'
  }
  if (name === 'Math') {
    return 'math'
  }
  if (name === 'performance') {
    return 'performance'
  }
  if (name === 'crypto') {
    return 'crypto'
  }
  if (name === 'globalThis') {
    return 'global-this'
  }
  return timerNames.has(name) ? 'timer' : undefined
}

function propertyEffect(receiver: Effect | undefined, property: string): Effect | undefined {
  if (receiver === 'global-this') {
    return globalEffect(property)
  }
  if (receiver === 'date' && property === 'now') {
    return 'date-now'
  }
  if (receiver === 'math' && property === 'random') {
    return 'math-random'
  }
  if (receiver === 'performance' && property === 'now') {
    return 'performance-now'
  }
  if (receiver === 'crypto' && property === 'randomUUID') {
    return 'crypto-random-uuid'
  }
  if (receiver === 'crypto' && property === 'getRandomValues') {
    return 'crypto-random-values'
  }
  return undefined
}

function isAmbientCall(effect: Effect, node: ts.CallExpression | ts.NewExpression): boolean {
  if (effect === 'date') {
    return ts.isCallExpression(node) || node.arguments === undefined || node.arguments.length === 0
  }
  return effect !== 'math' && effect !== 'performance' && effect !== 'crypto' && effect !== 'global-this'
}

function effectDisplay(effect: Effect): string {
  if (effect === 'date') {
    return 'Date()'
  }
  if (effect === 'date-now') {
    return 'Date.now()'
  }
  if (effect === 'math-random') {
    return 'Math.random()'
  }
  if (effect === 'performance-now') {
    return 'performance.now()'
  }
  if (effect === 'crypto-random-uuid') {
    return 'crypto.randomUUID()'
  }
  if (effect === 'crypto-random-values') {
    return 'crypto.getRandomValues()'
  }
  return 'a raw timer scheduling or clearing call'
}

function isProhibitedImport(specifier: string): boolean {
  if (specifier === '@shared/test' || specifier.startsWith('@shared/test/')) {
    return true
  }
  return specifier.split('/').some(segment => prohibitedImportSegments.has(segment))
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclarationBase & { body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && 'body' in node && node.body !== undefined
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function stringLiteralValue(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }
  if (file.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

import ts from 'typescript'

const runtimeRoot = 'packages/runtime/TaoRuntime-src/'
const helperPath = `${runtimeRoot}TR-create-element.ts`

const ELEMENT_CALL_DETAIL = 'builds an element outside `TR-create-element`; use `createElement` from'
  + ' `TR-create-element` (`TR.createElement`) instead.'
const JSX_DETAIL = 'uses JSX; build the element with `createElement` from `TR-create-element`'
  + ' (`TR.createElement`) instead.'

/** Keep every runtime element built through the one `createElement` chokepoint, never `React.createElement`
 * or JSX, so development tooling always sees an element before React does. */
export function runtimeElementConventionIssues(files: readonly { path: string; source: string }[]): string[] {
  return files.flatMap(file => {
    if (!file.path.startsWith(runtimeRoot)) {
      return []
    }
    const exempt = file.path === helperPath
    const scriptKind = file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, scriptKind)
    const issues: string[] = []
    const visit = (node: ts.Node): void => {
      if (!exempt && isBannedElementCall(node)) {
        issues.push(issueAt(file.path, source, node, ELEMENT_CALL_DETAIL))
      }
      if (isJsxNode(node)) {
        issues.push(issueAt(file.path, source, node, JSX_DETAIL))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return issues
  })
}

function isBannedElementCall(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isReactExpression(node.expression) && node.name.text === 'createElement'
  }
  if (ts.isElementAccessExpression(node)) {
    return isReactExpression(node.expression)
      && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === 'createElement'
  }
  if (ts.isImportDeclaration(node)) {
    return importsCreateElementFromReact(node)
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    return isReactExpression(bindingPatternSource(node.parent))
      && staticPropertyName(node.propertyName ?? node.name) === 'createElement'
  }
  return ts.isIdentifier(node) && node.text === 'createReactElement'
}

function isReactExpression(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isIdentifier(node) && node.text === 'React'
}

function bindingPatternSource(pattern: ts.ObjectBindingPattern): ts.Node | undefined {
  return ts.isVariableDeclaration(pattern.parent) ? pattern.parent.initializer : undefined
}

function importsCreateElementFromReact(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'react') {
    return false
  }
  const namedBindings = node.importClause?.namedBindings
  if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
    return false
  }
  return namedBindings.elements.some(element => staticPropertyName(element.propertyName ?? element.name) === 'createElement')
}

function staticPropertyName(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined
}

function isJsxNode(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function issueAt(path: string, source: ts.SourceFile, node: ts.Node, detail: string): string {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  return `${path}:${line} ${detail}`
}

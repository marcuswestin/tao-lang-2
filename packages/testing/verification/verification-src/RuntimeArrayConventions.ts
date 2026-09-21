import ts from 'typescript'

const runtimeRoot = 'packages/apps/runtime/TaoRuntime-src/'
const helperPath = `${runtimeRoot}core/Arrays.ts`
const operations = new Map([
  ['sort', 'Arrays.sorted (or Arrays.sortInPlace for intentional mutation)'],
  ['reverse', 'Arrays.reversed'],
  ['toSorted', 'Arrays.sorted'],
  ['toReversed', 'Arrays.reversed'],
])

/** Keep array ordering behind one portable implementation throughout the shipped runtime. */
export function runtimeArrayConventionIssues(files: readonly { path: string; source: string }[]): string[] {
  return files.flatMap(file => {
    if (!file.path.startsWith(runtimeRoot) || file.path === helperPath) {
      return []
    }
    const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true)
    const issues: string[] = []
    const visit = (node: ts.Node): void => {
      const member = orderingMember(node)
      if (member !== undefined) {
        const replacement = operations.get(member)
        if (replacement !== undefined) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          issues.push(`${file.path}:${line} accesses raw array ${member}; use ${replacement} from RuntimeCore.`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return issues
  })
}

function orderingMember(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    return staticPropertyName(node.propertyName ?? node.name)
  }
  if (
    (ts.isShorthandPropertyAssignment(node) || ts.isPropertyAssignment(node))
    && isDestructuringAssignmentTarget(node.parent)
  ) {
    return staticPropertyName(node.name)
  }
  return undefined
}

function staticPropertyName(name: ts.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return undefined
}

function isDestructuringAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent
  if (parent === undefined) {
    return false
  }
  if (ts.isBinaryExpression(parent)) {
    return parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  }
  if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
    return parent.initializer === node
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return isDestructuringAssignmentTarget(parent.parent)
  }
  if (ts.isArrayLiteralExpression(parent) || ts.isParenthesizedExpression(parent)) {
    return isDestructuringAssignmentTarget(parent)
  }
  return false
}

import * as ts from 'typescript'

export type SidecarSpecifier = Readonly<{
  end: number
  form: 'static' | 'dynamic' | 'reexport' | 'require'
  start: number
  /** Named bindings used only as TypeScript types. */
  typeNames: readonly string[]
  value: string
  /** Named bindings that require the imported module at runtime. */
  valueNames: readonly string[]
  /** A namespace, side-effect, dynamic, or require edge can use any runtime export. */
  runtimeNamespace: boolean
}>

export type NonliteralSidecarImport = Readonly<{
  end: number
  form: 'dynamic' | 'require'
  start: number
}>

/** Reads module paths in executable loaders and TypeScript import type queries. */
export function sidecarModuleSpecifiers(source: string, sourcePath?: string): SidecarSpecifier[] {
  return scanSidecarImports(source, sourcePath).specifiers
}

/** Computed loader paths cannot be checked or copied as relative dependencies. */
export function nonliteralSidecarImports(source: string, sourcePath?: string): NonliteralSidecarImport[] {
  return scanSidecarImports(source, sourcePath).nonliteral
}

function scanSidecarImports(source: string, sourcePath?: string): {
  specifiers: SidecarSpecifier[]
  nonliteral: NonliteralSidecarImport[]
} {
  const fileName = sourcePath ?? 'Sidecar.tsx'
  const scriptKind = /\.tsx$/i.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(fileName)
    ? ts.ScriptKind.JSX
    : /\.js$/i.test(fileName)
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const bindings = requireBindings(file)
  const specifiers: SidecarSpecifier[] = []
  const nonliteral: NonliteralSidecarImport[] = []
  const add = (
    literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
    form: SidecarSpecifier['form'],
    intent: Pick<SidecarSpecifier, 'typeNames' | 'valueNames' | 'runtimeNamespace'>,
  ) => {
    specifiers.push({ start: literal.getStart(file), end: literal.getEnd(), value: literal.text, form, ...intent })
  }
  const addCall = (call: ts.CallExpression, form: NonliteralSidecarImport['form']) => {
    const argument = call.arguments[0]
    if (argument === undefined) {
      return
    }
    let value = argument
    while (
      ts.isParenthesizedExpression(value) || ts.isAsExpression(value)
      || ts.isTypeAssertionExpression(value) || ts.isSatisfiesExpression(value)
      || ts.isNonNullExpression(value)
    ) {
      value = value.expression
    }
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      add(value, form, { typeNames: [], valueNames: [], runtimeNamespace: true })
    } else {
      nonliteral.push({ start: argument.getStart(file), end: argument.getEnd(), form })
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier, 'static', importIntent(node.importClause))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier, 'reexport', exportIntent(node))
    } else if (ts.isImportTypeNode(node)) {
      // Import type queries are dependency edges, but cannot load a computed path at runtime.
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        add(node.argument.literal, 'dynamic', { typeNames: [], valueNames: [], runtimeNamespace: false })
      }
    } else if (
      ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression, 'require', {
        typeNames: [],
        valueNames: [],
        runtimeNamespace: !node.isTypeOnly,
      })
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addCall(node, 'dynamic')
      } else if (
        ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && !isRequireBound(node.expression, bindings)
      ) {
        addCall(node, 'require')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  specifiers.sort((left, right) => left.start - right.start)
  nonliteral.sort((left, right) => left.start - right.start)
  return { specifiers, nonliteral }
}

function importIntent(clause: ts.ImportClause | undefined): Pick<
  SidecarSpecifier,
  'typeNames' | 'valueNames' | 'runtimeNamespace'
> {
  if (!clause) {
    return { typeNames: [], valueNames: [], runtimeNamespace: true }
  }
  const typeNames: string[] = []
  const valueNames: string[] = []
  if (clause.name) {
    ;(clause.isTypeOnly ? typeNames : valueNames).push('default')
  }
  const bindings = clause.namedBindings
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      const name = element.propertyName?.text ?? element.name.text
      const names = clause.isTypeOnly || element.isTypeOnly ? typeNames : valueNames
      names.push(name)
    }
  }
  return {
    typeNames,
    valueNames,
    runtimeNamespace: bindings !== undefined && ts.isNamespaceImport(bindings) && !clause.isTypeOnly,
  }
}

function exportIntent(declaration: ts.ExportDeclaration): Pick<
  SidecarSpecifier,
  'typeNames' | 'valueNames' | 'runtimeNamespace'
> {
  const typeNames: string[] = []
  const valueNames: string[] = []
  const clause = declaration.exportClause
  if (clause && ts.isNamedExports(clause)) {
    for (const element of clause.elements) {
      const name = element.propertyName?.text ?? element.name.text
      const names = declaration.isTypeOnly || element.isTypeOnly ? typeNames : valueNames
      names.push(name)
    }
  }
  return {
    typeNames,
    valueNames,
    runtimeNamespace: (clause === undefined || ts.isNamespaceExport(clause)) && !declaration.isTypeOnly,
  }
}

function requireBindings(file: ts.SourceFile): ReadonlyMap<ts.Node, boolean> {
  const bindings = new Map<ts.Node, boolean>()
  const bind = (scope: ts.Node, name: ts.BindingName | ts.Identifier | undefined): void => {
    if (name === undefined) {
      return
    }
    if (ts.isIdentifier(name)) {
      if (name.text === 'require') {
        bindings.set(scope, true)
      }
    } else {
      name.elements.forEach(element => {
        if (ts.isBindingElement(element)) {
          bind(scope, element.name)
        }
      })
    }
  }
  const visit = (node: ts.Node): void => {
    if (isAmbient(node)) {
      return
    }
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent
      const scope = ts.isCatchClause(list)
        ? list
        : ts.isVariableDeclarationList(list) && !(list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))
        ? nearestFunctionScope(node)
        : nearestLexicalScope(node)
      bind(scope, node.name)
    } else if (ts.isParameter(node)) {
      bind(node.parent, node.name)
    } else if (ts.isCatchClause(node)) {
      bind(node, node.variableDeclaration?.name)
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      bind(nearestLexicalScope(node), node.name)
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      bind(nearestLexicalScope(node), node.name)
    } else if (ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
      bind(node, node.name)
    } else if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) {
        return
      }
      bind(file, node.importClause?.name)
      const named = node.importClause?.namedBindings
      if (named && ts.isNamespaceImport(named)) {
        bind(file, named.name)
      } else if (named && ts.isNamedImports(named)) {
        named.elements.filter(element => !element.isTypeOnly).forEach(element => bind(file, element.name))
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      bind(file, node.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return bindings
}

function isAmbient(node: ts.Node): boolean {
  if (node.getSourceFile().isDeclarationFile) {
    return true
  }
  for (let ancestor: ts.Node | undefined = node; ancestor !== undefined; ancestor = ancestor.parent) {
    if (
      ts.canHaveModifiers(ancestor)
      && ts.getModifiers(ancestor)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    ) {
      return true
    }
  }
  return false
}

function isRequireBound(node: ts.Node, bindings: ReadonlyMap<ts.Node, boolean>): boolean {
  for (let ancestor: ts.Node | undefined = node.parent; ancestor !== undefined; ancestor = ancestor.parent) {
    if (bindings.has(ancestor)) {
      return true
    }
  }
  return false
}

function nearestLexicalScope(node: ts.Node): ts.Node {
  for (let ancestor = node.parent; ancestor !== undefined; ancestor = ancestor.parent) {
    if (
      ts.isBlock(ancestor) || ts.isSourceFile(ancestor) || ts.isCaseBlock(ancestor)
      || ts.isForStatement(ancestor) || ts.isForInStatement(ancestor) || ts.isForOfStatement(ancestor)
    ) {
      return ancestor
    }
  }
  return node.getSourceFile()
}

function nearestFunctionScope(node: ts.Node): ts.Node {
  for (let ancestor = node.parent; ancestor !== undefined; ancestor = ancestor.parent) {
    if (ts.isFunctionLike(ancestor) || ts.isSourceFile(ancestor)) {
      return ancestor
    }
  }
  return node.getSourceFile()
}

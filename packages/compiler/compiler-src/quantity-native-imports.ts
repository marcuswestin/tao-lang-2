import { FS } from '@shared'
import * as ts from 'typescript'

/** QuantityNativeImportTarget names the one leaf and the ordinary exports of an emitted Tao source. */
export type QuantityNativeImportTarget = Readonly<{
  modulePath: string
  declarationsPath?: string
  quantity: Readonly<{
    path: string
    namespaceExport: string
    facadeNamespaceExport: string
    /** Includes only quantity type aliases that do not shadow an existing native contract. */
    typeExportsByName: ReadonlyMap<string, string>
  }>
}>

type Edit = Readonly<{ start: number; end: number; text: string }>

/** Route quantity constructors/types directly to their leaf, retaining other native import bindings. */
export function rewriteQuantityNativeImports(
  source: string,
  sourcePath: string,
  outputPath: string,
  targetForSource: (path: string) => QuantityNativeImportTarget | undefined,
): string {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true)
  const checker = bindingChecker(file, source)
  const names = new Set<string>()
  const collectNames = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      names.add(node.text)
    }
    ts.forEachChild(node, collectNames)
  }
  collectNames(file)
  const reserve = (base: string): string => {
    let name = base
    for (let suffix = 1; names.has(name); suffix++) {
      name = `${base}_${suffix}`
    }
    names.add(name)
    return name
  }
  const edits: Edit[] = []
  const importPath = (target: string): string => {
    const relative = FS.relativePath(FS.dirname(outputPath), target).replace(/\.(?:d\.ts|[cm]?tsx?)$/, '')
    return JSON.stringify(relative.startsWith('.') ? relative : `./${relative}`)
  }
  for (const declaration of file.statements) {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) {
      continue
    }
    const path = declaration.moduleSpecifier.text
    if ((!path.startsWith('./') && !path.startsWith('../')) || !path.endsWith('.tao')) {
      continue
    }
    const target = targetForSource(FS.resolvePath(path, FS.dirname(sourcePath)))
    const clause = declaration.importClause
    const bindings = clause?.namedBindings
    if (!target || !clause || !bindings) {
      continue
    }
    const leaf = importPath(target.quantity.path)
    const fallback = importPath(clause.isTypeOnly ? target.declarationsPath ?? target.modulePath : target.modulePath)
    const prefix = clause.isTypeOnly ? 'type ' : ''
    const statements: string[] = []
    if (ts.isNamedImports(bindings)) {
      const quantity: string[] = []
      const ordinary: string[] = []
      for (const element of bindings.elements) {
        const name = element.propertyName?.text ?? element.name.text
        const typeOnly = clause.isTypeOnly || element.isTypeOnly
        const exported = name === target.quantity.facadeNamespaceExport
          ? target.quantity.namespaceExport
          : typeOnly
          ? target.quantity.typeExportsByName.get(name)
          : undefined
        if (!exported) {
          ordinary.push(element.getText(file))
          continue
        }
        quantity.push(
          `${!clause.isTypeOnly && element.isTypeOnly ? 'type ' : ''}${exported}${
            exported === element.name.text ? '' : ` as ${element.name.text}`
          }`,
        )
      }
      if (quantity.length === 0) {
        continue
      }
      statements.push(`import ${prefix}{ ${quantity.join(', ')} } from ${leaf};`)
      const defaultBinding = clause.name?.text
      if (defaultBinding || ordinary.length > 0) {
        const rest = ordinary.length > 0 ? `{ ${ordinary.join(', ')} }` : ''
        statements.push(
          `import ${prefix}${defaultBinding ?? ''}${defaultBinding && rest ? ', ' : ''}${rest} from ${fallback};`,
        )
      }
    } else {
      const symbol = checker.getSymbolAtLocation(bindings.name)
      if (!symbol) {
        continue
      }
      const aliases = new Map<string, string>()
      let unhandled = false
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
          return
        }
        if (ts.isIdentifier(node) && referencedSymbol(checker, node) === symbol) {
          const parent = node.parent
          const member = ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? parent.name.text
            : ts.isElementAccessExpression(parent) && parent.expression === node
                && ts.isStringLiteral(parent.argumentExpression)
            ? parent.argumentExpression.text
            : ts.isQualifiedName(parent) && parent.left === node
            ? parent.right.text
            : undefined
          const exported = member === target.quantity.facadeNamespaceExport
            ? target.quantity.namespaceExport
            : member !== undefined && ts.isQualifiedName(parent)
            ? target.quantity.typeExportsByName.get(member)
            : undefined
          if (!exported) {
            unhandled = true
          } else {
            let alias = aliases.get(exported)
            if (!alias) {
              alias = reserve(`__TaoQuantity_${bindings.name.text}_${exported}`)
              aliases.set(exported, alias)
            }
            edits.push({ start: parent.getStart(file), end: parent.getEnd(), text: alias })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
      if (aliases.size === 0) {
        continue
      }
      // Keep imports on the original line: copied native diagnostics retain their authored line numbers.
      statements.push(
        `import ${prefix}{ ${
          [...aliases].map(([exported, alias]) => `${exported} as ${alias}`).join(', ')
        } } from ${leaf};`,
      )
      if (unhandled) {
        statements.push(
          `import ${prefix}${clause.name ? `${clause.name.text}, ` : ''}* as ${bindings.name.text} from ${fallback};`,
        )
      } else if (clause.name) {
        statements.push(`import ${prefix}${clause.name.text} from ${fallback};`)
      }
    }
    edits.push({ start: declaration.getStart(file), end: declaration.getEnd(), text: statements.join(' ') })
  }
  for (const edit of edits.toSorted((left, right) => right.start - left.start)) {
    const original = source.slice(edit.start, edit.end)
    const padding = '\n'.repeat(original.split('\n').length - edit.text.split('\n').length)
    source = `${source.slice(0, edit.start)}${edit.text}${padding}${source.slice(edit.end)}`
  }
  return source
}

/** Shorthand properties and local exports bind their value separately from the property/export name. */
function referencedSymbol(checker: ts.TypeChecker, node: ts.Identifier): ts.Symbol | undefined {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return checker.getShorthandAssignmentValueSymbol(parent)
  }
  if (ts.isExportSpecifier(parent) && (parent.propertyName ?? parent.name) === node) {
    const declaration = parent.parent.parent
    if (ts.isExportDeclaration(declaration) && !declaration.moduleSpecifier) {
      return checker.getExportSpecifierLocalTargetSymbol(parent)
    }
  }
  return checker.getSymbolAtLocation(node)
}

/** Bind only this source's lexical symbols; no library or imported module is read or executed. */
function bindingChecker(file: ts.SourceFile, source: string): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: path => path === file.fileName ? file : undefined,
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => FS.dirname(file.fileName),
    getDirectories: () => [],
    fileExists: path => path === file.fileName,
    readFile: path => path === file.fileName ? source : undefined,
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  return ts.createProgram([file.fileName], { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest }, host)
    .getTypeChecker()
}

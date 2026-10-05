import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'

/** Private export names are stable for a source module, independent of the selected app graph. */
export function associatedWitnessExports(file: AST.TaoFile): ReadonlyMap<AST.TypeDeclaration, string> {
  const reserved = authoredNames(file)
  const exports = new Map<AST.TypeDeclaration, string>()
  for (const owner of file.statements.filter(AST.isTypeDeclaration)) {
    if (ASTUtils.ownAssociatedMethods(owner).length > 0) {
      exports.set(owner, allocate('__tao_associated_witness_', exports.size + 1, reserved))
    }
  }
  return exports
}

/** Imports address the actual defining owner, even when the receiver is a descendant or an alias. */
export function planAssociatedWitnessBindings(
  file: AST.TaoFile,
  ownExports: ReadonlyMap<AST.TypeDeclaration, string>,
  referencedOwners: ReadonlySet<AST.TypeDeclaration>,
  exportedByOwner: ReadonlyMap<AST.TypeDeclaration, string>,
  reservedBindings: readonly string[] = [],
) {
  const reserved = new Set([...authoredNames(file), ...reservedBindings, ...ownExports.values()])
  const bindings = new Map(ownExports)
  const imports: { owner: AST.TypeDeclaration; sourcePath: string; exported: string; binding: string }[] = []
  for (const owner of referencedOwners) {
    if (bindings.has(owner)) {
      continue
    }
    Assert(AST.findRoot(owner) !== file, 'Expected a selected local associated owner to have its witness binding.')
    const exported = exportedByOwner.get(owner)
    Assert.defined(exported, 'Expected the defining module to publish the referenced associated witness.')
    const binding = allocate('__tao_associated_import_', imports.length + 1, reserved)
    bindings.set(owner, binding)
    imports.push({ owner, sourcePath: AST.getDocument(owner).uri.path, exported, binding })
  }
  return { bindings, imports }
}

function authoredNames(file: AST.TaoFile): Set<string> {
  const names = new Set<string>()
  for (const node of AST.streamAllContents(file)) {
    if ('name' in node && typeof node.name === 'string') {
      names.add(node.name)
    }
  }
  for (const use of file.statements.filter(AST.isUseStatement)) {
    use.importedDeclarations.forEach(reference => names.add(reference.$refText))
  }
  return names
}

function allocate(prefix: string, index: number, reserved: Set<string>): string {
  const preferred = `${prefix}${index}__`
  let binding = preferred
  for (let suffix = 1; reserved.has(binding); suffix++) {
    binding = `${preferred}${suffix}`
  }
  reserved.add(binding)
  return binding
}

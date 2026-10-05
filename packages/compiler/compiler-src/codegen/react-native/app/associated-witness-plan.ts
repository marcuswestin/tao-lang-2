import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { hasAssociatedWitnessPublication } from './AssociatedMethodsCompiler'
import { capabilityTransportOwners } from './capability-projection'

/** Private export names are stable for a source module, independent of the selected app graph. */
export function associatedWitnessExports(file: AST.TaoFile): ReadonlyMap<AST.TypeDeclaration, string> {
  const reserved = authoredNames(file)
  const exports = new Map<AST.TypeDeclaration, string>()
  for (const owner of file.statements.filter(AST.isTypeDeclaration)) {
    if (hasAssociatedWitnessPublication(owner)) {
      exports.set(owner, allocate('__tao_associated_witness_', exports.size + 1, reserved))
    }
  }
  return exports
}

/** Method references use the canonical selected defining owner, independent of receiver spelling. */
export function referencedAssociatedWitnessOwners(
  statements: readonly AST.Statement[],
): ReadonlySet<AST.TypeDeclaration> {
  const owners = new Set<AST.TypeDeclaration>()
  const transport = (expression: AST.Expression, expected: ASTUtils.TaoType) => {
    for (const owner of capabilityTransportOwners(Type.ofExpression(expression), expected)) {
      owners.add(owner)
    }
  }
  for (const statement of statements) {
    for (const node of [statement, ...AST.streamAllContents(statement)]) {
      if (AST.isParameterDeclaration(node) && node.defaultValue) {
        transport(node.defaultValue, Type.ofParameter(node))
      }
      if (AST.isReturnStatement(node)) {
        let owner: AST.Node | undefined = node.$container
        while (owner && !AST.isFunctionDeclaration(owner) && !AST.isAssociatedFunctionDeclaration(owner)) {
          owner = owner.$container
        }
        Assert(
          owner && (AST.isFunctionDeclaration(owner) || AST.isAssociatedFunctionDeclaration(owner)),
          'Expected a function return owner.',
        )
        transport(node.value, Type.ofFunctionReturn(owner))
      }
      if (
        AST.isFunctionCallExpression(node)
        && !(AST.isFromExpression(node.$container) && node.$container.expression === node)
      ) {
        const invocation = ASTUtils.resolveFunctionInvocation(node)
        Assert(
          invocation.function && invocation.diagnostics.length === 0,
          'Expected a validated function call correspondence.',
        )
        invocation.pairs.forEach(pair => transport(pair.argument.value, Type.ofParameter(pair.parameter)))
      }
      if (!AST.isMethodCallExpression(node)) {
        continue
      }
      const invocation = ASTUtils.resolveAssociatedMethodInvocation(node)
      Assert(
        invocation.problem === undefined && invocation.diagnostics.length === 0,
        'Expected a validated associated call to retain its canonical correspondence.',
      )
      Assert.defined(invocation.descriptor, 'Expected a validated associated call to select its descriptor.')
      if (AST.isAssociatedFunctionDeclaration(invocation.descriptor.declaration)) {
        owners.add(invocation.descriptor.owner)
      }
      invocation.pairs.forEach(pair => transport(pair.argument.value, Type.ofParameter(pair.parameter)))
    }
  }
  return owners
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
  const names = new Set(ASTUtils.referencedNames(file))
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

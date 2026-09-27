import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'

export type DeclarationIdentityProject = {
  id: string
  root: string
}

type DeclarationIdentityContext = {
  projects: readonly DeclarationIdentityProject[]
}

let activeContext: DeclarationIdentityContext | undefined

/** withDeclarationIdentityContext scopes owner metadata to one synchronous generated module pass. */
export function withDeclarationIdentityContext<ResultT>(
  projects: readonly DeclarationIdentityProject[],
  compile: () => ResultT,
): ResultT {
  Assert(activeContext === undefined, 'declaration identity compilation is not nested')
  activeContext = { projects }
  try {
    return compile()
  } finally {
    activeContext = undefined
  }
}

export type DeclarationIdentityOptions = {
  /**
   * kind replaces the declaration-kind slot of the identity tuple. Sugar that synthesizes a runtime
   * declaration the source never names uses it to sit beside the declaration it is derived from
   * rather than on top of it. Every kind `declarationKind` produces is a single lowercase word or a
   * grammar `$type`, so a hyphenated kind cannot collide with an authored declaration's identity.
   */
  kind?: string
}

/** compileDeclarationIdentity emits the canonical, owner-relative identity for one declaration. */
export function compileDeclarationIdentity(
  declaration: AST.Declaration,
  options: DeclarationIdentityOptions = {},
): Compiled {
  const canonical = canonicalDeclaration(declaration)
  const context = activeContext
  Assert.defined(context, 'declaration identity context is active')
  const filePath = AST.getDocument(canonical).uri.path
  const project = context.projects
    .filter(candidate => FS.pathIsWithin(filePath, candidate.root))
    .toSorted((left, right) => right.root.length - left.root.length)[0]
  Assert.defined(project, 'declaration belongs to a project with checked-in identity', { filePath })
  const { modulePath, packageId } = ownerRelativeLocation(project.root, filePath)
  return gen`TR.Navigation.Identity(${
    gen.jsLiteral([
      'tao.declaration',
      1,
      project.id,
      packageId,
      modulePath,
      options.kind ?? declarationKind(canonical),
      canonical.name,
    ])
  })`
}

/** declarationModuleName returns the owner-relative module one declaration was written in. */
export function declarationModuleName(declaration: AST.Declaration): string {
  const context = activeContext
  Assert.defined(context, 'declaration identity context is active')
  const filePath = AST.getDocument(canonicalDeclaration(declaration)).uri.path
  const project = context.projects
    .filter(candidate => FS.pathIsWithin(filePath, candidate.root))
    .toSorted((left, right) => right.root.length - left.root.length)[0]
  Assert.defined(project, 'declaration belongs to a project with checked-in identity', { filePath })
  const { modulePath, packageId } = ownerRelativeLocation(project.root, filePath)
  return `${packageId}/${modulePath}`
}

/** canonicalDeclaration follows lexical view aliases and app variants to their authored owner. */
export function canonicalDeclaration(declaration: AST.Declaration): AST.Declaration {
  if (AST.isViewDeclaration(declaration) && declaration.aliasTarget) {
    return canonicalDeclaration(resolveRef(declaration.aliasTarget.member))
  }
  if (AST.isAppValueDeclaration(declaration)) {
    return ASTUtils.rootAppValue(declaration) ?? declaration
  }
  return declaration
}

function ownerRelativeLocation(projectRoot: string, filePath: string): { modulePath: string; packageId: string } {
  const relative = FS.relativePath(projectRoot, filePath)
  const segments = relative.split('/')
  const packageIndex = segments.findIndex(segment => segment.startsWith('@'))
  if (packageIndex < 0) {
    return { modulePath: extensionless(relative), packageId: '@workspace' }
  }

  // Scoped stdlib packages are authored as @tao/<package>; ordinary project packages are one
  // checked-in @folder. Both IDs belong to the defining project and survive consumer renaming.
  const scoped = segments[packageIndex] === '@tao' && segments[packageIndex + 1] !== undefined
  const packageLength = scoped ? 2 : 1
  const packageId = segments.slice(packageIndex, packageIndex + packageLength).join('/')
  const modulePath = segments.slice(packageIndex + packageLength).join('/')
  return { modulePath: extensionless(modulePath), packageId }
}

function extensionless(path: string): string {
  const extension = FS.extname(path)
  const result = extension.length === 0 ? path : path.slice(0, -extension.length)
  Assert(result.length > 0, 'declaration module path is non-empty', { path })
  return result
}

function declarationKind(declaration: AST.Declaration): string {
  if (AST.isViewDeclaration(declaration)) {
    return 'view'
  }
  if (AST.isAppValueDeclaration(declaration)) {
    return 'app'
  }
  if (AST.isConfigurableDeclaration(declaration)) {
    return AST.configurationPrimitiveOf(declaration) ?? 'configuration'
  }
  if (AST.isNavDeclaration(declaration)) {
    return 'nav'
  }
  return declaration.$type
}

import { Packages } from '@ast-utils'
import { AST, type ProjectGraph, type ProjectRequirement } from '@parser'
import { FS } from '@shared'
import type { ValidationContext } from '../validation'

/** requirementOwnershipMessages explains which owner must select a dependency. */
export const requirementOwnershipMessages = {
  app: (name: string, alias: string) =>
    `App ${name} uses external module '${alias}'; declare a matching requires clause on this app or its base app.`,
  publication: (name: string, alias: string) =>
    `Package ${name} uses external module '${alias}'; declare a matching requires clause in this package publication.`,
} as const

/** requirementProjectGraph shares the linked project graph across validators in one build. */
export function requirementProjectGraph(ctx: ValidationContext): ProjectGraph {
  return ctx.memo('package-validator.projectGraph', () =>
    Packages.createResolver(ctx.packagesContext).projectGraph({
      fromFilePath: ctx.entryFilePath,
      workspaceFiles: ctx.workspaceFiles,
    }))
}

export function validateAppRequirementOwnership(app: AST.AppValueDeclaration, ctx: ValidationContext): void {
  const graph = requirementProjectGraph(ctx)
  const selection = graph.appRequirements.find(entry => entry.app === app)
  validateReachableReferences(
    app,
    selection?.sourceDeclarations ?? [app],
    selection?.requirements ?? [],
    ctx,
    alias => requirementOwnershipMessages.app(app.name, alias),
  )
}

export function validatePublicationRequirementOwnership(
  publication: AST.PackageDeclaration,
  ctx: ValidationContext,
): void {
  const selected = requirementProjectGraph(ctx).publications.find(entry => entry.declaration === publication)
  if (!selected) {
    return
  }
  validateReachableReferences(
    publication,
    selected.publicDeclarations,
    selected.requirements,
    ctx,
    alias => requirementOwnershipMessages.publication(selected.name ?? 'unnamed', alias),
  )
}

function validateReachableReferences(
  owner: AST.Node,
  seeds: readonly AST.Node[],
  requirements: readonly ProjectRequirement[],
  ctx: ValidationContext,
  message: (alias: string) => string,
): void {
  const ownRoot = Packages.projectRootForPath(ctx.packagesContext.index, AST.getDocument(owner).uri.path)
  if (!ownRoot) {
    return
  }
  const visited = new Set<AST.Node>()
  const reported = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const declaration = queue.shift()!
    if (visited.has(declaration)) {
      continue
    }
    visited.add(declaration)
    for (const node of [declaration, ...AST.streamAllContents(declaration)]) {
      for (const reference of AST.streamReferences(node)) {
        const target = 'ref' in reference.reference ? reference.reference.ref : undefined
        if (!target) {
          continue
        }
        const targetPath = AST.getDocument(target).uri.path
        if (FS.pathIsWithin(targetPath, ctx.packagesContext.stdlibRoot)) {
          continue
        }
        const targetRoot = Packages.projectRootForPath(ctx.packagesContext.index, targetPath)
        if (!targetRoot || targetRoot === ownRoot) {
          const local = enclosingDeclaration(target)
          if (local && targetRoot === ownRoot && !visited.has(local)) {
            queue.push(local)
          }
          continue
        }
        const imported = enclosingDeclaration(target)
        const alias = imported && importAlias(node, imported)
        const permitted = alias && imported
          && requirements.some(requirement =>
            requirement.selectedPublication?.publicDeclarations.includes(imported)
            && requirement.bindings.some(binding =>
              binding.localName === alias
              && binding.origin.projectRoot === targetRoot
              && FS.pathIsWithin(targetPath, binding.sourceRoot)
            )
          )
        if (!permitted) {
          const label = alias ?? imported?.name ?? targetPath
          if (!reported.has(label)) {
            ctx.error(owner, message(label))
            reported.add(label)
          }
        }
      }
    }
  }
}

function enclosingDeclaration(node: AST.Node): AST.Declaration | undefined {
  let current: AST.Node | undefined = node
  while (current && !AST.isTaoFile(current)) {
    if (AST.isDeclaration(current) && AST.isTaoFile(current.$container)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function importAlias(source: AST.Node, declaration: AST.Declaration): string | undefined {
  if (AST.isPackageMemberReference(source)) {
    const namespace = source.namespace.ref
    if (namespace) {
      return namespace.importPath.split('/')[0]
    }
  }
  const file = AST.getDocument(source).parseResult.value
  if (!AST.isTaoFile(file)) {
    return undefined
  }
  return file.statements.filter(AST.isUseStatement)
    .find(use => use.importedDeclarations.some(reference => reference.ref === declaration))
    ?.importPath?.split('/')[0]
}

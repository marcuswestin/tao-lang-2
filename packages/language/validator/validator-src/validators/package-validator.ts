import { Packages } from '@ast-utils'
import { AST, codeProjectRoot } from '@parser'
import { FS } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import {
  requirementProjectGraph,
  validatePublicationRequirementOwnership,
} from './requirement-ownership-validator'

/** packageValidationMessages owns diagnostics for publication and requirement contracts. */
export const packageValidationMessages = {
  marker: () => 'A Tao project needs a .tao/ directory at its root.',
  rootOnly: () => 'A package publication must be declared in a project-root Tao file.',
  duplicateDefault: () => 'A project can declare only one unnamed package publication.',
  duplicateNamed: (name: string) => `Package publication '${name}' is declared more than once in this project.`,
  duplicateField: (field: string) => `A package publication can declare ${field} only once.`,
  invalidVersion: (version: string) => `Package version '${version}' must be a valid SemVer version.`,
  invalidRange: (range: string) => `Required version '${range}' must be a valid SemVer range.`,
  invalidModule: (module: string) => `Included module '${module}' must name a project-root @module folder.`,
  duplicateModule: (module: string) => `Module '${module}' is included more than once in this publication.`,
  requirementPlacement: () => 'A requires clause belongs in a package publication, app, or app variant.',
  targetProject: (locator: string) => `Required project '${locator}' needs a .tao/ directory at its root.`,
  publicationMissing: (name: string) => `Required package ${name} is not published by that project.`,
  versionMismatch: (name: string, version: string, range: string) =>
    `Required package ${name} publishes version ${version}, which does not satisfy ${range}.`,
  moduleNotIncluded: (module: string, name: string) =>
    `Module '${module}' is not included by required package ${name}.`,
  aliasCollision: (alias: string) => `Required module alias '${alias}' names different origins in this project.`,
  invalidAlias: (alias: string) => `Required module alias '${alias}' must name a single @module folder.`,
} as const

const exactVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const moduleName = /^@[A-Za-z][A-Za-z0-9._-]*$/u

export function isValidSemverVersion(version: string): boolean {
  return exactVersion.test(version)
}

/** validatePackageWorkspace checks the project-wide publication and dependency namespace. */
export function validatePackageWorkspace(ctx: ValidationContext): void {
  const root = Packages.projectRootForPath(ctx.packagesContext.index, ctx.entryFilePath)
    ?? FS.dirname(ctx.entryFilePath)
  if (!ctx.entryFilePath.startsWith(`${codeProjectRoot}/`) && !hasProjectMarker(root)) {
    const entry = ctx.workspaceFiles.find(file => AST.getDocument(file).uri.path === ctx.entryFilePath)
    if (entry) {
      ctx.error(entry, packageValidationMessages.marker())
    }
  }
  const graph = requirementProjectGraph(ctx)
  const publications = graph.publications.filter(publication =>
    FS.dirname(AST.getDocument(publication.declaration).uri.path) === root
  )
  const firstByName = new Map<string, AST.PackageDeclaration>()
  for (const publication of publications) {
    const key = publication.name ?? ''
    if (firstByName.has(key)) {
      ctx.error(
        publication.declaration,
        key ? packageValidationMessages.duplicateNamed(key) : packageValidationMessages.duplicateDefault(),
      )
    } else {
      firstByName.set(key, publication.declaration)
    }
  }
  const aliases = new Map<string, string>()
  for (const requirement of graph.requirements) {
    const declaration = requirement.declaration
    if (!validRange(requirement.versionRange)) {
      ctx.error(declaration, packageValidationMessages.invalidRange(requirement.versionRange))
      continue
    }
    if (declaration.ts) {
      const alias = declaration.alias ?? ''
      const identity = `ts:${declaration.npm ?? ''}@${requirement.versionRange}`
      const previous = aliases.get(alias)
      if (previous && previous !== identity) {
        ctx.error(declaration, packageValidationMessages.aliasCollision(alias))
      } else {
        aliases.set(alias, identity)
      }
      continue
    }
    if (!requirement.targetProjectRoot || !hasProjectMarker(requirement.targetProjectRoot)) {
      ctx.error(declaration, packageValidationMessages.targetProject(declaration.locator ?? ''))
      continue
    }
    const targetPublications = graph.publications.filter(publication =>
      FS.dirname(AST.getDocument(publication.declaration).uri.path) === requirement.targetProjectRoot
      && publication.name === requirement.requestedName
    )
    const label = requirement.requestedName ? `'${requirement.requestedName}'` : 'the unnamed package'
    if (targetPublications.length === 0) {
      ctx.error(declaration, packageValidationMessages.publicationMissing(label))
      continue
    }
    if (!requirement.selectedPublication) {
      const version = targetPublications[0]?.version ?? '(missing)'
      ctx.error(declaration, packageValidationMessages.versionMismatch(label, version, requirement.versionRange))
      continue
    }
    for (const binding of declaration.bindings?.bindings ?? []) {
      const alias = binding.alias ?? binding.module
      if (!moduleName.test(alias)) {
        ctx.error(binding, packageValidationMessages.invalidAlias(alias))
        continue
      }
      const moduleRoot = FS.resolvePath(binding.module, requirement.targetProjectRoot)
      if (!requirement.selectedPublication.includedModuleRoots.includes(moduleRoot)) {
        ctx.error(binding, packageValidationMessages.moduleNotIncluded(binding.module, label))
        continue
      }
      const localModule = (ctx.packagesContext.index.packages.get(alias) ?? []).some(path =>
        Packages.projectRootForPath(ctx.packagesContext.index, path) === root
      )
      if (localModule) {
        ctx.error(binding, packageValidationMessages.aliasCollision(alias))
        continue
      }
      const identity = `${requirement.targetProjectRoot}#${
        requirement.selectedPublication.name ?? ''
      }@${requirement.selectedPublication.version}:${moduleRoot}`
      const previous = aliases.get(alias)
      if (previous && previous !== identity) {
        ctx.error(binding, packageValidationMessages.aliasCollision(alias))
      } else {
        aliases.set(alias, identity)
      }
    }
  }
}

function hasProjectMarker(root: string): boolean {
  return isDirectory(FS.resolvePath('.tao', root))
}

function isDirectory(path: string): boolean {
  try {
    FS.listDirSync(path)
    return true
  } catch {
    return false
  }
}

/** packageValidationChecks validates each publication and requirement node. */
export const packageValidationChecks = {
  [AST.PackageDeclaration.$type]: validatePackage,
  [AST.PackageRequires.$type]: validateRequirementPlacement,
} satisfies NodeValidationChecks

export function validatePackageFile(file: AST.TaoFile, ctx: ValidationContext): void {
  const path = AST.getDocument(file).uri.path
  const root = Packages.projectRootForPath(ctx.packagesContext.index, path) ?? FS.dirname(path)
  if (FS.dirname(path) !== root) {
    for (const publication of file.statements.filter(AST.isPackageDeclaration)) {
      ctx.error(publication, packageValidationMessages.rootOnly())
    }
  } else {
    for (const publication of file.statements.filter(AST.isPackageDeclaration)) {
      validatePublicationRequirementOwnership(publication, ctx)
    }
  }
}

function validatePackage(publication: AST.PackageDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(publication.$container)) {
    ctx.error(publication, packageValidationMessages.rootOnly())
  }
  const fields: [string, (node: AST.PackageStatement) => boolean][] = [
    ['name', AST.isPackageName],
    ['version', AST.isPackageVersion],
    ['license', AST.isPackageLicense],
  ]
  for (const [name, predicate] of fields) {
    const matches = publication.block.statements.filter(predicate)
    for (const duplicate of matches.slice(1)) {
      ctx.error(duplicate, packageValidationMessages.duplicateField(name))
    }
  }
  for (const version of publication.block.statements.filter(AST.isPackageVersion)) {
    if (!isValidSemverVersion(version.value)) {
      ctx.error(version, packageValidationMessages.invalidVersion(version.value))
    }
  }
  const modules = new Set<string>()
  for (const includes of publication.block.statements.filter(AST.isPackageIncludes)) {
    const root = FS.dirname(AST.getDocument(publication).uri.path)
    for (const module of includes.modules) {
      if (!moduleName.test(module)) {
        ctx.error(includes, packageValidationMessages.invalidModule(module))
      } else if (!root.startsWith(codeProjectRoot) && !isDirectory(FS.resolvePath(module, root))) {
        ctx.error(includes, packageValidationMessages.invalidModule(module))
      } else if (modules.has(module)) {
        ctx.error(includes, packageValidationMessages.duplicateModule(module))
      }
      modules.add(module)
    }
  }
}

function validateRequirementPlacement(requirement: AST.PackageRequires, ctx: ValidationContext): void {
  const parent = requirement.$container
  if (AST.isPackageBlock(parent) || AST.isAppBlock(parent)) {
    return
  }
  if (AST.isConfigurationEntry(parent)) {
    let owner: AST.Node | undefined = parent.$container
    while (owner && !AST.isTaoFile(owner)) {
      if (AST.isAppValueDeclaration(owner)) {
        return
      }
      owner = owner.$container
    }
  }
  ctx.error(requirement, packageValidationMessages.requirementPlacement())
}

function validRange(range: string): boolean {
  const part = '(?:0|[1-9]\\d*|[xX*])'
  const operand = `${part}(?:\\.${part}){0,2}(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?`
  const comparator = new RegExp(`^(?:[~^]|[<>]=?|=)?${operand}$`, 'u')
  return range.split(/\s*\|\|\s*/u).every(alternative => {
    const terms = alternative.trim().split(/\s+/u)
    return terms.length > 0
      && terms.every((term, index) => term === '-' ? index > 0 && index < terms.length - 1 : comparator.test(term))
  })
}

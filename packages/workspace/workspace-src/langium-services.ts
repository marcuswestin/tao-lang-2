import ASTUtils, { Packages } from '@ast-utils'
import { AST, Langium, Parser, type ParserServices } from '@parser'
import Validator from '@validator'
import { registerTaoValidationChecks } from '@validator/langium-validation'
import { type TaoSpecifics, TaoTypeSystem, type TaoTypirServices } from '@validator/type-system'
import { createTypirLangiumServices, initializeLangiumTypirServices } from 'typir-langium'

/** WorkspaceServices declares Langium and Typir services for non-LSP workspace operations. */
export type WorkspaceServices = ParserServices & {
  packages: ReturnType<typeof Packages.createResolver>
  typir: TaoTypirServices
}

/** WorkspaceLspServices declares Workspace services with Langium LSP support. */
export type WorkspaceLspServices = WorkspaceServices & {
  shared: Langium.LangiumSharedServices
  language: Langium.LangiumServices
}

/** WorkspaceLspContributions declares optional LSP services supplied by the host. */
export type WorkspaceLspContributions = {
  lspFormatter?: () => Langium.Formatter
  lspCodeActionProvider?: () => Langium.CodeActionProvider
}

/** createWorkspaceServices creates parser, validator, and Typir services for one package context. */
export function createWorkspaceServices(packagesContext: Packages.Context): WorkspaceServices {
  const packages = Packages.createResolver(packagesContext)
  const parserContext = Parser.createContext({
    packages,
  })
  const typir = createTypirLangiumServices<TaoSpecifics>(
    parserContext.services.shared,
    AST.reflection,
    new TaoTypeSystem(),
  )

  registerTaoValidationChecks(
    parserContext.services.language,
    validationContextFor(parserContext.services, packagesContext, typir),
  )
  initializeLangiumTypirServices(parserContext.services.language, typir)

  return {
    ...parserContext.services,
    packages,
    typir,
  }
}

/** createWorkspaceLspServices creates Langium LSP services for one package context. */
export function createWorkspaceLspServices(
  packagesContext: Packages.Context,
  context: Langium.DefaultSharedModuleContext = Langium.NodeFileSystem,
  contributions: WorkspaceLspContributions = {},
): WorkspaceLspServices {
  const packages = Packages.createResolver(packagesContext)
  const parserContext = Parser.createLspContext({
    packages,
    langiumContext: context,
    ...contributions,
  })
  const typir = createTypirLangiumServices<TaoSpecifics>(
    parserContext.services.shared,
    AST.reflection,
    new TaoTypeSystem(),
  )
  registerTaoValidationChecks(
    parserContext.services.language,
    validationContextFor(parserContext.services, packagesContext, typir),
  )
  initializeLangiumTypirServices(parserContext.services.language, typir)

  return { ...parserContext.services, packages, typir }
}

function validationContextFor(
  services: { shared: Langium.LangiumSharedCoreServices },
  packagesContext: Packages.Context,
  typir: TaoTypirServices,
): (file: AST.TaoFile) => Validator.Context {
  return (file) => {
    const workspaceFiles = Array.from(services.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    return Validator.createContext(
      packagesContext,
      typir,
      workspaceFiles,
      ASTUtils.getDocument(file).uri.path,
    )
  }
}

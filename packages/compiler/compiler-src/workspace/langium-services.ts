import { Packages } from '@ast-utils'
import { Langium, type PackageResolver, Parser, type ParserContext, type ParserServices } from '@parser'
import Validator from '@validator'

/** WorkspaceServices declares Langium services for non-LSP workspace operations. */
export type WorkspaceServices = ParserServices & {
  packages: PackageResolver
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

/** createWorkspaceServices creates parser and validator services for one package context. */
export function createWorkspaceServices(packagesContext: Packages.Context): WorkspaceServices {
  return assembleWorkspaceServices(packagesContext, options => Parser.createContext(options))
}

/** createWorkspaceLspServices creates Langium LSP services for one package context. */
export function createWorkspaceLspServices(
  packagesContext: Packages.Context,
  context: Langium.DefaultSharedModuleContext = Langium.NodeFileSystem,
  contributions: WorkspaceLspContributions = {},
): WorkspaceLspServices {
  return assembleWorkspaceServices(
    packagesContext,
    options =>
      Parser.createLspContext({
        ...options,
        langiumContext: context,
        ...contributions,
        releaseStdlibRoot: packagesContext.stdlibRoot,
      }),
    true,
  )
}

/**
 * assembleWorkspaceServices is the one place the workspace builds on the parser's services: the
 * package resolver both flavors read, and the validation checks both flavors run on every
 * document build. Whatever the workspace adds for the core and LSP flavors alike is added here.
 */
function assembleWorkspaceServices<ServicesT extends ParserServices>(
  packagesContext: Packages.Context,
  createParserContext: (options: { packages: PackageResolver }) => ParserContext<ServicesT>,
  editorRelease = false,
): ServicesT & { packages: PackageResolver } {
  const packages = Packages.createResolver(packagesContext)
  const { services } = createParserContext({ packages })
  Validator.installLangiumChecks(services, packagesContext, editorRelease)
  return { ...services, packages }
}

import { Langium } from '@parser'
import { Assert, FS, Repo, TaoFiles, TaoStdlib } from '@shared'
import {
  createWorkspaceLspServices,
  type WorkspaceLspContributions,
  type WorkspaceLspServices,
} from './langium-services'
import { Workspace } from './Workspace'
import { createProjectContext, type ProjectContext } from './workspace-utils'

/** LSPWorkspace coordinates a Workspace backed by Langium LSP services. */
export class LSPWorkspace extends Workspace<WorkspaceLspServices> {
  private constructor(project: ProjectContext<WorkspaceLspServices>) {
    super(project)
  }

  /** open creates an LSP Workspace rooted at `directoryPath`. */
  static async open(
    directoryPath: string,
    context: Langium.DefaultSharedModuleContext | { sourceOverrides?: Readonly<Record<string, string>> } =
      Langium.NodeFileSystem,
    contributions: WorkspaceLspContributions = {},
  ): Promise<LSPWorkspace> {
    Assert.input(
      !('sourceOverrides' in context) || Object.keys(context.sourceOverrides ?? {}).length === 0,
      'Source overrides are supported by compile workspaces, not language-server workspaces.',
    )
    const langiumContext = 'fileSystemProvider' in context ? context : Langium.NodeFileSystem
    const workspace = new LSPWorkspace(
      await createProjectContext(
        directoryPath,
        packagesContext => createWorkspaceLspServices(packagesContext, langiumContext, contributions),
        undefined,
        await checkoutStdlibRoot(directoryPath),
      ),
    )
    await workspace.loadWorkspaceDocuments()
    return workspace
  }

  /** services returns the Langium LSP services owned by this Workspace. */
  get services(): WorkspaceLspServices {
    return this.project.services
  }

  /** startLanguageServer starts Langium for this LSP Workspace. */
  startLanguageServer(): void {
    Langium.startLanguageServer(this.services.shared)
  }

  // Langium resolves references only against loaded documents, so the stdlib is loaded next to the
  // workspace rather than assumed to be inside it. It only sits inside the workspace root when Tao
  // itself is the open project; a packaged extension carries the stdlib in its own directory.
  private async loadWorkspaceDocuments(): Promise<void> {
    for (const root of [this.project.packagesContext.index.projectRoot, this.project.packagesContext.stdlibRoot]) {
      await this.loadDocumentsUnder(root)
    }
  }

  private async loadDocumentsUnder(root: string): Promise<void> {
    const documents = this.services.shared.workspace.LangiumDocuments
    const factory = this.services.shared.workspace.LangiumDocumentFactory
    for (
      const path of await Repo.filesUnder(root, {
        excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
        extensions: ['.tao'],
      })
    ) {
      const uri = Langium.URI.file(path)
      if (documents.hasDocument(uri)) {
        continue
      }
      documents.addDocument(await factory.fromUri(uri))
    }
  }
}

/**
 * checkoutStdlibRoot is the stdlib inside a Tao checkout. A packaged language server otherwise pins
 * the copy it shipped with, and the checkout's own prelude then fails that pin.
 * `TAO_STDLIB_ROOT` still wins, because that variable is an explicit redirect.
 */
async function checkoutStdlibRoot(workspaceRoot: string): Promise<string | undefined> {
  if (TaoStdlib.declaredRoot() !== undefined) {
    return undefined
  }
  const root = FS.resolvePath('packages/apps/stdlib', workspaceRoot)
  return await FS.isFile(FS.resolvePath('@tao/Prelude.tao', root)) ? root : undefined
}

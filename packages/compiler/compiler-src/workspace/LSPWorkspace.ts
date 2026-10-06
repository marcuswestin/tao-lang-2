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
    publishVersionedDiagnostics(this.services.shared)
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
 * publishVersionedDiagnostics labels every diagnostics publication for a client-open document with
 * the document version its positions were computed from. Langium publishes without a version, so a
 * client that has already sent a newer edit maps the older positions onto its newer text: a
 * character typed and deleted at the end of a file leaves a diagnostic one position past the end,
 * and an editor that maps it throws. With a version the client discards a superseded publication.
 * A publication whose validated text no longer matches the open document is dropped here instead,
 * because the live version would mislabel it and the rebuild for the newer text publishes its own.
 */
function publishVersionedDiagnostics(shared: Langium.LangiumSharedServices): void {
  const connection = shared.lsp.Connection
  if (connection === undefined) {
    return
  }
  const send = connection.sendDiagnostics.bind(connection)
  connection.sendDiagnostics = params => {
    const open = shared.workspace.TextDocuments.get(params.uri)
    if (open === undefined || params.version !== undefined) {
      return send(params)
    }
    const validatedText = shared.workspace.LangiumDocuments.getDocument(Langium.URI.parse(params.uri))
      ?.parseResult.value.$cstNode?.root.fullText
    if (validatedText === undefined) {
      return send(params)
    }
    return validatedText === open.getText() ? send({ ...params, version: open.version }) : Promise.resolve()
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

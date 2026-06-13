import { Langium } from '@parser'
import { FS } from '@shared'
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
    context: Langium.DefaultSharedModuleContext = Langium.NodeFileSystem,
    contributions: WorkspaceLspContributions = {},
  ): Promise<LSPWorkspace> {
    const workspace = new LSPWorkspace(
      await createProjectContext(
        directoryPath,
        packagesContext => createWorkspaceLspServices(packagesContext, context, contributions),
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

  private async loadWorkspaceDocuments(): Promise<void> {
    const documentPaths: string[] = []
    for await (
      const path of FS.walk(this.root, {
        extensions: ['.tao'],
        excludeDirectory: shouldSkipWorkspaceDirectory,
      })
    ) {
      documentPaths.push(path)
    }

    const documents = this.services.shared.workspace.LangiumDocuments
    const factory = this.services.shared.workspace.LangiumDocumentFactory
    for (const path of documentPaths.sort()) {
      const uri = Langium.URI.file(path)
      if (documents.hasDocument(uri)) {
        continue
      }
      documents.addDocument(await factory.fromUri(uri))
    }
  }
}

const WORKSPACE_DOCUMENT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.artifacts',
  '.direnv',
  '.devenv',
  '.expo',
  'ios',
  'android',
])

function shouldSkipWorkspaceDirectory(name: string): boolean {
  return name.startsWith('_gen_') || WORKSPACE_DOCUMENT_IGNORE_DIRS.has(name)
}

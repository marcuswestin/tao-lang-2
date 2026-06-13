import { Langium } from '@parser'
import { createWorkspaceLspServices, type WorkspaceLspServices } from './langium-services'
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
  ): Promise<LSPWorkspace> {
    return new LSPWorkspace(
      await createProjectContext(
        directoryPath,
        packagesContext => createWorkspaceLspServices(packagesContext, context),
      ),
    )
  }

  /** services returns the Langium LSP services owned by this Workspace. */
  get services(): WorkspaceLspServices {
    return this.project.services
  }

  /** startLanguageServer starts Langium for this LSP Workspace. */
  startLanguageServer(): void {
    Langium.startLanguageServer(this.services.shared)
  }
}

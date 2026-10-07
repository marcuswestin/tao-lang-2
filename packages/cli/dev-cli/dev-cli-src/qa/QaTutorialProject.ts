import { FS } from '@shared'

/**
 * QaTutorialProject owns the project the tutorial's screenshot set is captured from. The tutorial app
 * is authored in Markdown, outside the `Apps/` roots, so a capture stages it from a committed copy of
 * its source instead of expecting a hand-made directory.
 */
export class QaTutorialProject {
  /** path is the checkout-relative project directory the `visual:reading-list` surface names. */
  static readonly path = '.artifacts/qa/tutorial-review'
  /** source is the committed Tao source, with its QA scenarios, that the staged project holds. */
  static readonly source = 'Docs/QA/evidence/tutorial-first-hour/capture-source.tao.txt'
  /** file is the project-relative name the surface's capture cells come from. */
  static readonly file = 'ReadingList.tao'

  /** stage writes the project from the committed source, replacing any earlier copy, and returns its directory. */
  static async stage(root: string): Promise<string> {
    const project = FS.resolvePath(QaTutorialProject.path, root)
    await FS.writeText(FS.resolvePath('.tao/.gitkeep', project), '')
    await FS.writeText(
      FS.resolvePath(QaTutorialProject.file, project),
      await FS.readText(FS.resolvePath(QaTutorialProject.source, root)),
    )
    return project
  }

  /** isProject tells whether a capture request names the tutorial project of this checkout. */
  static isProject(root: string, project: string): boolean {
    return FS.resolvePath(project, root) === FS.resolvePath(QaTutorialProject.path, root)
  }
}

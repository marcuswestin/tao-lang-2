import { Assert, FS } from '@shared'

export const studioGeneratedSourceHeader = '// Studio-written generated source. Read-only until moved to a package.'

const generatedMode = 0o444
const ownerWritableMode = 0o644

export type StudioGeneratedSourceWriter = (path: string, content: string) => Promise<void>

/** StudioGeneratedSources owns the reserved @/studio tree and its read-only working-tree contract. */
export class StudioGeneratedSources {
  readonly #studioRoot: string

  constructor(readonly projectRoot: string) {
    this.#studioRoot = FS.resolvePath('@/studio', projectRoot)
  }

  /** repair reasserts read-only mode for every generated Studio Tao file when a project opens. */
  async repair(): Promise<void> {
    if (!await FS.isDirectory(this.#studioRoot)) {
      return
    }
    for await (const path of FS.walk(this.#studioRoot, { extensions: ['.tao'] })) {
      await this.#requireContainedFile(path)
      await FS.chmod(path, generatedMode)
    }
  }

  /** writeView writes one public generated view and restores read-only mode even when a rewrite fails. */
  async writeView(
    name: string,
    body: string,
    writer: StudioGeneratedSourceWriter = FS.writeText,
  ): Promise<string> {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Invalid generated Studio view name: ${name}`)
    const path = FS.resolvePath(`${name}.tao`, this.#studioRoot)
    Assert.input(FS.pathIsWithin(path, this.#studioRoot), `Generated Studio view escapes @/studio: ${name}`)
    if (await FS.exists(path)) {
      await this.#requireContainedFile(path)
      await FS.chmod(path, ownerWritableMode)
    }
    const source = `${studioGeneratedSourceHeader}\n\n${body.trim()}\n`
    try {
      await writer(path, source)
    } finally {
      if (await FS.isFile(path)) {
        await this.#requireContainedFile(path)
        await FS.chmod(path, generatedMode)
      }
    }
    return path
  }

  async #requireContainedFile(path: string): Promise<void> {
    const realPath = await FS.realPath(path)
    const realStudioRoot = await FS.realPath(this.#studioRoot)
    Assert.input(
      FS.pathIsWithin(realPath, realStudioRoot),
      `Generated Studio source resolves outside @/studio: ${FS.relativePath(this.projectRoot, path)}`,
    )
  }
}

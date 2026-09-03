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

  /** moveView transfers one generated view into an existing authored package and makes it writable. */
  async moveView(
    name: string,
    targetPackage: string,
    content: string,
    writer: StudioGeneratedSourceWriter = FS.writeText,
  ): Promise<string> {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Invalid generated Studio view name: ${name}`)
    Assert.input(
      /^@[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*$/.test(targetPackage),
      `Invalid target Tao package: ${targetPackage}`,
    )
    const sourcePath = FS.resolvePath(`${name}.tao`, this.#studioRoot)
    Assert.input(await FS.isFile(sourcePath), `Generated Studio view does not exist: @/studio/${name}.tao`)
    await this.#requireContainedFile(sourcePath)
    const packageRoot = FS.resolvePath(targetPackage, this.projectRoot)
    Assert.input(await FS.isDirectory(packageRoot), `Target Tao package does not exist: ${targetPackage}`)
    const targetPath = FS.resolvePath(`${name}.tao`, packageRoot)
    Assert.input(
      FS.pathIsWithin(targetPath, this.projectRoot),
      `Target Tao package escapes the project: ${targetPackage}`,
    )
    Assert.input(!await FS.exists(targetPath), `Target Tao source already exists: ${targetPackage}/${name}.tao`)
    const original = await FS.readText(sourcePath)
    try {
      await FS.chmod(sourcePath, ownerWritableMode)
      await writer(sourcePath, authoredSource(content))
      await FS.move(sourcePath, targetPath)
      await FS.chmod(targetPath, ownerWritableMode)
      return targetPath
    } catch (error) {
      if (await FS.isFile(targetPath) && !await FS.exists(sourcePath)) {
        await FS.move(targetPath, sourcePath)
      }
      if (await FS.isFile(sourcePath)) {
        await FS.chmod(sourcePath, ownerWritableMode)
        await FS.writeText(sourcePath, original)
        await FS.chmod(sourcePath, generatedMode)
      }
      throw error
    }
  }

  /** rewrite updates another generated import site without surrendering Studio ownership. */
  async rewrite(path: string, content: string, writer: StudioGeneratedSourceWriter = FS.writeText): Promise<void> {
    Assert.input(FS.pathIsWithin(path, this.#studioRoot), 'Generated Studio rewrite must remain under @/studio.')
    await this.#requireContainedFile(path)
    await FS.chmod(path, ownerWritableMode)
    try {
      await writer(path, content)
    } finally {
      if (await FS.isFile(path)) {
        await this.#requireContainedFile(path)
        await FS.chmod(path, generatedMode)
      }
    }
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

function authoredSource(content: string): string {
  return content.replace(`${studioGeneratedSourceHeader}\n\n`, '')
}

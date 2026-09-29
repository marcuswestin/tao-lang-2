import { Assert, Errors, FS } from '@shared'

export const studioGeneratedSourceHeader = '// Studio-written generated source. Read-only until moved to a package.'

const generatedMode = 0o444
const ownerWritableMode = 0o644

export type StudioGeneratedSourceWriter = (path: string, content: string) => Promise<void>

export type StudioGeneratedSource = Readonly<{
  content: string
  path: string
}>

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
    const roots = await this.#requireStudioRoot(false)
    const failures: Array<{ error: unknown; path: string }> = []
    for await (const path of FS.walk(this.#studioRoot, { extensions: ['.tao'] })) {
      try {
        await this.#requireContainedFile(path, roots)
        await FS.chmod(path, generatedMode)
      } catch (error) {
        failures.push({ error, path })
      }
    }
    if (failures.length > 0) {
      Errors.throwHostEnvironment(
        `Studio could not restore read-only ownership for ${failures.length} generated source${
          failures.length === 1 ? '' : 's'
        }; first failure: ${FS.relativePath(this.projectRoot, failures[0]!.path)}.`,
        { cause: failures[0]!.error },
      )
    }
  }

  /** createView creates one new generated view without ever replacing an allocated name. */
  async createView(
    name: string,
    body: string,
    writer: StudioGeneratedSourceWriter = FS.writeText,
  ): Promise<string> {
    const path = this.#viewPath(name)
    Assert.input(!await FS.exists(path), `Generated Studio view already exists: @/studio/${name}.tao`)
    try {
      return await this.writeView(name, body, writer)
    } catch (error) {
      if (await FS.isFile(path)) {
        await this.#requireContainedFile(path)
        await FS.chmod(path, ownerWritableMode)
        await FS.remove(path)
      }
      throw error
    }
  }

  /** readView authenticates one generated view before a source action treats it as Studio-owned. */
  async readView(name: string): Promise<StudioGeneratedSource> {
    const path = this.#viewPath(name)
    Assert.input(await FS.isFile(path), `Generated Studio view does not exist: @/studio/${name}.tao`)
    await this.#requireContainedFile(path)
    const content = await FS.readText(path)
    Assert.input(
      content.startsWith(`${studioGeneratedSourceHeader}\n`),
      `Studio generated view is missing its ownership header: @/studio/${name}.tao`,
    )
    return { content, path }
  }

  /** removeView rolls back a newly-created generated view while retaining the ownership boundary. */
  async removeView(name: string): Promise<void> {
    const path = this.#viewPath(name)
    Assert.input(await FS.isFile(path), `Generated Studio view does not exist: @/studio/${name}.tao`)
    await this.#requireContainedFile(path)
    Assert.input(
      (await FS.readText(path)).startsWith(`${studioGeneratedSourceHeader}\n`),
      `Cannot remove a non-generated Studio view: @/studio/${name}.tao`,
    )
    await FS.chmod(path, ownerWritableMode)
    await FS.remove(path)
  }

  /** writeView writes one public generated view and restores read-only mode even when a rewrite fails. */
  async writeView(
    name: string,
    body: string,
    writer: StudioGeneratedSourceWriter = FS.writeText,
  ): Promise<string> {
    const path = this.#viewPath(name)
    const roots = await this.#requireStudioRoot(true)
    if (await FS.exists(path)) {
      await this.#requireContainedFile(path, roots)
      await FS.chmod(path, ownerWritableMode)
    }
    // No blank line after the header: `tao fix` closes that gap in every Tao file, and a generated
    // file under `@/` refuses to be rewritten, so a blank line here fails `fix` permanently instead.
    const source = `${studioGeneratedSourceHeader}\n${body.trim()}\n`
    try {
      await writer(path, source)
    } finally {
      if (await FS.isFile(path)) {
        await this.#requireContainedFile(path, roots)
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
    const roots = await this.#requireStudioRoot(false)
    await this.#requireContainedFile(sourcePath, roots)
    const packageRoot = FS.resolvePath(targetPackage, this.projectRoot)
    Assert.input(await FS.isDirectory(packageRoot), `Target Tao package does not exist: ${targetPackage}`)
    const realPackageRoot = await FS.realPath(packageRoot)
    Assert.input(
      FS.pathIsWithin(realPackageRoot, roots.realProjectRoot),
      `Target Tao package resolves outside the project: ${targetPackage}`,
    )
    const logicalTargetPath = FS.resolvePath(`${name}.tao`, packageRoot)
    const targetPath = FS.resolvePath(`${name}.tao`, realPackageRoot)
    Assert.input(!await FS.exists(targetPath), `Target Tao source already exists: ${targetPackage}/${name}.tao`)
    const original = await FS.readText(sourcePath)
    try {
      await FS.chmod(sourcePath, ownerWritableMode)
      await writer(sourcePath, authoredSource(content))
      await FS.move(sourcePath, targetPath)
      await FS.chmod(targetPath, ownerWritableMode)
      return logicalTargetPath
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

  /** owns says whether a path sits in the reserved @/studio tree, where every write goes through `rewrite`. */
  owns(path: string): boolean {
    return FS.pathIsWithin(path, this.#studioRoot)
  }

  /** rewrite updates another generated import site without surrendering Studio ownership. */
  async rewrite(path: string, content: string, writer: StudioGeneratedSourceWriter = FS.writeText): Promise<void> {
    Assert.input(FS.pathIsWithin(path, this.#studioRoot), 'Generated Studio rewrite must remain under @/studio.')
    const roots = await this.#requireStudioRoot(false)
    await this.#requireContainedFile(path, roots)
    await FS.chmod(path, ownerWritableMode)
    try {
      await writer(path, content)
    } finally {
      if (await FS.isFile(path)) {
        await this.#requireContainedFile(path, roots)
        await FS.chmod(path, generatedMode)
      }
    }
  }

  async #requireContainedFile(
    path: string,
    roots?: Readonly<{ realProjectRoot: string; realStudioRoot: string }>,
  ): Promise<void> {
    roots ??= await this.#requireStudioRoot(false)
    const realPath = await FS.realPath(path)
    Assert.input(
      FS.pathIsWithin(realPath, roots.realStudioRoot) && FS.pathIsWithin(realPath, roots.realProjectRoot),
      `Generated Studio source resolves outside @/studio: ${FS.relativePath(this.projectRoot, path)}`,
    )
  }

  async #requireStudioRoot(create: boolean): Promise<{ realProjectRoot: string; realStudioRoot: string }> {
    const realProjectRoot = await FS.realPath(this.projectRoot)
    const rootPackage = FS.resolvePath('@', this.projectRoot)
    if (await FS.exists(rootPackage)) {
      Assert.input(await FS.isDirectory(rootPackage), "Tao's root package must be a directory: @")
      const realRootPackage = await FS.realPath(rootPackage)
      Assert.input(
        FS.pathIsWithin(realRootPackage, realProjectRoot),
        "Tao's root package resolves outside the project: @",
      )
    }
    if (create && !await FS.exists(this.#studioRoot)) {
      await FS.mkdir(this.#studioRoot)
    }
    Assert.input(await FS.isDirectory(this.#studioRoot), 'Generated Studio root must be a directory: @/studio')
    const realStudioRoot = await FS.realPath(this.#studioRoot)
    Assert.input(
      FS.pathIsWithin(realStudioRoot, realProjectRoot),
      'Generated Studio root resolves outside the project: @/studio',
    )
    return { realProjectRoot, realStudioRoot }
  }

  #viewPath(name: string): string {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Invalid generated Studio view name: ${name}`)
    const path = FS.resolvePath(`${name}.tao`, this.#studioRoot)
    Assert.input(FS.pathIsWithin(path, this.#studioRoot), `Generated Studio view escapes @/studio: ${name}`)
    return path
  }
}

function authoredSource(content: string): string {
  const header = `${studioGeneratedSourceHeader}\n`
  Assert.input(content.startsWith(header), 'Generated Studio source is missing its ownership header.')
  // A file written before the header sat flush against the source still moves out cleanly.
  return content.slice(header.length).replace(/^\n+/u, '')
}

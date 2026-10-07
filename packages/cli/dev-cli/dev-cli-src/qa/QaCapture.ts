import { Errors, FS, Platform } from '@shared'
import ts from 'typescript'

type CaptureOptions = { app: string; output: string }
type Capture = (project: string, options: { appName: string; artifactRoot: string }) => Promise<unknown>

const excludedDirectories = new Set([
  '.git',
  '.tao',
  '.artifacts',
  '.expo',
  '.hutch',
  '.gradle',
  '.cache',
  '.claude',
  '.codex',
  '.cursor',
  '.agents',
  '.ssh',
  '.aws',
  '.devenv',
  '.direnv',
  '.next',
  '.turbo',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'ios',
  'android',
])

/** QaCapture runs review tooling only against an owned project snapshot, preserving its source. */
export class QaCapture {
  constructor(private readonly root: string, private readonly capture: Capture) {}

  async run(project: string, options: CaptureOptions): Promise<{
    result: unknown
    snapshot: string
    stagedProject: string
    status: string
  }> {
    const sourceRoot = await FS.realPath(FS.resolvePath(project, this.root))
    const repositoryRoot = await FS.realPath(this.root)
    if (
      !FS.pathIsWithin(sourceRoot, repositoryRoot)
      || FS.relativePath(repositoryRoot, sourceRoot).split('/').some(name =>
        ['.git', '.ssh', '.aws', 'node_modules'].includes(name) || this.secretName(name)
      )
    ) {
      Errors.throwUserInput(
        'QA capture source must be an app project inside this checkout, outside credential, Git, and vendor namespaces.',
      )
    }
    if (!await FS.isDirectory(sourceRoot) || sourceRoot === repositoryRoot) {
      Errors.throwUserInput('QA capture needs one app project directory, not the repository root.')
    }
    const scratchBase = FS.resolvePath('.artifacts/scratch/qa-capture', repositoryRoot)
    if (FS.pathIsWithin(scratchBase, sourceRoot)) {
      Errors.throwUserInput(
        'QA capture source contains its scratch directory. Choose the app project below a separate scratch directory.',
      )
    }
    const artifactRoot = FS.resolvePath(options.output, this.root)
    if (!FS.pathIsWithin(artifactRoot, FS.resolvePath('.artifacts', this.root))) {
      Errors.throwUserInput("QA capture output must be inside this checkout's .artifacts directory.")
    }
    if (FS.pathIsWithin(artifactRoot, sourceRoot)) {
      Errors.throwUserInput('QA capture output must be outside the original project.')
    }
    if (await FS.exists(artifactRoot)) {
      Errors.throwUserInput('QA capture output already exists; choose a new capture directory.')
    }
    await FS.mkdirWithinBoundary(FS.dirname(artifactRoot), this.root)
    const id = Platform.randomUUID()
    const scratch = FS.resolvePath(`.artifacts/scratch/qa-capture/${id}`, this.root)
    const stagedRoot = FS.resolvePath('project', scratch)
    await FS.mkdirWithinBoundary(stagedRoot, this.root)
    const receiptPath = FS.resolvePath('snapshot.json', scratch)
    const manifest = {
      version: 1,
      id,
      originalProject: sourceRoot,
      app: options.app,
      stagedProject: stagedRoot,
      output: artifactRoot,
      createdAt: new Date().toISOString(),
      owner: 'qa-capture',
      cleanup:
        'Retained for diagnosis. Remove this owned scratch directory only after its capture processes have stopped.',
      status: 'staging',
      files: [] as { path: string; sha256: string }[],
      excluded: [] as string[],
      cells: [] as {
        key: string
        group: string
        label: string
        status: string
        screenshot?: string
        sha256?: string
      }[],
      error: undefined as string | undefined,
    }
    await FS.writeJson(receiptPath, manifest)
    try {
      const sources = await this.sources(sourceRoot)
      manifest.excluded = sources.excluded
      // Tao resolves `@name` against package directories inside the project, so only those staged here pass.
      const packages = new Set(
        sources.files.flatMap(source =>
          FS.relativePath(sourceRoot, source).split('/').slice(0, -1).filter(name => name.startsWith('@'))
        ),
      )
      for (const source of sources.files) {
        const relative = FS.relativePath(sourceRoot, source)
        const content = await FS.readFile(source)
        if (/\.(?:tao|[cm]?[jt]sx?|jsonc?)$/iu.test(source)) {
          await this.checkReferences(new TextDecoder().decode(content), source, sourceRoot, packages)
        }
        manifest.files.push({ path: relative, sha256: Platform.sha256Hex(content) })
        await FS.writeFile(FS.resolvePath(relative, stagedRoot), content)
      }
      const after = await this.sources(sourceRoot)
      if (after.files.join('\n') !== sources.files.join('\n')) {
        Errors.throwUserInput('Project files changed while staging QA capture; retry.')
      }
      for (const file of manifest.files) {
        if (Platform.sha256Hex(await FS.readFile(FS.resolvePath(file.path, sourceRoot))) !== file.sha256) {
          Errors.throwUserInput('Project content changed while staging QA capture; retry.')
        }
      }
      // Studio resolves project ownership through a .tao marker. Create a fresh one in the snapshot;
      // never copy the original project's credentials, sessions, caches or identity.
      await FS.mkdir(FS.resolvePath('.tao', stagedRoot))
      manifest.status = 'capturing'
      await FS.writeJson(receiptPath, manifest)
      const result = await this.capture(stagedRoot, { appName: options.app, artifactRoot })
      manifest.cells = await this.cells(result)
      // Capture finishing is not capture succeeding: only a manifest whose every cell was captured completes.
      manifest.status = manifest.cells.length && manifest.cells.every(cell => cell.status === 'captured')
        ? 'complete'
        : 'partial'
      await FS.writeJson(receiptPath, manifest)
      await FS.writeJson(FS.resolvePath('source-snapshot.json', artifactRoot), manifest)
      return { result, snapshot: receiptPath, stagedProject: stagedRoot, status: manifest.status }
    } catch (error) {
      manifest.status = 'blocked'
      manifest.error = Errors.formatForUser(error)
      await FS.writeJson(receiptPath, manifest)
      if (await FS.isDirectory(artifactRoot)) {
        await FS.writeJson(FS.resolvePath('source-snapshot.json', artifactRoot), manifest)
      }
      Errors.throwHostEnvironment(
        `QA capture was blocked. The original project was not opened. Snapshot and diagnosis: ${receiptPath}`,
        { cause: error },
      )
    }
  }

  private async cells(
    result: unknown,
  ): Promise<{ key: string; group: string; label: string; status: string; screenshot?: string; sha256?: string }[]> {
    const manifestPath = (result as { manifestPath?: unknown } | undefined)?.manifestPath
    if (typeof manifestPath !== 'string' || !await FS.isFile(manifestPath)) {
      return []
    }
    const manifest = await FS.readJson<
      { cells?: { key: string; group: string; label: string; status: string; screenshot?: string; sha256?: string }[] }
    >(
      manifestPath,
    )
    return (manifest.cells ?? []).map(({ key, group, label, status, screenshot, sha256 }) => ({
      key,
      group,
      label,
      status,
      ...(screenshot ? { screenshot } : {}),
      ...(sha256 ? { sha256 } : {}),
    }))
  }

  private async sources(root: string): Promise<{ files: string[]; excluded: string[] }> {
    const files: string[] = []
    const excluded: string[] = []
    for await (
      const path of FS.walk(root, {
        includeHidden: true,
        excludeDirectory: name => excludedDirectories.has(name) || name.startsWith('_gen_') || this.secretName(name),
      })
    ) {
      const relative = FS.relativePath(root, path)
      if (
        relative.split('/').some(name =>
          excludedDirectories.has(name) || name.startsWith('_gen_') || this.secretName(name)
        )
        || /(?:^|\/)\.env(?:\.|$)/u.test(relative)
        || /(?:^|\/)(?:secrets?|credentials?)(?:\.[^/]*)?$/iu.test(relative)
        || /\.(?:pem|key|p12|pfx|keystore)$/iu.test(relative)
      ) {
        excluded.push(relative)
        continue
      }
      if (await FS.isSymbolicLink(path)) {
        Errors.throwUserInput(
          `QA capture cannot isolate a symbolic link: ${relative}. Copy its source into the project first.`,
        )
      }
      if (
        !/\.(?:tao|[cm]?[jt]sx?|jsonc?|css|svg|png|jpe?g|webp|gif|ico|ttf|otf|woff2?|mp3|mp4|wav|md|txt)$/iu.test(
          relative,
        )
        // A `.tao.ts` file is compiler output a type check leaves beside its source; the staged copy compiles its own.
        || relative.endsWith('.tao.ts')
      ) {
        excluded.push(relative)
        continue
      }
      if (!await FS.isFile(path) || !FS.pathIsWithin(await FS.realPath(path), root)) {
        Errors.throwUserInput(`QA capture source escapes the project: ${relative}.`)
      }
      files.push(path)
    }
    return { files: files.sort(), excluded: excluded.sort() }
  }

  private async checkReferences(text: string, path: string, root: string, packages: Set<string>): Promise<void> {
    const references: string[] = []
    const taoReferences = new Set<string>()
    const scripts: string[] = []
    if (path.endsWith('.tao')) {
      const { Parser } = await import('@parser')
      const lexed = Parser.lexCode(text)
      if (lexed.errors.length) {
        Errors.throwUserInput(
          `QA capture cannot inspect dependency paths in invalid Tao source: ${FS.relativePath(root, path)}.`,
        )
      }
      for (const [index, token] of lexed.tokens.entries()) {
        if (token.image === 'from') {
          const reference = lexed.tokens[index + 1]?.image
          if (reference) {
            references.push(reference)
            taoReferences.add(reference)
          }
        }
        if (token.image === 'use' && lexed.tokens[index + 1]?.image === 'package') {
          const reference = lexed.tokens[index + 2]?.image
          if (reference) {
            references.push(reference)
            taoReferences.add(reference)
          }
        }
        if (token.tokenType.name === 'TS_CODE_BLOCK') {
          scripts.push(token.image.slice(5, -3))
        }
      }
    } else if (/\.[cm]?[jt]sx?$/iu.test(path)) {
      scripts.push(text)
    }
    for (const script of scripts) {
      const source = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
          && ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
          references.push(node.moduleSpecifier.text)
        }
        if (
          ts.isCallExpression(node)
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          const argument = node.arguments[0]
          if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
            Errors.throwUserInput(
              `QA capture cannot isolate a computed import in ${
                FS.relativePath(root, path)
              }. Use a single literal import contained in the project.`,
            )
          }
          references.push(argument.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    if (/\.jsonc?$/iu.test(path)) {
      for (const match of text.matchAll(/"(\/[^"\n]*|[^"\n]*(?:\.\.\/|file:|\/Users\/|\/private\/)[^"\n]*)"/gu)) {
        references.push(match[1]!)
      }
    }
    for (const reference of references) {
      if (
        reference.includes('\\') || reference.startsWith('file:') || FS.isAbsolute(reference)
        // An alias such as `@tao/` or `@/` resolves inside the staged copy only while it never climbs out of it.
        || (!reference.startsWith('.') && reference.split('/').includes('..'))
        || (reference.startsWith('.') && !FS.pathIsWithin(FS.resolvePath(reference, FS.dirname(path)), root))
        || (!/\.jsonc?$/iu.test(path) && !reference.startsWith('.') && !reference.startsWith('@tao/')
          && !reference.startsWith('@/')
          && !(taoReferences.has(reference) && packages.has(reference.split('/')[0]!)))
      ) {
        Errors.throwUserInput(
          `QA capture cannot isolate ${
            FS.relativePath(root, path)
          } reference ${reference}. Move the referenced source inside the project before capturing.`,
        )
      }
    }
  }

  private secretName(name: string): boolean {
    return /^\.env(?:\.|$)/u.test(name) || /^(?:secrets?|credentials?)(?:\..*)?$/iu.test(name)
  }
}

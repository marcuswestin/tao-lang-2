import { Packages } from '@ast-utils'
import { type AST, Langium, Parser, type ParseResult } from '@parser'
import { Assert, type Diagnostic, Diagnostics, FS, ReleaseCapabilities, type ReleaseProfile } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { BridgeMetadata } from '../bridge-metadata'
import Compiler, { type CompileOptions, type CompileResult } from '../compiler'
import { createWorkspaceServices, type WorkspaceServices } from './langium-services'
import { createProjectContext, type ProjectContext } from './workspace-utils'

type CompileTestPlanOptions = {
  skipValidation?: boolean
}

/** Workspace coordinates project-rooted parsing, validation, and compilation. */
export class Workspace<ServicesT extends WorkspaceServices = WorkspaceServices> {
  private static readonly sharedWorkspaces = new Map<string, Promise<Workspace>>()

  protected constructor(
    protected readonly project: ProjectContext<ServicesT>,
    readonly releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
  ) {}

  /** open creates a Workspace rooted at `directoryPath`. */
  static async open(
    directoryPath: string,
    options: { sourceOverrides?: Readonly<Record<string, string>> } = {},
  ): Promise<Workspace> {
    return Workspace.openProfile(directoryPath, ReleaseCapabilities.current(), options)
  }

  /** openProfile applies one release profile to ordinary and source-override workspaces. */
  static async openProfile(
    directoryPath: string,
    releaseProfile: ReleaseProfile,
    options: { sourceOverrides?: Readonly<Record<string, string>> } = {},
  ): Promise<Workspace> {
    const root = FS.resolvePath(directoryPath)
    const sourceOverrides: Record<string, string> = {}
    for (const [path, source] of Object.entries(options.sourceOverrides ?? {})) {
      const resolved = FS.resolvePath(path, root)
      Assert.input(
        FS.extname(resolved) === '.tao' && FS.pathIsWithin(resolved, root),
        'Source overrides must name Tao files inside the workspace root.',
      )
      let ancestor = resolved
      while (!await FS.exists(ancestor) && !await FS.isSymbolicLink(ancestor)) {
        ancestor = FS.dirname(ancestor)
      }
      Assert.input(
        FS.pathIsWithin(await FS.realPath(ancestor), await FS.realPath(root)),
        'Source overrides must remain physically inside the workspace root.',
      )
      sourceOverrides[resolved] = source
    }
    const snapshot = Object.freeze(sourceOverrides)
    return new Workspace(
      await createProjectContext(
        root,
        context => createWorkspaceServices(context, snapshot),
        Object.keys(snapshot),
      ),
      releaseProfile,
    )
  }

  /** shared returns a process-shared Workspace rooted at `directoryPath`. */
  static async shared(
    directoryPath: string,
    releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
  ): Promise<Workspace> {
    const root = FS.resolvePath(directoryPath)
    const key = `${root}:${ReleaseCapabilities.fingerprint(releaseProfile)}`
    let workspace = Workspace.sharedWorkspaces.get(key)
    if (workspace === undefined) {
      workspace = Workspace.openProfile(root, releaseProfile).catch(error => {
        Workspace.sharedWorkspaces.delete(key)
        throw error
      })
      Workspace.sharedWorkspaces.set(key, workspace)
    }
    return await workspace
  }

  /** parse opens a Workspace around `entryFile` and parses it. */
  static async parse(entryFile: string): Promise<ParseResult> {
    const { entryPath, workspace } = await Workspace.openForEntry(entryFile)
    return await workspace.parse(entryPath)
  }

  /** validate opens a Workspace around `entryFile` and validates it. */
  static async validate(entryFile: string): Promise<ValidationResult> {
    const { entryPath, workspace } = await Workspace.openForEntry(entryFile)
    return await workspace.validate(entryPath)
  }

  /** compile opens a Workspace around `entryFile` and compiles it. */
  static async compile(entryFile: string, options: CompileOptions = {}): Promise<CompileResult> {
    const { entryPath, workspace } = await Workspace.openForEntry(entryFile)
    return await workspace.compile(entryPath, options)
  }

  /** compileTestPlan opens a Workspace around `entryFile` and compiles v0 Tao tests. */
  static async compileTestPlan(entryFile: string, options: CompileTestPlanOptions = {}): Promise<Compiler.TestPlan> {
    const { entryPath, workspace } = await Workspace.openForEntry(entryFile)
    return await workspace.compileTestPlan(entryPath, options)
  }

  private static async openForEntry(entryFile: string): Promise<{ entryPath: string; workspace: Workspace }> {
    const entryPath = FS.resolvePath(entryFile)
    const workspace = await Workspace.open(FS.dirname(entryPath))
    return { entryPath, workspace }
  }

  /** root returns the absolute workspace root path. */
  get root(): string {
    return this.project.root
  }

  /** parse parses an entry Tao file and all reachable Tao documents. */
  async parse(entryFile: string): Promise<ParseResult> {
    const entryPath = this.resolveEntryFile(entryFile)
    return await Parser.parse(this.parserContext(), Langium.URI.file(entryPath), { validation: false })
  }

  /** parseSource parses source given a workspace file URI. */
  async parseSource(source: string, uri: Langium.URI): Promise<ParseResult> {
    return await Parser.parseSource(this.parserContext(), source, {
      uri,
      validation: false,
    })
  }

  /** validate validates an entry Tao file and all reachable Tao documents. */
  async validate(entryFile: string): Promise<ValidationResult> {
    const parseResult = await this.parse(entryFile)
    return Validator.validateParseResult(parseResult, this.validatorContext(parseResult))
  }

  /**
   * parseFiles parses several entry files with one build. Each result holds the graph its entry alone
   * reaches, exactly as `parse` would give it, but a file several entries share is read, parsed, and
   * linked once rather than once per entry. The results describe the workspace as this call built
   * it: a later `parse`, `parseSource`, or `parseFiles` rebuilds the documents and leaves them stale.
   */
  async parseFiles(entryFiles: readonly string[]): Promise<readonly ParseResult[]> {
    const entryPaths = [...new Set(entryFiles.map(entryFile => this.resolveEntryFile(entryFile)))]
    Assert(entryPaths.length > 0, 'workspace parse has at least one entry file')
    return await Parser.parseEntries(
      this.parserContext(),
      entryPaths.map(entryPath => Langium.URI.file(entryPath)),
      { validation: false },
    )
  }

  /**
   * validateFiles validates every entry graph with its own entry-sensitive context, then unions
   * results. Project identity is the exception: it belongs to the project root rather than to what
   * one entry imports, so every graph is judged against the whole batch. A Studio-generated view
   * imports nothing of the project it was drawn in, and on its own graph looked like a file with no
   * project at all.
   */
  async validateFiles(entryFiles: readonly string[]): Promise<ValidationResult> {
    return await this.validateParsedFiles(await this.parseFiles(entryFiles))
  }

  /** validateParsedFiles validates what one `parseFiles` call returned; see `validateFiles`. */
  async validateParsedFiles(parsedEntries: readonly ParseResult[]): Promise<ValidationResult> {
    Assert(parsedEntries.length > 0, 'workspace validation has at least one entry file')
    const filesByPath = new Map<string, ParseResult['entry']>()
    for (const parsed of parsedEntries) {
      for (const file of parsed.files) {
        filesByPath.set(file.path, file)
      }
    }
    const batchFiles = [...filesByPath.values()]

    const diagnostics: Diagnostic[] = []
    for (const parsed of parsedEntries) {
      const validation = await Validator.validateParseResult(
        parsed,
        this.validatorContext(parsed, batchFiles.map(file => file.ast)),
      )
      diagnostics.push(...validation.diagnostics)
    }

    return {
      diagnostics: Diagnostics.unique(diagnostics),
      entry: parsedEntries[0]!.entry,
      files: batchFiles,
    }
  }

  /** compile compiles an entry Tao file and all reachable Tao documents. */
  async compile(entryFile: string, options: CompileOptions = {}): Promise<CompileResult> {
    const validationResult = await this.validate(entryFile)
    if (options.target !== 'watchos' && !Diagnostics.hasError(validationResult.diagnostics)) {
      await this.writeBridgeMetadata(validationResult.files)
    }
    return Compiler.compileValidated(validationResult, this.compilerContext(), options)
  }

  /** compileFiles compiles the union of several entry graphs while keeping the first as the app entry. */
  async compileFiles(entryFiles: readonly string[], options: CompileOptions = {}): Promise<CompileResult> {
    const validationResult = await this.validateFiles(entryFiles)
    if (options.target !== 'watchos' && !Diagnostics.hasError(validationResult.diagnostics)) {
      await this.writeBridgeMetadata(validationResult.files)
    }
    return Compiler.compileValidated(validationResult, this.compilerContext(), options)
  }

  /** compileTestPlan compiles v0 Tao tests for an entry file. */
  async compileTestPlan(entryFile: string, options: CompileTestPlanOptions = {}): Promise<Compiler.TestPlan> {
    const result = options.skipValidation ? await this.parse(entryFile) : await this.validate(entryFile)
    return Compiler.compileTestPlan(result, this.compilerContext())
  }

  private parserContext(): Parser.Context {
    return Parser.createContextFromServices(this.project.services.packages, this.project.services)
  }

  private validatorContext(parseResult: ParseResult, projectFiles?: readonly AST.TaoFile[]): Validator.Context {
    return Validator.createContext(
      this.project.packagesContext,
      parseResult.files.map(file => file.ast),
      parseResult.entry.path,
      projectFiles,
      this.releaseProfile,
    )
  }

  private compilerContext(): Compiler.Context {
    return Compiler.createContext(this.project.packagesContext, this.project.root, this.releaseProfile)
  }

  private async writeBridgeMetadata(files: readonly ParseResult['entry'][]): Promise<void> {
    if (Object.keys(this.project.services.sourceOverrides ?? {}).length > 0) {
      return
    }
    const projectRoot = await Packages.containingProjectRoot(this.project.root) ?? this.project.root
    await BridgeMetadata.write(files.filter(file => FS.pathIsWithin(file.path, projectRoot)))
  }

  private resolveEntryFile(entryFile: string): string {
    const entryPath = this.resolveInsideRoot(entryFile)
    Assert(FS.extname(entryPath) === '.tao', 'workspace entry file is a Tao file', { entryPath })
    return entryPath
  }

  private resolveInsideRoot(path: string): string {
    const resolvedPath = FS.resolvePath(path, this.project.root)
    Assert(FS.pathIsWithin(resolvedPath, this.project.root), 'workspace path is inside the workspace root', {
      path: resolvedPath,
      root: this.project.root,
    })
    return resolvedPath
  }
}

export default Workspace

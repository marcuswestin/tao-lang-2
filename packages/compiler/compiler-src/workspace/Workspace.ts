import { inspectMaintainedNativeBindings, type MaintainedBindingOptions } from '@native-bindings'
import { type AST, Langium, Parser, type ParseResult } from '@parser'
import {
  Assert,
  type Diagnostic,
  Diagnostics,
  FS,
  HCI,
  Platform,
  ReleaseCapabilities,
  type ReleaseProfile,
} from '@shared'
import Validator, { type ValidationResult } from '@validator'
import Compiler, { type CompileOptions, type CompileResult } from '../compiler'
import { createWorkspaceServices, type WorkspaceServices } from './langium-services'
import { createProjectContext, type ProjectContext, refreshProjectContext } from './workspace-utils'

type CompileTestPlanOptions = {
  skipValidation?: boolean
}

/** Workspace coordinates project-rooted parsing, validation, and compilation. */
export class Workspace<ServicesT extends WorkspaceServices = WorkspaceServices> {
  private static readonly sharedWorkspaces = new Map<string, Promise<Workspace>>()
  private readonly documentValidationReuse = Validator.createDocumentReuse()

  protected constructor(
    protected readonly project: ProjectContext<ServicesT>,
    readonly releaseProfile: ReleaseProfile = ReleaseCapabilities.current(),
    private readonly nativeBindings?: MaintainedBindingOptions,
  ) {}

  /** open creates a Workspace rooted at `directoryPath`. */
  static async open(
    directoryPath: string,
    options: { sourceOverrides?: Readonly<Record<string, string>>; nativeBindings?: MaintainedBindingOptions } = {},
  ): Promise<Workspace> {
    return Workspace.openProfile(directoryPath, ReleaseCapabilities.current(), options)
  }

  /** openProfile applies one release profile to ordinary and source-override workspaces. */
  static async openProfile(
    directoryPath: string,
    releaseProfile: ReleaseProfile,
    options: { sourceOverrides?: Readonly<Record<string, string>>; nativeBindings?: MaintainedBindingOptions } = {},
  ): Promise<Workspace> {
    const root = FS.resolvePath(directoryPath)
    const snapshot = await sourceOverrideSnapshot(root, options.sourceOverrides ?? {})
    return new Workspace(
      await createProjectContext(
        root,
        context => createWorkspaceServices(context, snapshot),
        Object.keys(snapshot),
        options.nativeBindings?.stdlibRoot,
      ),
      releaseProfile,
      options.nativeBindings,
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

  /** Replace the source snapshot for the next serialized workspace invocation. */
  async setSourceOverrides(sourceOverrides: Readonly<Record<string, string>>): Promise<void> {
    this.project.services.sourceOverrides = await sourceOverrideSnapshot(this.project.root, sourceOverrides)
  }

  /** parse parses an entry Tao file and all reachable Tao documents. */
  async parse(entryFile: string): Promise<ParseResult> {
    return await this.withValidationReuse(async () => {
      const relink = await this.refreshProject()
      const entryPath = this.resolveEntryFile(entryFile)
      const parsed = await Parser.parse(this.parserContext(), Langium.URI.file(entryPath), {
        validation: false,
        relink,
      })
      this.clearFailedBuild([parsed])
      return parsed
    })
  }

  /** parseSource parses source given a workspace file URI. */
  async parseSource(source: string, uri: Langium.URI): Promise<ParseResult> {
    return await this.withValidationReuse(async () => {
      const relink = await this.refreshProject()
      const parsed = await Parser.parseSource(this.parserContext(), source, {
        uri,
        validation: false,
        relink,
      })
      this.clearFailedBuild([parsed])
      return parsed
    })
  }

  /** validate validates an entry Tao file and all reachable Tao documents. */
  async validate(entryFile: string): Promise<ValidationResult> {
    const nativeBindings = await inspectMaintainedNativeBindings(this.nativeBindings)
    const parseResult = await this.parse(entryFile)
    const validation = (await Validator.validateParseResults([
      { parseResult, context: this.validatorContext(parseResult) },
    ], this.documentValidationReuse))[0]!
    return {
      ...validation,
      diagnostics: Diagnostics.unique([...nativeBindings.diagnostics, ...validation.diagnostics]),
    }
  }

  /**
   * parseFiles parses several entry files with one build. Each result holds the graph its entry alone
   * reaches, exactly as `parse` would give it, but a file several entries share is read, parsed, and
   * linked once rather than once per entry. The results describe the workspace as this call built
   * it: a later `parse`, `parseSource`, or `parseFiles` rebuilds the documents and leaves them stale.
   */
  async parseFiles(entryFiles: readonly string[]): Promise<readonly ParseResult[]> {
    return await this.withValidationReuse(() => this.parseEntryFiles(entryFiles))
  }

  private async parseEntryFiles(entryFiles: readonly string[]): Promise<readonly ParseResult[]> {
    const profile = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
    const startedAt = profile ? performance.now() : 0
    const relink = await this.refreshProject()
    const contextDoneAt = profile ? performance.now() : 0
    const entryPaths = [...new Set(entryFiles.map(entryFile => this.resolveEntryFile(entryFile)))]
    Assert(entryPaths.length > 0, 'workspace parse has at least one entry file')
    const parsed = await Parser.parseEntries(
      this.parserContext(),
      entryPaths.map(entryPath => Langium.URI.file(entryPath)),
      { validation: false, relink },
    )
    this.clearFailedBuild(parsed)
    if (profile) {
      HCI.logProcessInfo(
        'workspace',
        JSON.stringify({
          type: 'studio-workspace-profile',
          operation: 'parse',
          root: this.root,
          entries: entryPaths.length,
          contextMs: contextDoneAt - startedAt,
          parseMs: performance.now() - contextDoneAt,
          relink,
        }),
      )
    }
    return parsed
  }

  /**
   * validateFiles validates every entry graph with its own entry-sensitive context, then unions
   * results. Project identity is the exception: it belongs to the project root rather than to what
   * one entry imports, so every graph is judged against the whole batch. A Studio-generated view
   * imports nothing of the project it was drawn in, and on its own graph looked like a file with no
   * project at all.
   */
  async validateFiles(entryFiles: readonly string[]): Promise<ValidationResult> {
    const parsed = await this.parseFiles(entryFiles)
    const profile = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
    const startedAt = profile ? performance.now() : 0
    const validated = await this.validateParsedFiles(parsed)
    if (profile) {
      HCI.logProcessInfo(
        'workspace',
        JSON.stringify({
          type: 'studio-workspace-profile',
          operation: 'validate',
          root: this.root,
          entries: parsed.length,
          files: validated.files.length,
          validateMs: performance.now() - startedAt,
        }),
      )
    }
    return validated
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

    const nativeBindings = await inspectMaintainedNativeBindings(this.nativeBindings)
    const projectFiles = batchFiles.map(file => file.ast)
    const validations = await Validator.validateParseResults(
      parsedEntries.map(parsed => ({
        parseResult: parsed,
        context: this.validatorContext(parsed, projectFiles),
      })),
      this.documentValidationReuse,
    )
    const diagnostics: Diagnostic[] = [...nativeBindings.diagnostics]
    for (const validation of validations) {
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
    return this.withValidationReuse(() => Compiler.compileValidated(validationResult, this.compilerContext(), options))
  }

  /** compileFiles compiles the union of several entry graphs while keeping the first as the app entry. */
  async compileFiles(entryFiles: readonly string[], options: CompileOptions = {}): Promise<CompileResult> {
    const validationResult = await this.validateFiles(entryFiles)
    const profile = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
    const startedAt = profile ? performance.now() : 0
    const compiled = await this.withValidationReuse(() =>
      Compiler.compileValidated(validationResult, this.compilerContext(), options)
    )
    if (profile) {
      HCI.logProcessInfo(
        'workspace',
        JSON.stringify({
          type: 'studio-workspace-profile',
          operation: 'emit',
          root: this.root,
          entries: entryFiles.length,
          emitMs: performance.now() - startedAt,
        }),
      )
    }
    return compiled
  }

  /** compileTestPlan compiles v0 Tao tests for an entry file. */
  async compileTestPlan(entryFile: string, options: CompileTestPlanOptions = {}): Promise<Compiler.TestPlan> {
    const result = options.skipValidation ? await this.parse(entryFile) : await this.validate(entryFile)
    const nativeBindings = await inspectMaintainedNativeBindings(this.nativeBindings)
    Assert.input(
      !Diagnostics.hasError(nativeBindings.diagnostics),
      Diagnostics.errorMessages(nativeBindings.diagnostics).join('; '),
    )
    return this.withValidationReuse(() => Compiler.compileTestPlan(result, this.compilerContext()))
  }

  private async refreshProject(): Promise<boolean> {
    const relink = await refreshProjectContext(this.project)
    if (relink) {
      this.documentValidationReuse.clear()
    }
    return relink
  }

  private clearFailedBuild(parsed: readonly ParseResult[]): void {
    if (parsed.some(result => Diagnostics.hasError(result.diagnostics, 'lexer', 'parser', 'linker'))) {
      this.documentValidationReuse.clear()
    }
  }

  private async withValidationReuse<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      this.documentValidationReuse.clear()
      throw error
    }
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
    return Compiler.createContext(
      this.project.packagesContext,
      this.project.root,
      this.releaseProfile,
      this.nativeBindings,
    )
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

async function sourceOverrideSnapshot(root: string, overrides: Readonly<Record<string, string>>) {
  const snapshot: Record<string, string> = {}
  for (const [path, source] of Object.entries(overrides)) {
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
    snapshot[resolved] = source
  }
  return Object.freeze(snapshot)
}

export default Workspace

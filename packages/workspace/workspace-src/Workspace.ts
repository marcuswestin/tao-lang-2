import Compiler, { type CompileOptions, type CompileResult } from '@compiler'
import { Langium, Parser, type ParseResult } from '@parser'
import { Assert, type Diagnostic, Diagnostics, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { createWorkspaceServices, type WorkspaceServices } from './langium-services'
import { createProjectContext, type ProjectContext } from './workspace-utils'

type CompileTestPlanOptions = {
  skipValidation?: boolean
}

/** Workspace coordinates project-rooted parsing, validation, and compilation. */
export class Workspace<ServicesT extends WorkspaceServices = WorkspaceServices> {
  private static readonly sharedWorkspaces = new Map<string, Promise<Workspace>>()

  protected constructor(protected readonly project: ProjectContext<ServicesT>) {}

  /** open creates a Workspace rooted at `directoryPath`. */
  static async open(directoryPath: string): Promise<Workspace> {
    return new Workspace(await createProjectContext(directoryPath, createWorkspaceServices))
  }

  /** shared returns a process-shared Workspace rooted at `directoryPath`. */
  static async shared(directoryPath: string): Promise<Workspace> {
    const root = FS.resolvePath(directoryPath)
    let workspace = Workspace.sharedWorkspaces.get(root)
    if (workspace === undefined) {
      workspace = Workspace.open(root).catch(error => {
        Workspace.sharedWorkspaces.delete(root)
        throw error
      })
      Workspace.sharedWorkspaces.set(root, workspace)
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

  /** validateFiles validates every entry graph with its own entry-sensitive context, then unions results. */
  async validateFiles(entryFiles: readonly string[]): Promise<ValidationResult> {
    const entryPaths = [...new Set(entryFiles.map(entryFile => this.resolveEntryFile(entryFile)))]
    Assert(entryPaths.length > 0, 'workspace validation has at least one entry file')

    const filesByPath = new Map<string, ParseResult['entry']>()
    const diagnostics: Diagnostic[] = []
    for (const entryPath of entryPaths) {
      const parsed = await this.parse(entryPath)
      for (const file of parsed.files) {
        filesByPath.set(file.path, file)
      }
      const validation = await Validator.validateParseResult(parsed, this.validatorContext(parsed))
      diagnostics.push(...validation.diagnostics)
    }

    const entry = filesByPath.get(entryPaths[0]!)
    Assert.defined(entry, 'workspace batch entry exists in parsed files', { entryPath: entryPaths[0] })
    return {
      diagnostics: Diagnostics.unique(diagnostics),
      entry,
      files: [...filesByPath.values()],
    }
  }

  /** compile compiles an entry Tao file and all reachable Tao documents. */
  async compile(entryFile: string, options: CompileOptions = {}): Promise<CompileResult> {
    const validationResult = await this.validate(entryFile)
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

  private validatorContext(parseResult: ParseResult): Validator.Context {
    return Validator.createContext(
      this.project.packagesContext,
      parseResult.files.map(file => file.ast),
      parseResult.entry.path,
    )
  }

  private compilerContext(): Compiler.Context {
    return Compiler.createContext(this.project.packagesContext, this.project.root)
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

import Compiler, { type CompileResult } from '@compiler'
import { Langium, Parser, type ParseResult } from '@parser'
import { Assert, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { createWorkspaceServices, type WorkspaceServices } from './langium-services'
import { createProjectContext, pathIsWithin, type ProjectContext } from './workspace-utils'

/** Workspace coordinates project-rooted parsing, validation, and compilation. */
export class Workspace<ServicesT extends WorkspaceServices = WorkspaceServices> {
  protected constructor(protected readonly project: ProjectContext<ServicesT>) {}

  /** open creates a Workspace rooted at `directoryPath`. */
  static async open(directoryPath: string): Promise<Workspace> {
    return new Workspace(await createProjectContext(directoryPath, createWorkspaceServices))
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
  static async compile(entryFile: string): Promise<CompileResult> {
    const { entryPath, workspace } = await Workspace.openForEntry(entryFile)
    return await workspace.compile(entryPath)
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

  /** typir returns the Typir services owned by this Workspace. */
  get typir(): WorkspaceServices['typir'] {
    return this.project.services.typir
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

  /** compile compiles an entry Tao file and all reachable Tao documents. */
  async compile(entryFile: string): Promise<CompileResult> {
    const validationResult = await this.validate(entryFile)
    return Compiler.compileValidated(validationResult, this.compilerContext())
  }

  private parserContext(): Parser.Context {
    return Parser.createContextFromServices(this.project.services.packages, this.project.services)
  }

  private validatorContext(parseResult: ParseResult): Validator.Context {
    return Validator.createContext(
      this.project.packagesContext,
      this.project.services.typir,
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
    const resolvedPath = FS.resolvePath(path, { cwd: this.project.root })
    Assert(pathIsWithin(resolvedPath, this.project.root), 'workspace path is inside the workspace root', {
      path: resolvedPath,
      root: this.project.root,
    })
    return resolvedPath
  }
}

export default Workspace

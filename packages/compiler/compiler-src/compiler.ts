import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { defaultStdLibRoot, resolveModulePath } from '@parser/module-resolution'
import { Assert, FS } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { errorMessages } from '@validator/diagnostics'
import RuntimeGen from './codegen/app/runtime-gen'

type CompiledFile = {
  sourcePath: string
  relativePath: string
  code: string
}

type CompileResult = {
  code: string
  files: CompiledFile[]
}

/** Compiler exposes Tao source compilation functions. */
export default {
  /** compileFile compiles the Tao file at `path` into Expo-compatible TSX source. */
  async compileFile(path: string): Promise<CompileResult> {
    return compileValidated(await Validator.validateFile(path))
  },

  /** compileCode compiles Tao source code into Expo-compatible TSX source. */
  async compileCode(code: string): Promise<CompileResult> {
    return compileValidated(await Validator.validateCode(code))
  },
} as const

function compileValidated(result: ValidationResult): CompileResult {
  const errors = errorMessages(result.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao source with validation errors: ${errors.join('; ')}`, { errors })
  const entryApps = result.parsed.ast.statements.filter(AST.isAppDeclaration)
  Assert(
    entryApps.length === 1,
    `Cannot compile app entry: entry file must declare exactly one app, found ${entryApps.length}.`,
    { entryApps: entryApps.length },
  )
  if (result.parsed.entryFilePath) {
    return compileWorkspace(result)
  }
  const code = RuntimeGen.TaoFile(result.parsed.ast)
  return {
    code,
    files: [{
      sourcePath: result.parsed.document.uri.path,
      relativePath: 'App.tsx',
      code,
    }],
  }
}

function compileWorkspace(result: ValidationResult): CompileResult {
  const entryPath = result.parsed.entryFilePath!
  const workspaceFiles = result.parsed.workspaceFiles ?? [result.parsed.ast]
  const sourceFiles: Array<{ ast: AST.TaoFile; path: string }> = workspaceFiles.map((file: AST.TaoFile) => ({
    ast: file,
    path: ASTUtils.getDocument(file).uri.path,
  }))
  const sourceByPath = new Map(sourceFiles.map(file => [file.path, file]))
  const repoRoot = FS.repoPath('.')
  const stdLibRoot = defaultStdLibRoot()

  // Basename buckets in moduleOutputPath can collide across distinct sources;
  // suffix deterministically instead of silently overwriting generated files.
  const outputPathBySourcePath = new Map<string, string>()
  const usedOutputPaths = new Set<string>()
  for (const file of sourceFiles) {
    const preferredPath = file.path === entryPath ? 'App.tsx' : moduleOutputPath(file.path, entryPath, repoRoot)
    let outputPath = preferredPath
    for (let suffix = 2; usedOutputPaths.has(outputPath); suffix++) {
      outputPath = preferredPath.replace(/\.tsx$/, `-${suffix}.tsx`)
    }
    usedOutputPaths.add(outputPath)
    outputPathBySourcePath.set(file.path, outputPath)
  }

  const compiledFiles = sourceFiles.map((file): CompiledFile => {
    const imports = resolveImports(file.path, file.ast, sourceByPath, stdLibRoot)
    const currentOutputPath = outputPathBySourcePath.get(file.path)!
    const importLines = [...imports.bySource.entries()].map(([sourcePath, names]) => {
      const sourceOutputPath = outputPathBySourcePath.get(sourcePath)
      Assert.defined(sourceOutputPath, 'compiled source output path exists', { sourcePath })
      return `import { ${[...names].sort().join(', ')} } from '${
        relativeImportPath(currentOutputPath, sourceOutputPath)
      }'`
    })
    const scopeBindings = [...imports.importedNames].map(name => `TR.Use(_Scope, '${name}', () => ${name})`)
    const exportedNames = file.ast.statements
      .filter((statement: AST.Statement): statement is AST.Declaration => AST.isDeclaration(statement))
      .filter((statement: AST.Declaration) => declarationVisibility(statement) !== 'hide')
      .map((statement: AST.Declaration) => statement.name)

    return {
      sourcePath: file.path,
      relativePath: currentOutputPath,
      code: RuntimeGen.TaoFile(file.ast, {
        importLines,
        scopeBindings,
        exportedNames: [...new Set(exportedNames)] as string[],
      }),
    }
  })

  const entryCode = compiledFiles.find((compiledFile: CompiledFile) => compiledFile.sourcePath === entryPath)?.code
  Assert.defined(entryCode, 'entry compiled code exists', { entryPath })
  return {
    code: entryCode,
    files: compiledFiles,
  }
}

// Module output paths must stay inside the generated app root, so out-of-root
// sources fall back to entry-relative and basename buckets instead of `..` segments.
function moduleOutputPath(filePath: string, entryPath: string, repoRoot: string): string {
  const repoRelative = FS.relativePath(repoRoot, filePath)
  if (!repoRelative.startsWith('..')) {
    return `modules/${repoRelative}.tsx`
  }
  const entryRelative = FS.relativePath(FS.dirname(entryPath), filePath)
  if (!entryRelative.startsWith('..')) {
    return `modules/app/${entryRelative}.tsx`
  }
  return `modules/external/${FS.basename(filePath)}.tsx`
}

function resolveImports(
  filePath: string,
  file: AST.TaoFile,
  sourceByPath: Map<string, { ast: AST.TaoFile; path: string }>,
  stdLibRoot?: string,
): {
  bySource: Map<string, Set<string>>
  importedNames: Set<string>
} {
  const bySource = new Map<string, Set<string>>()
  const importedNames = new Set<string>()
  for (const useStatement of file.statements.filter(AST.isUseStatement)) {
    const resolution = resolveModulePath(useStatement.modulePath, filePath, stdLibRoot)
    if (!resolution) {
      continue
    }
    const targets = [...sourceByPath.values()].filter(candidate =>
      candidate.path === `${resolution.targetPath}.tao` || FS.dirname(candidate.path) === resolution.targetPath
    )
    for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
      const target = targets.find(candidate =>
        candidate.ast.statements.some(statement =>
          AST.isDeclaration(statement)
          && statement.name === importedName
          && (!resolution.sameModule
            ? declarationVisibility(statement) === 'share'
            : declarationVisibility(statement) !== 'hide')
        )
      )
      if (!target) {
        continue
      }
      importedNames.add(importedName)
      const names = bySource.get(target.path) ?? new Set<string>()
      names.add(importedName)
      bySource.set(target.path, names)
    }
  }
  return { bySource, importedNames }
}

function relativeImportPath(fromOutputPath: string, toOutputPath: string): string {
  const fromDir = FS.dirname(fromOutputPath)
  const relative = FS.relativePath(fromDir, toOutputPath)
  const withoutExtension = relative.replace(/\.tsx$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

function declarationVisibility(declaration: AST.Declaration): AST.DeclarationVisibility | undefined {
  return 'visibility' in declaration ? declaration.visibility : undefined
}

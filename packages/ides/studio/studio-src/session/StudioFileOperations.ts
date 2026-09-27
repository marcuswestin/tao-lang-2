import type { Workspace } from '@compiler/workspace'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, Errors, FS } from '@shared'
import SourceActions from '@source-actions'
import type { StudioCompileCoordinator } from '../StudioCompileCoordinator'
import { studioGeneratedSourceHeader, StudioGeneratedSources } from '../StudioGeneratedSources'
import type {
  StudioCreateFileRequest,
  StudioCreateFileResult,
  StudioDeleteFileRequest,
  StudioDeleteFileResult,
  StudioDraftWriteRequest,
  StudioDraftWriteResult,
  StudioMoveGeneratedSourceRequest,
  StudioMoveGeneratedSourceResult,
  StudioProjectFile,
  StudioProjectFileContent,
  StudioRenameFileRequest,
  StudioRenameFileResult,
} from '../StudioProtocol'
import { StudioScenarioRelocation } from '../StudioScenarioRelocation'
import type { StudioSketchCatalog, StudioSketchCatalogSnapshot } from '../StudioSketchCatalog'
import type { StudioProjectFiles } from './StudioProjectFiles'
import { requireSourceVersion } from './StudioSourceConflicts'

export type StudioFileOperationsContext = {
  coordinator: StudioCompileCoordinator
  /** Absolute path of the active app entry, which cannot be renamed or deleted. */
  entryPath: string
  files: StudioProjectFiles
  onFileChanged: (file: StudioProjectFile) => void
  onFilesChanged: (files: readonly StudioProjectFile[]) => void
  onSketchCatalogChanged: (catalog: StudioSketchCatalogSnapshot) => void
  projectRoot: string
  sketchCatalog: StudioSketchCatalog
  workspace: Workspace
}

/**
 * StudioFileOperations performs the session's file-level mutations — create, rename, delete, draft
 * sync, and moving a generated source into an authored package — keeping disk, the file listing, and
 * the compile coordinator in step and rolling back when a compile rejects the result. The session
 * serializes calls on its mutation lane; nothing here takes the lane itself.
 */
export class StudioFileOperations {
  readonly #context: StudioFileOperationsContext

  constructor(context: StudioFileOperationsContext) {
    this.#context = context
  }

  async createFile(request: StudioCreateFileRequest): Promise<StudioCreateFileResult> {
    const { coordinator, files, projectRoot } = this.#context
    const path = await files.resolveNewTaoFile(request.path)
    const content = ''
    const sourceVersion = SourceActions.studioSourceVersion(content)
    await FS.writeText(path, content)
    files.note(path, sourceVersion)
    const compile = await coordinator.noteStudioFileMutation([{ path, sourceVersion, writeId: request.writeId }])
    const file: StudioProjectFileContent = {
      content,
      ...files.projectFile(FS.relativePath(projectRoot, path), sourceVersion),
    }
    this.#context.onFileChanged(file)
    const listed = files.list()
    this.#context.onFilesChanged(listed)
    return { compile, file, files: listed }
  }

  async renameFile(request: StudioRenameFileRequest): Promise<StudioRenameFileResult> {
    const { coordinator, entryPath, files, projectRoot } = this.#context
    const current = await files.readFile(request.path)
    requireSourceVersion(current, request.sourceVersion)
    files.requireMutationAllowed(current.path)
    const path = await files.resolveTaoFile(current.path)
    Assert.input(await FS.realPath(path) !== entryPath, 'Studio cannot rename the active app entry file.')
    const targetPath = await files.resolveNewTaoFile(request.targetPath)
    await FS.move(path, targetPath)
    files.forget(path)
    files.note(targetPath, current.sourceVersion)
    const compile = await coordinator.noteStudioFileMutation([
      { path, writeId: request.writeId },
      { path: targetPath, sourceVersion: current.sourceVersion, writeId: request.writeId },
    ])
    const file: StudioProjectFileContent = {
      content: current.content,
      ...files.projectFile(FS.relativePath(projectRoot, targetPath), current.sourceVersion),
    }
    const listed = files.list()
    this.#context.onFilesChanged(listed)
    // The file has already moved, so a catalog refusal must not report the rename as failed; a render
    // left pointing at the old path is then marked broken, and its card offers Remove from canvas.
    await this.#followRenamedSketchSource(current.path, file.path, request.writeId).catch(() => undefined)
    return { compile, file, files: listed, previousPath: current.path }
  }

  /** A render or detached definition on the canvas names the file it lives in; a rename carries that along. */
  async #followRenamedSketchSource(previousPath: string, path: string, writeId: string): Promise<void> {
    const moved = await this.#context.sketchCatalog.transaction(async transaction => {
      const before = await transaction.read()
      let catalog = before
      for (const sketch of before.sketches) {
        const source = sketch.render?.path === previousPath
          ? { render: { ...sketch.render, path } }
          : sketch.definitionPath === previousPath
          ? { definitionPath: path }
          : undefined
        if (source !== undefined) {
          catalog = (await transaction.apply({
            action: { kind: 'set-sketch-source', sketchId: sketch.id, ...source },
            expectedRevision: catalog.revision,
            requestId: `catalog:${writeId}:${sketch.id}`,
          })).catalog
        }
      }
      return catalog === before ? undefined : catalog
    })
    if (moved !== undefined) {
      this.#context.onSketchCatalogChanged(moved)
    }
  }

  async deleteFile(request: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> {
    const { coordinator, entryPath, files } = this.#context
    const current = await files.readFile(request.path)
    requireSourceVersion(current, request.sourceVersion)
    files.requireMutationAllowed(current.path)
    const path = await files.resolveTaoFile(current.path)
    Assert.input(await FS.realPath(path) !== entryPath, 'Studio cannot delete the active app entry file.')
    await FS.remove(path)
    files.forget(path)
    const compile = await coordinator.noteStudioFileMutation([{ path, writeId: request.writeId }])
    const deleted = files.projectFile(current.path, current.sourceVersion)
    const listed = files.list()
    this.#context.onFilesChanged(listed)
    return { compile, deleted, files: listed }
  }

  async syncDraft(request: StudioDraftWriteRequest): Promise<StudioDraftWriteResult> {
    const { coordinator, files, workspace } = this.#context
    const current = await files.readFile(request.path)
    requireSourceVersion(current, request.sourceVersion)
    const resolved = await files.resolveTaoFile(request.path)
    const parsed = await workspace.parseSource(request.content, Langium.URI.file(resolved))
    const diagnostics = Diagnostics.errorMessages(parsed.diagnostics, 'lexer', 'parser')
    if (diagnostics.length > 0) {
      files.setDraft(current.path, diagnostics)
      const file = { ...current, ...files.projectFile(current.path, current.sourceVersion) }
      this.#context.onFileChanged(file)
      return { diagnostics, file, saved: false }
    }

    const sourceVersion = SourceActions.studioSourceVersion(request.content)
    await FS.writeText(resolved, request.content)
    files.note(resolved, sourceVersion)
    const compile = await coordinator.noteStudioWrite({ path: resolved, sourceVersion, writeId: request.writeId })
    files.clearDraft(current.path)
    const file: StudioProjectFileContent = {
      content: request.content,
      ...files.projectFile(current.path, sourceVersion),
    }
    this.#context.onFileChanged(file)
    return { compile, diagnostics: [], file, saved: true }
  }

  async moveGeneratedSource(request: StudioMoveGeneratedSourceRequest): Promise<StudioMoveGeneratedSourceResult> {
    const { coordinator, files, projectRoot, sketchCatalog } = this.#context
    const current = await files.readFile(request.path)
    requireSourceVersion(current, request.sourceVersion)
    const match = current.path.match(/^@\/studio\/([A-Z][A-Za-z0-9_]*)\.tao$/)
    Assert.input(match, 'Move to package requires a generated @/studio/<Name>.tao source.')
    Assert.input(
      current.content.startsWith(`${studioGeneratedSourceHeader}\n`),
      `${current.path} is not a Studio-generated source.`,
    )
    const name = match[1]!
    const targetPackage = normalizedTargetPackage(request.targetPackage)
    const conflicts = await this.#targetPackageDeclarationConflicts(targetPackage, name)
    if (conflicts.length > 0) {
      return { conflicts, name, status: 'confirmation-required', targetPackage }
    }

    return await sketchCatalog.transaction(async transaction => {
      const sourcePath = FS.resolvePath(current.path, projectRoot)
      const beforeCatalog = await transaction.read()
      const catalogSketches = beforeCatalog.sketches.filter(sketch => sketch.view === name)
      Assert.input(catalogSketches.length <= 1, `Move to package found multiple sketches for generated view ${name}.`)
      const catalogSketch = catalogSketches[0]

      const rewrites: Array<{ content: string; current: StudioProjectFileContent; path: string }> = []
      for (const file of files.list()) {
        const fileContent = file.path === current.path ? current : await files.readFile(file.path)
        const rewritten = await this.#rewriteGeneratedImport(fileContent, name, targetPackage)
        if (rewritten !== undefined) {
          rewrites.push({
            content: rewritten,
            current: fileContent,
            path: FS.resolvePath(file.path, projectRoot),
          })
        }
      }
      let otherRewrites = rewrites.filter(candidate => candidate.current.path !== current.path)
      let movedContent = rewrites.find(rewrite => rewrite.current.path === current.path)?.content ?? current.content
      const scenariosRelativePath = FS.relativePath(
        projectRoot,
        FS.resolvePath('Scenarios.tao', FS.dirname(this.#context.entryPath)),
      )
      const scenariosPath = FS.resolvePath(scenariosRelativePath, projectRoot)
      const movedParsed = await this.#context.workspace.parseSource(movedContent, Langium.URI.file(sourcePath))
      const relocate = request.relocateScenarios !== false && movedParsed.entry.ast.statements
        .some(statement => AST.isScenarioGroupDeclaration(statement) && statement.subject?.$refText === name)
      const existingScenarios = relocate && await FS.exists(scenariosPath)
        ? await files.readFile(scenariosRelativePath)
        : undefined
      if (relocate && existingScenarios === undefined) {
        await files.resolveNewTaoFile(scenariosRelativePath)
      }
      const scenariosBefore = relocate
        ? otherRewrites.find(rewrite => rewrite.path === scenariosPath)?.content ?? existingScenarios?.content ?? ''
        : ''
      const scenariosParsed = await this.#context.workspace.parseSource(
        scenariosBefore,
        Langium.URI.file(scenariosPath),
      )
      Assert.input(
        !Diagnostics.hasError(scenariosParsed.diagnostics, 'lexer', 'parser'),
        `Cannot relocate scenarios until ${scenariosRelativePath} parses.`,
      )
      const relocation = StudioScenarioRelocation.prepare({
        document: movedParsed.entry.document,
        name,
        projectRoot,
        relocateScenarios: relocate,
        scenariosDocument: scenariosParsed.entry.document,
        targetPackage,
        targetPath: FS.resolvePath(`${targetPackage}/${name}.tao`, projectRoot),
      })
      movedContent = relocation.movedSource
      if (relocation.scenariosSource !== undefined) {
        otherRewrites = otherRewrites.filter(rewrite => rewrite.path !== scenariosPath)
      }
      const generated = new StudioGeneratedSources(projectRoot)
      let targetPath: string | undefined
      let retiredCatalog: StudioSketchCatalogSnapshot | undefined
      let scenariosWritten = false
      let movedPostimage: string | undefined
      const completedRewrites = new Set<string>()
      try {
        targetPath = await generated.moveView(name, targetPackage, movedContent, async (path, content) => {
          await FS.writeText(path, content)
          movedPostimage = content
        })
        const rewritten: StudioProjectFileContent[] = []
        for (const rewrite of otherRewrites) {
          Assert.input(
            await FS.readText(rewrite.path) === rewrite.current.content,
            `${rewrite.current.path} changed during the move; its current contents were preserved.`,
          )
          if (rewrite.current.path.startsWith('@/studio/')) {
            await generated.rewrite(rewrite.path, rewrite.content)
          } else {
            await FS.writeText(rewrite.path, rewrite.content)
          }
          completedRewrites.add(rewrite.path)
          const sourceVersion = SourceActions.studioSourceVersion(rewrite.content)
          files.note(rewrite.path, sourceVersion)
          rewritten.push({
            content: rewrite.content,
            ...files.projectFile(rewrite.current.path, sourceVersion),
          })
        }
        if (relocation.scenariosSource !== undefined) {
          const content = await FS.exists(scenariosPath) ? await FS.readText(scenariosPath) : undefined
          Assert.input(
            content === existingScenarios?.content,
            `${scenariosRelativePath} changed during the move; its current contents were preserved.`,
          )
          await FS.writeText(scenariosPath, relocation.scenariosSource)
          scenariosWritten = true
          const sourceVersion = SourceActions.studioSourceVersion(relocation.scenariosSource)
          files.note(scenariosPath, sourceVersion)
          rewritten.push({
            content: relocation.scenariosSource,
            ...files.projectFile(scenariosRelativePath, sourceVersion),
          })
        }
        const targetContent = await FS.readText(targetPath)
        const targetSourceVersion = SourceActions.studioSourceVersion(targetContent)
        files.forget(sourcePath)
        files.note(targetPath, targetSourceVersion)
        const file: StudioProjectFileContent = {
          content: targetContent,
          ...files.projectFile(FS.relativePath(projectRoot, targetPath), targetSourceVersion),
        }
        const compile = await coordinator.noteStudioFileMutation([
          { path: sourcePath, writeId: request.writeId },
          { path: targetPath, sourceVersion: targetSourceVersion, writeId: request.writeId },
          ...rewritten.map(candidate => ({
            path: FS.resolvePath(candidate.path, projectRoot),
            sourceVersion: candidate.sourceVersion,
            writeId: request.writeId,
          })),
        ])
        if (compile.status === 'error') {
          Errors.throwUserInput(
            `Studio did not move ${name} because the authored Tao source failed to compile: ${compile.message}`,
          )
        }
        const listed = files.list()
        if (catalogSketch !== undefined) {
          retiredCatalog = (await transaction.apply({
            action: { id: catalogSketch.id, kind: 'delete-sketch' },
            expectedRevision: beforeCatalog.revision,
            requestId: `catalog:${request.writeId}`,
          })).catalog
        }
        for (const changed of rewritten) {
          this.#context.onFileChanged(changed)
        }
        this.#context.onFilesChanged(listed)
        if (retiredCatalog !== undefined) {
          this.#context.onSketchCatalogChanged(retiredCatalog)
        }
        return { compile, file, files: listed, previousPath: current.path, rewritten, status: 'moved' }
      } catch (error) {
        if (targetPath !== undefined) {
          const rollbackFailures: unknown[] = []
          const rollbackConflicts: string[] = []
          let scenariosVersion = existingScenarios?.sourceVersion
          try {
            const targetContent = await FS.isFile(targetPath) ? await FS.readText(targetPath) : undefined
            if (targetContent !== movedPostimage) {
              rollbackConflicts.push(
                `${
                  FS.relativePath(projectRoot, targetPath)
                } changed during the move; its current contents were preserved.`,
              )
            } else if (await FS.isFile(targetPath)) {
              await FS.remove(targetPath)
            }
            if (await FS.exists(sourcePath)) {
              rollbackConflicts.push(
                `${current.path} was recreated during the move; its current contents were preserved.`,
              )
            } else {
              await FS.writeText(sourcePath, current.content)
              await FS.chmod(sourcePath, 0o444)
            }
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError)
          }
          for (const rewrite of otherRewrites) {
            try {
              const actual = await FS.isFile(rewrite.path) ? await FS.readText(rewrite.path) : undefined
              if (!completedRewrites.has(rewrite.path) || actual !== rewrite.content) {
                if (actual !== rewrite.current.content) {
                  rollbackConflicts.push(
                    `${rewrite.current.path} changed during the move; its current contents were preserved.`,
                  )
                }
                continue
              }
              if (rewrite.current.path.startsWith('@/studio/')) {
                await generated.rewrite(rewrite.path, rewrite.current.content)
              } else {
                await FS.writeText(rewrite.path, rewrite.current.content)
              }
            } catch (rollbackError) {
              rollbackFailures.push(rollbackError)
            }
          }
          if (relocation.scenariosSource !== undefined) {
            try {
              const content = await FS.exists(scenariosPath) ? await FS.readText(scenariosPath) : undefined
              if (!scenariosWritten || content !== relocation.scenariosSource) {
                if (scenariosWritten) {
                  rollbackConflicts.push(
                    `${scenariosRelativePath} changed during the move; its current contents were preserved.`,
                  )
                }
                scenariosVersion = content === undefined ? undefined : SourceActions.studioSourceVersion(content)
                if (scenariosVersion === undefined) {
                  files.forget(scenariosPath)
                } else {
                  files.note(scenariosPath, scenariosVersion)
                }
              } else if (existingScenarios === undefined) {
                if (await FS.exists(scenariosPath)) {
                  await FS.remove(scenariosPath)
                }
                files.forget(scenariosPath)
              } else {
                await FS.writeText(scenariosPath, existingScenarios.content)
                files.note(scenariosPath, existingScenarios.sourceVersion)
              }
            } catch (rollbackError) {
              rollbackFailures.push(rollbackError)
            }
          }
          if (retiredCatalog !== undefined) {
            try {
              await transaction.restore(beforeCatalog, retiredCatalog.revision)
            } catch (rollbackError) {
              rollbackFailures.push(rollbackError)
            }
          }
          const recoveredVersions = new Map<string, string | undefined>()
          for (const path of [sourcePath, targetPath, ...otherRewrites.map(rewrite => rewrite.path)]) {
            const version = await FS.isFile(path)
              ? SourceActions.studioSourceVersion(await FS.readText(path))
              : undefined
            recoveredVersions.set(path, version)
            if (version === undefined) {
              files.forget(path)
            } else {
              files.note(path, version)
            }
          }
          try {
            const rollback = await coordinator.noteStudioFileMutation([
              ...[...recoveredVersions].map(([path, sourceVersion]) => ({
                path,
                ...(sourceVersion === undefined ? {} : { sourceVersion }),
                writeId: `rollback:${request.writeId}`,
              })),
              ...(relocation.scenariosSource === undefined ? [] : [{
                path: scenariosPath,
                ...(scenariosVersion === undefined ? {} : { sourceVersion: scenariosVersion }),
                writeId: `rollback:${request.writeId}`,
              }]),
            ])
            if (rollback.status === 'error') {
              rollbackFailures.push(new Errors.HostEnvironmentError(rollback.message))
            }
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError)
          }
          if (rollbackConflicts.length > 0) {
            Errors.throwUserInput(`Move rollback incomplete. ${rollbackConflicts.join('\n')}`)
          }
          if (rollbackFailures.length > 0) {
            Errors.throwHostEnvironment(
              `Studio could not completely roll back the failed move of ${name}.`,
              { cause: rollbackFailures[0] },
            )
          }
        }
        throw Errors.fromUnknown(error, { studioOperation: 'move-generated-source', writeId: request.writeId })
      }
    })
  }

  async #targetPackageDeclarationConflicts(targetPackage: string, name: string): Promise<string[]> {
    const { projectRoot, workspace } = this.#context
    const directory = FS.resolvePath(targetPackage, projectRoot)
    Assert.input(await FS.isDirectory(directory), `Target Tao package does not exist: ${targetPackage}`)
    const conflicts: string[] = []
    for (const child of await FS.listDir(directory)) {
      if (!child.endsWith('.tao')) {
        continue
      }
      const path = FS.resolvePath(child, directory)
      const parsed = await workspace.parseSource(await FS.readText(path), Langium.URI.file(path))
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot move generated source until ${FS.relativePath(projectRoot, path)} parses.`,
      )
      if (parsed.entry.ast.statements.some(statement => AST.isDeclaration(statement) && statement.name === name)) {
        conflicts.push(FS.relativePath(projectRoot, path))
      }
    }
    return conflicts
  }

  async #rewriteGeneratedImport(
    file: StudioProjectFileContent,
    name: string,
    targetPackage: string,
  ): Promise<string | undefined> {
    const { projectRoot, workspace } = this.#context
    const path = FS.resolvePath(file.path, projectRoot)
    const parsed = await workspace.parseSource(file.content, Langium.URI.file(path))
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
      `Cannot move generated source until ${file.path} parses.`,
    )
    return rewriteGeneratedStudioImports(file.content, parsed.entry.ast, name, targetPackage)
  }
}

function normalizedTargetPackage(input: string): string {
  const targetPackage = input.trim()
  Assert.input(
    /^@[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*$/.test(targetPackage),
    'Move to package requires an authored @package or @package/subfolder path.',
  )
  return targetPackage
}

function rewriteGeneratedStudioImports(
  content: string,
  file: AST.TaoFile,
  name: string,
  targetPackage: string,
): string | undefined {
  const uses = file.statements.filter(AST.isUseStatement)
  const sourceUses = uses.filter(statement =>
    statement.importPath === '@/studio'
    && statement.importedDeclarations.some(reference => reference.$refText === name)
  )
  if (sourceUses.length === 0) {
    return undefined
  }
  const targetUse = uses.find(statement => statement.importPath === targetPackage)
  const edits: Array<{ end: number; replacement: string; start: number }> = sourceUses.map(statement => {
    Assert.defined(statement.$cstNode, 'parsed use statement has source coordinates')
    const remaining = statement.importedDeclarations
      .map(reference => reference.$refText)
      .filter(imported => imported !== name)
    return {
      end: statement.$cstNode.end,
      replacement: remaining.length === 0 ? '' : `use ${remaining.join(', ')} from @/studio`,
      start: statement.$cstNode.offset,
    }
  })
  if (targetUse === undefined) {
    const lastUse = uses.at(-1)
    if (lastUse?.$cstNode) {
      edits.push({
        end: lastUse.$cstNode.end,
        replacement: `\nuse ${name} from ${targetPackage}`,
        start: lastUse.$cstNode.end,
      })
    } else {
      edits.push({ end: 0, replacement: `use ${name} from ${targetPackage}\n\n`, start: 0 })
    }
  } else if (!targetUse.importedDeclarations.some(reference => reference.$refText === name)) {
    Assert.defined(targetUse.$cstNode, 'parsed target use statement has source coordinates')
    const names = [...targetUse.importedDeclarations.map(reference => reference.$refText), name].toSorted()
    edits.push({
      end: targetUse.$cstNode.end,
      replacement: `use ${names.join(', ')} from ${targetPackage}`,
      start: targetUse.$cstNode.offset,
    })
  }
  return edits
    .toSorted((left, right) => right.start - left.start)
    .reduce((rewritten, edit) => rewritten.slice(0, edit.start) + edit.replacement + rewritten.slice(edit.end), content)
}

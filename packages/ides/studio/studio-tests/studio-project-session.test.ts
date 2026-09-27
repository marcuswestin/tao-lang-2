import { loadSemanticSnapshot, Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { CLI, Errors, FS, Repo, Time } from '@shared'
import { Deferred, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { StudioPreviewManifest } from '../studio-src/StudioPreviewManifest'
import {
  StudioProjectSession,
  type StudioSessionEvent,
  StudioSourceConflictError,
} from '../studio-src/StudioProjectSession'
import {
  studioProtocolChannel,
  studioProtocolVersion,
  studioSourceActionVersion,
} from '../studio-src/StudioProtocol'
import { StudioServerDatasource } from '../studio-src/StudioServerDatasource'
import { systemLightScheme } from './test-studio-fixtures'

Test('Studio project session resolves one current Tao app and serves contained versioned files', async () => {
  await withStudioProject(async (session, paths, root) => {
    const handshake = await session.handshake()
    const file = await session.readFile('Garden.tao')

    Expect(session.projectRoot).toBe(await FS.realPath(root))
    Expect(session.entryPath).toBe(await FS.realPath(paths['Garden.tao']))
    Expect(session.appName).toBe('Garden')
    Expect(handshake.identity).toEqual({ appName: 'Garden', project: await FS.realPath(root) })
    Expect(handshake.apps).toEqual([{ appName: 'Garden', entryPath: 'Garden.tao' }])
    Expect(handshake.entryPath).toBe('Garden.tao')
    Expect(handshake.capabilities.language).toEqual(['lsp', 'textmate'])
    Expect(handshake.capabilities.sourceActions).toEqual({
      canonicalEnvelope: true,
      checkpoints: true,
      proposals: true,
      undo: true,
      version: studioSourceActionVersion,
    })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/source-action/undo' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/file/create' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/file/rename' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/file/delete' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/source-action/inspect' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/source-action/propose' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/data/fill' })
    Expect(handshake.endpoints).toContainEqual({ method: 'WS', path: '/api/language/lsp' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/language/highlight' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/ship/beta' })
    Expect(handshake.endpoints).toContainEqual({ method: 'GET', path: '/api/tests/status' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/tests/run' })
    Expect(handshake.files.map(candidate => candidate.path)).toEqual([
      'Garden.tao',
      'Project.tao',
      'Support.tao',
    ])
    Expect(file.sourceVersion.startsWith('text-v1:')).toBe(true)
    Expect(file.content).toContain('app Garden')
    await Expect(session.readFile('../outside.tao')).rejects.toThrow('not a Tao file in the project')
  })
})

Test('Studio and the CLI load ordered diagnostics through the same validated snapshot seam', async () => {
  await withTaoFiles('tao-studio-semantic-loader-parity-', {
    'Garden.tao': 'app Garden { view Missing }\n',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const cli = await loadSemanticSnapshot({ appName: 'Garden', entryPath: 'Garden.tao', projectRoot: root })
    const ordered = (diagnostics: readonly { filePath?: string; message: string; severity: string }[]) =>
      diagnostics.map(diagnostic => [diagnostic.severity, diagnostic.filePath, diagnostic.message])

    Expect(ordered((await session.semanticSnapshot()).diagnostics)).toEqual(ordered(cli.diagnostics))
  })
})

Test('Agent undo shows its reverse diff and refuses to overwrite a later manual edit', async () => {
  await withStudioProject(async (session, paths) => {
    const original = await session.readFile('Garden.tao')
    const appliedContent = original.content.replace('Text("Before")', 'Text("Agent")')
    const applied = await session.applyAgentFiles({
      edits: [{ content: appliedContent, path: 'Garden.tao' }],
      expect: [{ path: 'Garden.tao', sourceVersion: original.sourceVersion }],
      writeId: 'agent-apply',
    })

    Expect(applied.rolledBack).toBe(false)
    const preview = session.agentUndoPreview()
    Expect(preview?.restored).toEqual(['Garden.tao'])
    Expect(preview?.diff.includes('Text("Agent")')).toBe(true)
    Expect(preview?.diff.includes('Text("Before")')).toBe(true)

    const manualContent = appliedContent.replace('Text("Agent")', 'Text("Manual")')
    await FS.writeText(paths['Garden.tao'], manualContent)

    await Expect(session.undoAgentFiles('agent-undo')).rejects.toThrow(
      'Studio source changed before the edit was applied',
    )
    Expect(await FS.readText(paths['Garden.tao'])).toBe(manualContent)
  })
})

Test('Studio project open repairs generated Studio sources to read-only mode', async () => {
  await withTaoFiles('tao-studio-generated-open-', {
    '@/studio/View1.tao': 'public view View1() { }\n',
    'Garden.tao': 'app Garden { view Main }\nview Main() { }\n',
  }, async (paths, root) => {
    await FS.chmod(paths['@/studio/View1.tao'], 0o644)

    await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })

    Expect(await FS.fileMode(paths['@/studio/View1.tao'])).toBe(0o444)
  })
})

Test('Move to package renames generated source and rewrites every language import site', async () => {
  const compiles: Array<readonly { path: string; sourceVersion?: string }[]> = []
  await withTaoFiles('tao-studio-move-generated-', {
    '@/studio/View1.tao':
      `${'// Studio-written generated source. Read-only until moved to a package.'}\n\npublic view View1() { }\n`,
    '@/studio/Other.tao': 'public view Other() { }\n',
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Garden.tao': `
      use View1, Other from @/studio
      use Existing from @views
      app Garden { view Main }
      view Main() { render View1() }
    `,
    'Nested.tao': `
      use View1 from @/studio
      workspace view Nested() { render View1() }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile(request) {
        compiles.push(request.changes)
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const generated = await session.readFile('@/studio/View1.tao')
    const result = await session.moveGeneratedSource({
      path: generated.path,
      sourceVersion: generated.sourceVersion,
      targetPackage: ' @views ',
      writeId: 'move-view-1',
    })

    Expect(result.status).toBe('moved')
    if (result.status !== 'moved') {
      return
    }
    Expect(result.previousPath).toBe('@/studio/View1.tao')
    Expect(result.file.path).toBe('@views/View1.tao')
    Expect(result.file.content).not.toContain('Studio-written generated source')
    Expect(await FS.fileMode(FS.resolvePath(result.file.path, root))).toBe(0o644)
    Expect(await FS.exists(paths['@/studio/View1.tao'])).toBe(false)
    Expect(await FS.readText(paths['Garden.tao'])).toContain('use Other from @/studio')
    Expect(await FS.readText(paths['Garden.tao'])).toContain('use Existing, View1 from @views')
    Expect(await FS.readText(paths['Nested.tao'])).toContain('use View1 from @views')
    Expect(result.rewritten.map(file => file.path).toSorted()).toEqual(['Garden.tao', 'Nested.tao'])
    Expect(compiles).toHaveLength(1)
    Expect(compiles[0]?.map(change => FS.relativePath(session.projectRoot, change.path)).toSorted()).toEqual([
      '@/studio/View1.tao',
      '@views/View1.tao',
      'Garden.tao',
      'Nested.tao',
    ])
  })
})

Test('Move to package retires the catalog sketch after source and compile succeed', async () => {
  await withTaoFiles('tao-studio-move-retires-sketch-', {
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Garden.tao': 'app Garden { view Main }\nview Main() { }\n',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const created = await session.applySketchAction({
      action: {
        height: 80,
        id: 'move-sketch',
        kind: 'create-sketch',
        project: await FS.realPath(root),
        rects: [{ content: 'Card', height: 40, id: 'card', kind: 'Text', width: 80, x: 10, y: 10 }],
        width: 200,
      },
      expectedRevision: 0,
      requestId: 'create-move-sketch',
    })
    const generated = await session.readFile('@/studio/View1.tao')

    const result = await session.moveGeneratedSource({
      path: generated.path,
      sourceVersion: generated.sourceVersion,
      targetPackage: '@views',
      writeId: 'move-retire-sketch',
    })

    Expect(result.status).toBe('moved')
    Expect((await session.sketchCatalog()).sketches).toEqual([])
    Expect((await session.sketchCatalog()).revision).toBe(created.catalog.revision + 1)
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(true)
    Expect(await FS.exists(FS.resolvePath('@/studio/View1.tao', root))).toBe(false)
  })
})

for (const relocateScenarios of [undefined, false]) {
  Test(
    `Move to package preserves shared fixture journeys with relocation ${relocateScenarios ?? 'default'}`,
    async () => {
      await withTaoFiles('tao-studio-move-scenarios-', {
        '@/studio/View1.tao': `// Studio-written generated source. Read-only until moved to a package.
        use Playlist from ../../Data.tao
        use Sketches from ${relocateScenarios === false ? './Sketches' : './Sketches.tao'}
        use Text from @tao/ui
        public view View1(Playlist) {
          #studio_rect_007400690074006c0065
          render Text(Playlist.Title)
        }
        scenarios View1 "sketch" {
          fixture Sketches
          device phone
          scenario "draft" { render (Playlist: Chill) press #studio_rect_007400690074006c0065 }
        }
      `,
        '@/studio/Sketches.tao':
          'use Playlist from ../../Data.tao\npublic fixture Sketches { Chill = create Playlist { Title: "Chill" } }',
        '@views/Existing.tao': 'public view Existing() { }',
        'Data.tao': 'public data Playlists / Playlist { Title text }',
        'Garden.tao': 'app Garden { view Main }\nview Main() { }',
        'Scenarios.tao': '// Existing authored content\nlet ExistingValue = "keep"',
      }, async (paths, root) => {
        const session = await StudioProjectSession.open({
          async compile() {},
          entryPath: paths['Garden.tao'],
          projectRoot: root,
        })
        const generated = await session.readFile('@/studio/View1.tao')
        const result = await session.moveGeneratedSource({
          path: generated.path,
          ...(relocateScenarios === undefined ? {} : { relocateScenarios }),
          sourceVersion: generated.sourceVersion,
          targetPackage: '@views',
          writeId: 'move-scenarios',
        })
        Expect(result.status).toBe('moved')
        const movedPath = FS.resolvePath('@views/View1.tao', root)
        const moved = await FS.readText(movedPath)
        Expect(moved).toContain('use Playlist from ../Data.tao')
        Expect(moved).toContain('#studio_rect_007400690074006c0065')
        Expect(moved.includes('scenarios View1')).toBe(relocateScenarios === false)
        const scenarios = await FS.readText(paths['Scenarios.tao'])
        Expect(scenarios).toContain('// Existing authored content')
        Expect(scenarios).toContain('let ExistingValue = "keep"')
        Expect(scenarios.includes('scenarios View1')).toBe(relocateScenarios !== false)
        const parsed = await (await Workspace.open(root)).parse(
          relocateScenarios === false ? movedPath : paths['Scenarios.tao'],
        )
        const group = parsed.entry.ast.statements.find(AST.isScenarioGroupDeclaration)!
        Expect.Is(group.subject?.ref, AST.isViewDeclaration)
        Expect(AST.getDocument(group.subject!.ref!).uri.fsPath).toBe(movedPath)
        const fixture = group.block.entries.find(AST.isScenarioFixtureClause)?.fixture.ref
        Expect.Is(fixture, AST.isFixtureDeclaration)
        Expect(AST.getDocument(fixture).uri.fsPath).toBe(paths['@/studio/Sketches.tao'])
        Expect(group.block.entries.find(AST.isScenarioDeclaration)?.block.steps[0]?.$cstNode?.text)
          .toBe('press #studio_rect_007400690074006c0065')
      })
    },
  )
}

for (const failure of ['compile', 'import collision'] as const) {
  Test(`Move to package preserves existing Scenarios.tao after ${failure}`, async () => {
    await withTaoFiles('tao-studio-move-existing-scenarios-', {
      '@/studio/View1.tao':
        '// Studio-written generated source. Read-only until moved to a package.\npublic view View1() { }\nscenarios View1 "sketch" { scenario "draft" { render () } }',
      '@views/Existing.tao': 'public view Existing() { }',
      '@other/View1.tao': 'public view View1() { }',
      'Garden.tao': 'app Garden { view Main }\nview Main() { }',
      'Scenarios.tao': failure === 'import collision'
        ? 'use View1 from @other\nlet Kept = "authored"'
        : 'let Kept = "authored"',
    }, async (paths, root) => {
      let failCompile = failure === 'compile'
      const session = await StudioProjectSession.open({
        async compile() {
          if (failCompile) {
            failCompile = false
            Errors.throwUserInput('Rejected relocated scenarios.')
          }
        },
        entryPath: paths['Garden.tao'],
        projectRoot: root,
      })
      const before = await session.readFile('@/studio/View1.tao')
      const scenariosBefore = await FS.readText(paths['Scenarios.tao'])
      await Expect(session.moveGeneratedSource({
        path: before.path,
        sourceVersion: before.sourceVersion,
        targetPackage: '@views',
        writeId: 'move-failing-relocation',
      })).rejects.toThrow(failure === 'compile' ? 'authored Tao source failed to compile' : 'already imports View1')
      Expect(await session.readFile('@/studio/View1.tao')).toEqual(before)
      Expect(await FS.readText(paths['Scenarios.tao'])).toBe(scenariosBefore)
      Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
    })
  })
}

Test('Move to package restores source, imports, catalog, and compile state after compile failure', async () => {
  let failMoveCompile = false
  const compiles: Array<readonly { path: string; sourceVersion?: string }[]> = []
  await withTaoFiles('tao-studio-move-rollback-', {
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Garden.tao': 'use View1 from @/studio\napp Garden { view Main }\nview Main() { render View1() }\n',
    'Nested.tao': 'use View1 from @/studio\nworkspace view Nested() { render View1() }\n',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile(request) {
        compiles.push(request.changes)
        if (failMoveCompile) {
          failMoveCompile = false
          Errors.throwUserInput('Moved source does not compile.')
        }
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    await session.applySketchAction({
      action: {
        height: 80,
        id: 'move-sketch',
        kind: 'create-sketch',
        project: await FS.realPath(root),
        rects: [{ content: 'Card', height: 40, id: 'card', kind: 'Text', width: 80, x: 10, y: 10 }],
        width: 200,
      },
      expectedRevision: 0,
      requestId: 'create-move-rollback-sketch',
    })
    const beforeFile = await session.readFile('@/studio/View1.tao')
    const beforeCatalog = await session.sketchCatalog()
    const beforeGarden = await FS.readText(paths['Garden.tao'])
    const beforeNested = await FS.readText(paths['Nested.tao'])
    failMoveCompile = true

    await Expect(session.moveGeneratedSource({
      path: beforeFile.path,
      sourceVersion: beforeFile.sourceVersion,
      targetPackage: '@views',
      writeId: 'move-rollback-sketch',
    })).rejects.toThrow('authored Tao source failed to compile')

    Expect(await session.readFile('@/studio/View1.tao')).toEqual(beforeFile)
    Expect(await FS.readText(paths['Garden.tao'])).toBe(beforeGarden)
    Expect(await FS.readText(paths['Nested.tao'])).toBe(beforeNested)
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
    Expect(await FS.exists(FS.resolvePath('Scenarios.tao', root))).toBe(false)
    Expect(await FS.fileMode(FS.resolvePath('@/studio/View1.tao', root))).toBe(0o444)
    Expect(await session.sketchCatalog()).toEqual(beforeCatalog)
    Expect(session.compileSnapshot().status).toBe('compiled')
    Expect(compiles).toHaveLength(3)
  })
})

for (const changed of ['target', 'original', 'import'] as const) {
  Test(`Move rollback preserves an external ${changed} edit while compilation is pending`, async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    let failMove = false
    await withTaoFiles('tao-studio-move-external-edit-', {
      '@views/Existing.tao': 'public view Existing() { }\n',
      'Garden.tao': 'use View1 from @/studio\napp Garden { view Main }\nview Main() { render View1() }\n',
    }, async (paths, root) => {
      const session = await StudioProjectSession.open({
        async compile() {
          if (failMove) {
            failMove = false
            entered.resolve()
            await release.promise
            Errors.throwUserInput('Moved source does not compile.')
          }
        },
        entryPath: paths['Garden.tao'],
        projectRoot: root,
      })
      await session.applySketchAction({
        action: {
          height: 80,
          id: 'concurrent-move',
          kind: 'create-sketch',
          project: await FS.realPath(root),
          rects: [],
          width: 200,
        },
        expectedRevision: 0,
        requestId: 'create-concurrent-move',
      })
      const before = await session.readFile('@/studio/View1.tao')
      const original = FS.resolvePath(before.path, root)
      const target = FS.resolvePath('@views/View1.tao', root)
      const editedPath = changed === 'target' ? target : changed === 'original' ? original : paths['Garden.tao']
      const external = '// External edit must survive failed Move.\npublic view External() { }\n'
      failMove = true
      const moving = session.moveGeneratedSource({
        path: before.path,
        sourceVersion: before.sourceVersion,
        targetPackage: '@views',
        writeId: `concurrent-${changed}`,
      })
      await entered.promise
      try {
        await FS.writeText(editedPath, external)
      } finally {
        release.resolve()
      }
      await Expect(moving).rejects.toThrow('Move rollback incomplete')
      Expect(await FS.readText(editedPath)).toBe(external)
      if (changed !== 'original') {
        Expect(await FS.readText(original)).toBe(before.content)
      }
      if (changed !== 'target') {
        Expect(await FS.exists(target)).toBe(false)
      }
      Expect((await session.readFile(FS.relativePath(root, editedPath))).content).toBe(external)
    })
  })
}

Test('Move to package serializes source and catalog rollback against an independent Studio create', async () => {
  const moveCompileEntered = Deferred<void>()
  const releaseMoveCompile = Deferred<void>()
  let pauseMove = false
  await withTaoFiles('tao-studio-move-process-rollback-', {
    '@views/Existing.tao': 'public view Existing() { }\n',
    'Garden.tao': 'use View1 from @/studio\napp Garden { view Main }\nview Main() { render View1() }\n',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {
        if (pauseMove) {
          pauseMove = false
          moveCompileEntered.resolve()
          await releaseMoveCompile.promise
          Errors.throwUserInput('Moved source does not compile.')
        }
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const created = await session.applySketchAction({
      action: {
        height: 80,
        id: 'move-process-sketch',
        kind: 'create-sketch',
        project: await FS.realPath(root),
        rects: [],
        width: 200,
      },
      expectedRevision: 0,
      requestId: 'create-move-process-sketch',
    })
    const generated = await session.readFile('@/studio/View1.tao')
    pauseMove = true
    const failedMove = session.moveGeneratedSource({
      path: generated.path,
      sourceVersion: generated.sourceVersion,
      targetPackage: '@views',
      writeId: 'move-process-failure',
    })
    await moveCompileEntered.promise
    const marker = FS.resolvePath('independent-move-create-finished', root)
    const sessionModule = Repo.resolvePath('packages/ides/studio/studio-src/StudioProjectSession.ts')
    const sharedModule = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const independent = CLI.run('bun', {
      args: [
        '-e',
        `
      import { StudioProjectSession } from ${JSON.stringify(sessionModule)}
      import { FS } from ${JSON.stringify(sharedModule)}
      const root = ${JSON.stringify(root)}
      const project = await FS.realPath(root)
      const session = await StudioProjectSession.open({
        async compile() {},
        entryPath: FS.resolvePath('Garden.tao', root),
        projectRoot: root,
      })
      await session.applySketchAction({
        action: {
          height: 40,
          id: 'independent-move-sketch',
          kind: 'create-sketch',
          project,
          rects: [],
          width: 100,
        },
        expectedRevision: ${created.catalog.revision},
        requestId: 'independent-move-create',
      })
      await FS.writeText(${JSON.stringify(marker)}, 'done')
    `,
      ],
      stdio: 'pipe',
    })
    await Time.sleep(40)
    Expect(await FS.exists(marker)).toBe(false)
    releaseMoveCompile.resolve()
    await Expect(failedMove).rejects.toThrow('authored Tao source failed to compile')
    const independentResult = await independent
    Expect(independentResult.stderr).toBe('')
    Expect(independentResult.exitCode).toBe(0)
    Expect(await FS.exists(FS.resolvePath('@/studio/View1.tao', root))).toBe(true)
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
    const catalog = await session.sketchCatalog()
    Expect(catalog.revision).toBe(created.catalog.revision + 1)
    Expect(catalog.sketches.map(sketch => sketch.id).toSorted()).toEqual([
      'independent-move-sketch',
      'move-process-sketch',
    ])
  })
})

Test('Move to package requests a different destination only when the target package declares the name', async () => {
  let compileCount = 0
  await withTaoFiles('tao-studio-move-generated-conflict-', {
    '@/studio/View1.tao':
      `${'// Studio-written generated source. Read-only until moved to a package.'}\n\npublic view View1() { }\n`,
    '@views/Existing.tao': 'public view View1() { }\n',
    'Garden.tao': 'use View1 from @/studio\napp Garden { view View1 }\n',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {
        compileCount += 1
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const generated = await session.readFile('@/studio/View1.tao')
    const request = {
      path: generated.path,
      sourceVersion: generated.sourceVersion,
      targetPackage: '@views',
      writeId: 'move-conflicting-view',
    }
    const conflict = await session.moveGeneratedSource(request)

    Expect(conflict).toEqual({
      conflicts: ['@views/Existing.tao'],
      name: 'View1',
      status: 'confirmation-required',
      targetPackage: '@views',
    })
    Expect(compileCount).toBe(0)
    Expect(await FS.exists(paths['@/studio/View1.tao'])).toBe(true)
    Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
  })
})

Test('Studio project session publishes every project app variant with a safe relative entry path', async () => {
  await withTaoFiles('tao-studio-app-variants-', {
    'First.tao': 'app First { view Main }\napp FirstCompact = First with { }\nview Main() { }\n',
    'Nested/Second.tao': 'app Second { view Main }\nview Main() { }\n',
  }, async (_paths, root) => {
    const session = await StudioProjectSession.open({
      appName: 'FirstCompact',
      async compile() {},
      entryPath: 'First.tao',
      projectRoot: root,
    })

    Expect(session.appName).toBe('FirstCompact')
    Expect(session.entryPath).toBe(FS.resolvePath('First.tao', await FS.realPath(root)))
    Expect((await session.handshake()).apps).toEqual([
      { appName: 'First', entryPath: 'First.tao' },
      { appName: 'FirstCompact', entryPath: 'First.tao' },
      { appName: 'Second', entryPath: 'Nested/Second.tao' },
    ])
  })
})

Test('Studio project session opens the project DefaultApp when the command line named none', async () => {
  await withTaoFiles('tao-studio-default-app-', {
    'Project.tao': 'project { id "reader" name "Reader" DefaultApp Second }\n',
    'Reader.tao': 'app First { view Main }\napp Second { view Main }\nview Main() { }\n',
  }, async (_paths, root) => {
    // A project that names its DefaultApp has already answered "which app"; Studio used to refuse
    // every multi-app project until someone repeated that answer as --app.
    const session = await StudioProjectSession.open({ async compile() {}, projectRoot: root })
    Expect(session.appName).toBe('Second')

    const explicit = await StudioProjectSession.open({ appName: 'First', async compile() {}, projectRoot: root })
    Expect(explicit.appName).toBe('First')
  })
})

Test('Studio project session lets an explicit entry override the project DefaultApp', async () => {
  await withTaoFiles('tao-studio-explicit-entry-', {
    'Project.tao': 'project { id "reader" name "Reader" DefaultApp Second }\n',
    'First.tao': 'app First { view FirstMain }\nview FirstMain() { }\n',
    'Second.tao': 'app Second { view SecondMain }\nview SecondMain() { }\n',
  }, async (_paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: 'First.tao',
      projectRoot: root,
    })

    Expect(session.appName).toBe('First')
    Expect(session.entryPath).toBe(FS.resolvePath('First.tao', await FS.realPath(root)))
  })
})

Test('Studio project session still asks which app to open when the project names no default', async () => {
  await withTaoFiles('tao-studio-no-default-app-', {
    'Reader.tao': 'app First { view Main }\napp Second { view Main }\nview Main() { }\n',
  }, async (_paths, root) => {
    await Expect(StudioProjectSession.open({ async compile() {}, projectRoot: root })).rejects.toThrow(
      'Multiple Tao apps found: First, Second.',
    )
  })
})

Test('Studio project session exposes parser-owned design tokens and local bundles', async () => {
  await withTaoFiles('tao-studio-design-', {
    'Garden.tao': `
      design GardenDesign {
         ink #121826
         card [gap 8, fg ink]
      }
      app Garden { view Main }
      view Main() { render Stack() [card] }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const file = await session.readFile('Garden.tao')

    const values = await session.inspectDesign({ path: file.path, sourceVersion: file.sourceVersion })
    Expect(values).toHaveLength(2)
    Expect(values[0]).toMatchObject({ designName: 'GardenDesign', kind: 'token', name: 'ink', value: '#121826' })
    Expect(values[1]).toMatchObject({
      designName: 'GardenDesign',
      entries: ['gap 8', 'fg ink'],
      kind: 'bundle',
      name: 'card',
    })
    for (const value of values) {
      Expect(file.content.slice(value.start, value.end)).toContain(value.name)
    }
  })
})

Test('Studio project session inventories every structured design family with exact source identity', async () => {
  await withTaoFiles('tao-studio-structured-design-', {
    'Garden.tao': `
      design GardenDesign {
         colors { ember #d9622b { 20 #f4d7c8 } canvas when Scheme is Dark ember.20 / not #fff }
         sizes { sm 8.px, md sm + 4.px }
         text { body [size sm, ink canvas] }
         screens { narrow below 500.px, wide }
         styles { card [radius md] Text [ink canvas] }
      }
      app Garden { view Main Design GardenDesign }
      view Main() { render Text("Garden") [card, body] }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const file = await session.readFile('Garden.tao')
    const values = await session.inspectDesign({ path: file.path, sourceVersion: file.sourceVersion })
    Expect(values.map(value => ({ kind: value.kind, name: value.name }))).toEqual([
      { kind: 'color', name: 'ember' },
      { kind: 'color', name: 'ember.20' },
      { kind: 'color', name: 'canvas' },
      { kind: 'size', name: 'sm' },
      { kind: 'size', name: 'md' },
      { kind: 'text', name: 'body' },
      { kind: 'screen', name: 'narrow' },
      { kind: 'screen', name: 'wide' },
      { kind: 'style', name: 'card' },
      { kind: 'default', name: 'Text' },
    ])
    for (const value of values.filter(value => 'start' in value)) {
      Expect(value.designName).toBe('GardenDesign')
      Expect(value.start).toBeLessThan(value.end)
      Expect(file.content.slice(value.start, value.end)).toContain(value.name.split('.').at(-1)!)
    }
  })
})

Test('Studio applies and undoes structured size promotion through the versioned source-action bus', async () => {
  await withTaoFiles('tao-studio-size-promotion-', {
    'Garden.tao': `
      design GardenDesign { colors { ink #111 } styles { Text [ink ink] } }
      app Garden { view Main Design GardenDesign }
      view Main() { render Text("Before") [size 18] }
    `,
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    session.registerPreview({ previewInstanceId: 'preview-size-promotion' })
    const original = await session.readFile('Garden.tao')
    const selected = 'render Text("Before") [size 18]'
    const start = original.content.indexOf(selected)
    const renderId = `${FS.resolvePath(original.path, session.projectRoot)}:${start}:${start + selected.length}`
    const envelope = {
      action: {
        entry: ['size', 18],
        kind: 'set-style-entry',
        landing: { kind: 'size-token', tokenName: 'titleSize' },
        renderId,
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'size-promotion', phase: 'single' },
      identity: {
        ...session.identity(),
        occurrence: { nodeKind: 'render', renderOwner: 'Main' },
        path: original.path,
        previewInstanceId: 'preview-size-promotion',
        sourceVersion: original.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'size-promotion-apply',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const
    const applied = await session.applySourceAction(envelope)
    Expect(applied.content).toContain('sizes {\n      titleSize 18.px\n   }')
    Expect(applied.content).toContain('Text("Before") [size titleSize]')
    const undone = await session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'size-promotion',
      identity: { ...envelope.identity, sourceVersion: applied.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'size-promotion-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })
    Expect(undone.content).toBe(original.content)
  })
})

Test('Studio project session rejects Tao symlinks that escape the project root', async () => {
  await withStudioProject(async (session, _paths, root) => {
    const outside = FS.resolvePath('outside.tao', FS.dirname(root))
    await FS.writeText(outside, 'view Outside() { }\n')
    await FS.symlink(outside, FS.resolvePath('Escaped.tao', root))
    try {
      await Expect(session.readFile('Escaped.tao')).rejects.toThrow('resolves outside the project')
    } finally {
      await FS.remove(outside)
    }
  })
})

Test('Studio file CRUD is versioned, serialized, watcher-aware, and refreshes tree metadata', async () => {
  const compiles: Array<{ changes: readonly { path: string; sourceVersion?: string }[] }> = []
  await withStudioProject(async (session, _paths, root) => {
    const events: StudioSessionEvent[] = []
    session.subscribe(event => events.push(event))

    const created = await session.createFile({ path: 'Nested/New.tao', writeId: 'create-new' })
    Expect(created.file.path).toBe('Nested/New.tao')
    Expect(created.file.dirty).toBe(false)
    Expect(await FS.readText(FS.resolvePath('Nested/New.tao', root))).toBe('')
    const createWatch = await session.noteWatchChanges([{
      path: 'Nested/New.tao',
      sourceVersion: created.file.sourceVersion,
    }])
    Expect(createWatch.compile).toBe(undefined)
    Expect(createWatch.acknowledgements.map(item => item.writeId)).toEqual(['create-new'])

    const renamed = await session.renameFile({
      path: created.file.path,
      sourceVersion: created.file.sourceVersion,
      targetPath: 'Nested/Renamed.tao',
      writeId: 'rename-new',
    })
    Expect(renamed.previousPath).toBe('Nested/New.tao')
    Expect(renamed.file.path).toBe('Nested/Renamed.tao')
    Expect(await FS.exists(FS.resolvePath('Nested/New.tao', root))).toBe(false)
    const renameWatch = await session.noteWatchChanges([
      { path: 'Nested/New.tao' },
      { path: 'Nested/Renamed.tao', sourceVersion: renamed.file.sourceVersion },
    ])
    Expect(renameWatch.compile).toBe(undefined)
    Expect(renameWatch.acknowledgements.map(item => item.writeId)).toEqual(['rename-new', 'rename-new'])

    const deleted = await session.deleteFile({
      path: renamed.file.path,
      sourceVersion: renamed.file.sourceVersion,
      writeId: 'delete-new',
    })
    Expect(deleted.files.some(file => file.path === renamed.file.path)).toBe(false)
    const deleteWatch = await session.noteWatchChanges([{ path: 'Nested/Renamed.tao' }])
    Expect(deleteWatch.compile).toBe(undefined)
    Expect(deleteWatch.acknowledgements.map(item => item.writeId)).toEqual(['delete-new'])

    Expect(compiles.map(compile => compile.changes.map(change => FS.relativePath(session.projectRoot, change.path))))
      .toEqual([
        ['Nested/New.tao'],
        ['Nested/New.tao', 'Nested/Renamed.tao'],
        ['Nested/Renamed.tao'],
      ])
    Expect(events.filter(event => event.type === 'files-changed')).toHaveLength(3)
  }, request => compiles.push(request))
})

Test('Studio file CRUD rejects unsafe, destructive, stale, and dirty mutations', async () => {
  await withStudioProject(async (session, _paths, root) => {
    const support = await session.readFile('Support.tao')
    await Expect(session.createFile({ path: 'Notes.txt', writeId: 'invalid-extension' }))
      .rejects.toThrow('not a Tao file')
    await Expect(session.createFile({ path: 'Support.tao', writeId: 'overwrite' }))
      .rejects.toThrow('already exists')
    await Expect(session.renameFile({
      path: 'Garden.tao',
      sourceVersion: (await session.readFile('Garden.tao')).sourceVersion,
      targetPath: 'Moved.tao',
      writeId: 'rename-entry',
    })).rejects.toThrow('active app entry')
    await Expect(session.deleteFile({
      path: 'Garden.tao',
      sourceVersion: (await session.readFile('Garden.tao')).sourceVersion,
      writeId: 'delete-entry',
    })).rejects.toThrow('active app entry')

    await FS.writeText(FS.resolvePath('Support.tao', root), 'view Support() { render Text("changed") }\n')
    await Expect(session.deleteFile({
      path: support.path,
      sourceVersion: support.sourceVersion,
      writeId: 'stale-delete',
    })).rejects.toBeInstanceOf(StudioSourceConflictError)

    const changed = await session.readFile('Support.tao')
    const invalid = await session.syncDraft({
      content: 'view Support() {',
      path: changed.path,
      sourceVersion: changed.sourceVersion,
      writeId: 'dirty-support',
    })
    Expect(invalid.saved).toBe(false)
    const dirty = (await session.files()).find(file => file.path === changed.path)!
    Expect(dirty.dirty).toBe(true)
    Expect(dirty.diagnosticCount).toBeGreaterThan(0)
    await Expect(session.renameFile({
      path: changed.path,
      sourceVersion: changed.sourceVersion,
      targetPath: 'Renamed.tao',
      writeId: 'dirty-rename',
    })).rejects.toThrow('unsaved Studio draft')
    await Expect(session.deleteFile({
      path: changed.path,
      sourceVersion: changed.sourceVersion,
      writeId: 'dirty-delete',
    })).rejects.toThrow('unsaved Studio draft')

    const outside = await mkTestDir('tao-studio-crud-outside-')
    await FS.symlink(outside, FS.resolvePath('Linked', root))
    try {
      await Expect(session.createFile({ path: 'Linked/Escaped.tao', writeId: 'symlink-create' }))
        .rejects.toThrow('outside the project')
    } finally {
      await FS.remove(outside)
    }
  })
})

Test('Studio lists project files from one scan kept current by writes and watcher echoes', async () => {
  let listings = 0
  let reads = 0
  const compiledFiles: Array<Record<string, string>> = []
  await withTaoFiles(
    'tao-studio-incremental-files-',
    {
      'Garden.tao': 'app Garden { view Main }\nview Main() { render Text("Before") }\n',
      'Support.tao': 'view Support() { }\n',
    },
    async (paths, root) => {
      let session: StudioProjectSession | undefined
      session = await StudioProjectSession.open({
        async compile() {
          const files = await session!.files()
          compiledFiles.push(Object.fromEntries(files.map(file => [file.path, file.sourceVersion])))
        },
        entryPath: paths['Garden.tao'],
        projectFilesIO: {
          async listTaoFiles(projectRoot) {
            listings += 1
            return (await FS.listDir(projectRoot))
              .filter(name => name.endsWith('.tao'))
              .map(name => FS.resolvePath(name, projectRoot))
          },
          readText(path) {
            reads += 1
            return FS.readText(path)
          },
        },
        projectRoot: root,
      })
      const datasource = new StudioServerDatasource(session)
      const initial = await session.files()
      const initialReads = reads
      Expect(listings).toBe(1)
      Expect(initialReads).toBe(initial.length)
      Expect(initial.map(file => file.path)).toEqual(['Garden.tao', 'Project.tao', 'Support.tao'])

      await session.compileInitial()
      const garden = await session.readFile('Garden.tao')
      const saved = await session.syncDraft({
        content: garden.content.replace('Before', 'After'),
        path: garden.path,
        sourceVersion: garden.sourceVersion,
        writeId: 'save-garden',
      })
      const created = await session.createFile({ path: 'Nested/New.tao', writeId: 'create-new' })
      await session.noteWatchChanges([
        { path: 'Garden.tao', sourceVersion: saved.file.sourceVersion },
        { path: 'Nested/New.tao', sourceVersion: created.file.sourceVersion },
      ])
      const renamed = await session.renameFile({
        path: created.file.path,
        sourceVersion: created.file.sourceVersion,
        targetPath: 'Nested/Renamed.tao',
        writeId: 'rename-new',
      })
      await datasource.fill({ entity: 'Files' })
      await datasource.fill({ entity: 'Problems' })
      await datasource.fill({ entity: 'DesignTokens' })

      // An editor outside Studio rewrites Support.tao; the watcher reports the version it hashed.
      const externalContent = 'view Support() { render Text("external") }\n'
      await FS.writeText(paths['Support.tao'], externalContent)
      const supportVersionBefore = initial.find(file => file.path === 'Support.tao')!.sourceVersion
      const external = await session.noteWatchChanges([{ path: paths['Support.tao'], sourceVersion: 'external-1' }])
      Expect(external.compile?.status).toBe('compiled')
      Expect((await session.files()).find(file => file.path === 'Support.tao')?.sourceVersion).toBe('external-1')
      Expect(supportVersionBefore).not.toBe('external-1')

      // A watcher report without a version means "look for yourself": one read, not a rescan.
      const readsBeforeUnversioned = reads
      await session.noteWatchChanges([{ path: paths['Support.tao'] }])
      Expect(reads).toBe(readsBeforeUnversioned + 1)
      Expect((await session.files()).find(file => file.path === 'Support.tao')?.sourceVersion)
        .toBe((await session.readFile('Support.tao')).sourceVersion)

      await FS.remove(paths['Support.tao'])
      await session.noteWatchChanges([{ path: paths['Support.tao'] }])
      await session.deleteFile({
        path: renamed.file.path,
        sourceVersion: renamed.file.sourceVersion,
        writeId: 'delete-renamed',
      })
      await datasource.fill({ entity: 'Files' })
      await datasource.fill({ entity: 'Problems' })
      datasource.close()

      Expect((await session.files()).map(file => [file.path, file.sourceVersion])).toEqual([
        ['Garden.tao', saved.file.sourceVersion],
        ['Project.tao', initial.find(file => file.path === 'Project.tao')!.sourceVersion],
      ])
      Expect(compiledFiles.length).toBeGreaterThanOrEqual(6)
      Expect(compiledFiles[1]?.['Garden.tao']).toBe(saved.file.sourceVersion)
      Expect(compiledFiles[2]?.['Nested/New.tao']).toBe(created.file.sourceVersion)
      Expect(compiledFiles[3]?.['Nested/Renamed.tao']).toBe(renamed.file.sourceVersion)
      Expect(compiledFiles[3]?.['Nested/New.tao']).toBeUndefined()
      Expect(compiledFiles.at(-1)?.['Support.tao']).toBeUndefined()
      Expect(listings).toBe(1)
      Expect(reads).toBe(initialReads + 1)
    },
  )
})

Test('Studio file reconciliation repairs changes missed by the OS watcher', async () => {
  await withStudioProject(async (session, paths, root) => {
    const before = await session.files()
    const supportBefore = before.find(file => file.path === 'Support.tao')!.sourceVersion
    await FS.writeText(paths['Support.tao'], 'view Support() { render Text("reconciled") }\n')
    await FS.writeText(FS.resolvePath('Added.tao', root), 'view Added() { }\n')

    // The cache remains a cheap in-memory view until its watcher-owned reconciliation pass runs.
    Expect((await session.files()).some(file => file.path === 'Added.tao')).toBe(false)
    const reconciled = await session.reconcileProjectFiles()
    const after = await session.files()
    Expect(reconciled?.compile?.status).toBe('compiled')
    Expect(after.map(file => file.path)).toContain('Added.tao')
    Expect(after.find(file => file.path === 'Support.tao')?.sourceVersion).not.toBe(supportBefore)

    await FS.remove(paths['Support.tao'])
    await session.reconcileProjectFiles()
    Expect((await session.files()).some(file => file.path === 'Support.tao')).toBe(false)
  })
})

Test('Studio draft writes keep invalid source off disk and acknowledge their exact watcher echo', async () => {
  const compileRevisions: number[] = []
  await withStudioProject(async (session, paths) => {
    const initial = await session.readFile('Garden.tao')
    const invalid = await session.syncDraft({
      content: 'app Garden {',
      path: initial.path,
      sourceVersion: initial.sourceVersion,
      writeId: 'draft-invalid',
    })

    Expect(invalid.saved).toBe(false)
    Expect(invalid.diagnostics.length).toBeGreaterThan(0)
    Expect(await FS.readText(paths['Garden.tao'])).toBe(initial.content)
    Expect(compileRevisions).toEqual([])

    const content = initial.content.replace('Before', 'After')
    const saved = await session.syncDraft({
      content,
      path: initial.path,
      sourceVersion: initial.sourceVersion,
      writeId: 'draft-valid',
    })
    const watch = await session.noteWatchChanges([{
      path: initial.path,
      sourceVersion: saved.file.sourceVersion,
    }])

    Expect(saved.saved).toBe(true)
    Expect(saved.compile?.compileRevision).toBe(1)
    Expect(await FS.readText(paths['Garden.tao'])).toBe(content)
    Expect(watch.compile).toBe(undefined)
    Expect(watch.acknowledgements.map(acknowledgement => acknowledgement.writeId)).toEqual(['draft-valid'])
    Expect(compileRevisions).toEqual([1])

    await Expect(session.syncDraft({
      content: content.replace('After', 'Stale'),
      path: initial.path,
      sourceVersion: initial.sourceVersion,
      writeId: 'draft-stale',
    })).rejects.toBeInstanceOf(StudioSourceConflictError)
  }, request => {
    compileRevisions.push(request.compileRevision)
  })
})

Test('Studio watcher compiles remaining changes when a co-batched Tao file was deleted', async () => {
  await withStudioProject(async (session, paths) => {
    await FS.remove(paths['Support.tao'])
    const result = await session.noteWatchChanges([
      { path: paths['Support.tao'] },
      { path: paths['Garden.tao'], sourceVersion: 'external-version' },
    ])

    Expect(result.compile?.status).toBe('compiled')
    Expect(result.compile?.changes.map(change => FS.relativePath(session.projectRoot, change.path))).toEqual([
      'Support.tao',
      'Garden.tao',
    ])
  })
})

Test('Studio session listener failures do not interrupt compile completion or later listeners', async () => {
  await withStudioProject(async session => {
    const events: StudioSessionEvent[] = []
    session.subscribe(() => {
      Errors.throwUnexpected('listener failed')
    })
    session.subscribe(event => events.push(event))

    const completion = await session.compileInitial()

    Expect(completion.status).toBe('compiled')
    Expect(events.filter(event => event.type === 'compile-state')).toHaveLength(2)
  })
})

Test('Studio routes a canonical source-action envelope idempotently through source-actions', async () => {
  const events: StudioSessionEvent[] = []
  let compileCount = 0
  await withStudioProject(async session => {
    const file = await session.readFile('Garden.tao')
    const envelope = {
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'checkpoint-1', phase: 'single' },
      identity: {
        ...session.identity(),
        path: file.path,
        previewInstanceId: 'preview-1',
        sourceVersion: file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'action-1',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const
    const unsubscribe = session.subscribe(event => events.push(event))
    try {
      const applied = await session.applySourceAction(envelope)
      const retried = await session.applySourceAction(envelope)

      Expect(applied.content).toContain('Text("New text")')
      Expect(applied.checkpoint).toEqual({ id: 'checkpoint-1', status: 'committed' })
      Expect(applied.sourceVersion).not.toBe(file.sourceVersion)
      Expect(retried).toEqual(applied)
      Expect(compileCount).toBe(1)
      Expect(events.some(event => event.type === 'file-changed')).toBe(true)
      Expect(events.filter(event => event.type === 'compile-state')).toHaveLength(3)
      session.registerPreview({ previewInstanceId: 'preview-2' })
      await Expect(session.applySourceAction(envelope)).rejects.toMatchObject({ code: 'stale-preview' })
      Expect(compileCount).toBe(1)
    } finally {
      unsubscribe()
    }
  }, () => {
    compileCount += 1
  })
})

Test('Studio binds render edits to their compiler-owned occurrence identity', async () => {
  await withStudioProject(async session => {
    session.registerPreview({ previewInstanceId: 'preview-occurrence' })
    const file = await session.readFile('Garden.tao')
    const selected = 'Text("Before")'
    const start = file.content.indexOf(selected)
    const renderId = `${FS.resolvePath(file.path, session.projectRoot)}:${start}:${start + selected.length}`
    const envelope = {
      action: { entry: ['width', 'max', 720], kind: 'set-layout-entry', renderId },
      channel: studioProtocolChannel,
      checkpoint: { id: 'occurrence-checkpoint', phase: 'single' },
      identity: {
        ...session.identity(),
        occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
        path: file.path,
        previewInstanceId: 'preview-occurrence',
        sourceVersion: file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'occurrence-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const

    const proposal = await session.proposeSourceAction(envelope)
    Expect(proposal.content).toContain('Text("Before") [width max 720]')

    await Expect(session.proposeSourceAction({
      ...envelope,
      identity: {
        ...envelope.identity,
        occurrence: { ...envelope.identity.occurrence, renderOwner: 'Card' },
      },
      requestId: 'wrong-owner',
    })).rejects.toMatchObject({ code: 'render-owner-mismatch' })
    await Expect(session.proposeSourceAction({
      ...envelope,
      identity: { ...envelope.identity, occurrence: { nodeKind: 'view', renderOwner: 'MainView' } },
      requestId: 'wrong-kind',
    })).rejects.toMatchObject({ code: 'node-kind-mismatch' })
    await Expect(session.proposeSourceAction({
      ...envelope,
      identity: { ...envelope.identity, occurrence: undefined },
      requestId: 'missing-occurrence',
    })).rejects.toThrow('requires render occurrence identity')

    const applied = await session.applySourceAction(envelope)
    Expect(applied.content).toBe(proposal.content)
  })
})

Test('Studio revalidates source-action proposals and undo against the exact current source', async () => {
  await withStudioProject(async (session, paths) => {
    session.registerPreview({ previewInstanceId: 'preview-revalidation' })
    const original = await session.readFile('Garden.tao')
    const envelope = {
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'revalidation-checkpoint', phase: 'single' },
      identity: {
        ...session.identity(),
        path: original.path,
        previewInstanceId: 'preview-revalidation',
        sourceVersion: original.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'revalidation-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const

    await session.proposeSourceAction(envelope)
    await FS.writeText(paths['Garden.tao'], original.content.replace('Before', 'Changed before apply'))
    await Expect(session.applySourceAction(envelope)).rejects.toMatchObject({ code: 'stale-source' })

    await FS.writeText(paths['Garden.tao'], original.content)
    const current = await session.readFile('Garden.tao')
    const applied = await session.applySourceAction({
      ...envelope,
      identity: { ...envelope.identity, sourceVersion: current.sourceVersion },
      requestId: 'revalidation-applied',
    })
    await FS.writeText(paths['Garden.tao'], applied.content.replace('Before', 'Changed before undo'))
    const incompatible = await session.readFile('Garden.tao')
    await Expect(session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: envelope.checkpoint.id,
      identity: { ...envelope.identity, sourceVersion: incompatible.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'revalidation-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })).rejects.toMatchObject({ code: 'stale-source' })
  })
})

Test('Studio rejects malformed occurrence identity before source-action preparation', async () => {
  await withStudioProject(async session => {
    const file = await session.readFile('Garden.tao')
    await Expect(session.applySourceAction({
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'malformed-occurrence', phase: 'single' },
      identity: {
        ...session.identity(),
        occurrence: { nodeKind: '' },
        path: file.path,
        previewInstanceId: 'malformed-preview',
        sourceVersion: file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'malformed-occurrence-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })).rejects.toThrow('Expected a valid Tao Studio source-action v2 envelope')
  })
})

Test('Studio inspects parser-owned current render clauses through a versioned file request', async () => {
  await withStudioProject(async session => {
    const file = await session.readFile('Garden.tao')
    const selected = 'Text("Before")'
    const start = file.content.indexOf(selected)
    const end = start + selected.length
    const inspection = await session.inspectRender({
      path: file.path,
      renderId: `${FS.resolvePath(file.path, session.projectRoot)}:${start}:${end}`,
      sourceVersion: file.sourceVersion,
    })

    Expect(inspection.renderId).toContain('Garden.tao')
    Expect(inspection.layoutEntries).toEqual([])
  })
})

// Canvas mode frames a focused view at the size its occurrence had, so the inspection of any element
// reports the owning view's root render and, for the cell that measured it, that render's rectangle.
Test('Studio reports the owning view root render and its measured rectangle to the selecting cell', async () => {
  await withStudioProject(async session => {
    const compiled = await session.compileInitial()
    const file = await session.readFile('Garden.tao')
    const selected = 'Text("Before")'
    const start = file.content.indexOf(selected)
    const renderId = `${FS.resolvePath(file.path, session.projectRoot)}:${start}:${start + selected.length}`
    const request = { path: file.path, renderId, sourceVersion: file.sourceVersion }

    const unmeasured = await session.inspectRender(request)
    Expect(unmeasured.owner?.view).toBe('MainView')
    Expect(unmeasured.owner?.renderId).toContain('Garden.tao')
    Expect(unmeasured.owner?.renderId).not.toBe(renderId)
    Expect(unmeasured.owner?.rect).toBeUndefined()

    const cell = {
      args: {},
      cellId: 'cell:phone',
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' as const },
        scheme: systemLightScheme(),
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
      scenarioId: 'Garden.phone',
      stateLayers: [],
    }
    const manifest = {
      capabilities: { captureDomains: [], scheme: 'reactive-browser' as const },
      cells: [cell],
      compileRevision: compiled.compileRevision,
      fixtures: [],
      generationDeclarations: [],
      manifestRevision: 'manifest-framed',
      parametersBySubject: { 'app:Garden': [] },
      project: { appName: session.appName, entryPath: 'Garden.tao', root: session.projectRoot },
      renders: [],
      scenarios: [{
        args: {},
        group: 'Garden',
        label: 'Garden phone',
        prepare: [],
        scenarioId: 'Garden.phone',
        source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
        stateLayers: [],
        subjectId: 'app:Garden',
      }],
      sourceVersions: { 'Garden.tao': file.sourceVersion },
      states: [],
      subjects: [{
        appName: 'Garden',
        kind: 'app' as const,
        source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
        subjectId: 'app:Garden',
      }],
      version: 2 as const,
    }
    session.setMatrixManifest(manifest)
    const identity = {
      ...StudioPreviewManifest.cellIdentity(manifest, cell),
      previewInstanceId: 'cell-preview-framed',
    }
    session.registerCellPreview(identity)
    session.recordPreviewLayoutMeasurements({
      channel: studioProtocolChannel,
      identity,
      measurements: [{
        elementName: 'Stack',
        rect: { height: 64, width: 390, x: 0, y: 0 },
        renderId: unmeasured.owner!.renderId,
      }],
      protocolVersion: studioProtocolVersion,
      type: 'preview-layout-measurements',
    })

    const measured = await session.inspectRender({ ...request, identity: { ...identity, ...file } })
    Expect(measured.owner?.rect).toEqual({ height: 64, width: 390, x: 0, y: 0 })

    // A cell that never measured, and a stale preview instance, both leave the frame at the device size.
    const otherInstance = await session.inspectRender({
      ...request,
      identity: { ...identity, ...file, previewInstanceId: 'cell-preview-gone' },
    })
    Expect(otherInstance.owner?.rect).toBeUndefined()
  })
})

Test('Studio resolves imported design provenance and disables cross-file design writes', async () => {
  await withTaoFiles('tao-studio-design-provenance-', {
    'Main.tao': `
      use Theme from ./Theme
      app Demo { view Main Design Theme }
      view Main() { render Surface() [body] }
      view Other() { render Surface() [body] }
      view Surface() { }
    `,
    'Theme.tao': 'public design Theme { ink #111 body [fg ink] }',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Main.tao'],
      projectRoot: root,
    })
    const file = await session.readFile('Main.tao')
    const designOwnerPath = await FS.realPath(paths['Theme.tao'])
    const source = file.content
    const selected = 'render Surface() [body]'
    const start = source.indexOf(selected)
    const inspection = await session.inspectRender({
      path: file.path,
      renderId: `${FS.resolvePath(file.path, session.projectRoot)}:${start}:${start + selected.length}`,
      sourceVersion: file.sourceVersion,
    })

    Expect(inspection.design).toEqual({
      editable: false,
      name: 'Theme',
      ownerPath: designOwnerPath,
      reason: 'Imported design values are read-only in this source file.',
    })
    Expect(inspection.styleProvenance[0]).toMatchObject({
      blastRadius: 2,
      editable: false,
      ownerPath: designOwnerPath,
    })
  })
})

Test('Studio promotes matrix arguments into the Tao-authored scenario through the source-action bus', async () => {
  await withStudioProject(async session => {
    const cell = await registerScenarioCell(session, 'scenario-preview')
    const applied = await session.applySourceAction({
      action: {
        arguments: {
          Owner: { handle: 'Lead', kind: 'fixture-reference' },
          Title: 'Saved from controls',
        },
        kind: 'set-scenario-arguments',
        scenarioGroupName: 'states',
        scenarioName: 'lead',
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'scenario-arguments', phase: 'single' },
      identity: {
        ...cell.identity,
        path: cell.file.path,
        previewInstanceId: 'scenario-preview',
        scenarioId: cell.scenarioId,
        sourceVersion: cell.file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'scenario-arguments-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })

    Expect(applied.content).toContain('render (Owner: Lead, Title: "Saved from controls")')
    Expect(applied.checkpoint.status).toBe('committed')
  })
})

Test('Studio proposes, applies, and undoes a recorded journey as one scenario checkpoint', async () => {
  await withStudioProject(async session => {
    const cell = await registerScenarioCell(session, 'journey-preview')
    const envelope = {
      action: {
        kind: 'append-scenario-steps',
        scenarioGroupName: 'states',
        scenarioName: 'lead',
        steps: [
          { kind: 'press', selector: 'tag', target: 'edit' },
          { kind: 'enter', selector: 'label', target: 'Title', value: 'Saved' },
          { kind: 'submit', selector: 'label', target: 'Title' },
        ],
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'scenario-journey', phase: 'single' },
      identity: {
        ...cell.identity,
        path: cell.file.path,
        previewInstanceId: 'journey-preview',
        scenarioId: cell.scenarioId,
        sourceVersion: cell.file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'scenario-journey-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const

    const proposed = await session.proposeSourceAction(envelope)
    Expect(proposed.diff).toContain('+      press #edit')
    Expect(await session.readFile(cell.file.path)).toMatchObject({ content: cell.file.content })

    const applied = await session.applySourceAction(envelope)
    Expect(applied.content).toContain([
      'press #edit',
      'enter "Saved" into label "Title"',
      'submit label "Title"',
    ].join('\n      '))
    Expect(applied.checkpoint).toEqual({ id: 'scenario-journey', status: 'committed' })

    const undone = await session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'scenario-journey',
      identity: { ...envelope.identity, sourceVersion: applied.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'scenario-journey-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })
    Expect(undone.content).toBe(cell.file.content)
  })
})

Test('Studio rejects a scenario action that names a different scenario than its cell identity', async () => {
  await withStudioProject(async session => {
    const cell = await registerScenarioCell(session, 'scenario-mismatch-preview')
    await Expect(session.proposeSourceAction({
      action: {
        arguments: { Title: 'Wrong target' },
        kind: 'set-scenario-arguments',
        scenarioGroupName: 'states',
        scenarioName: 'other',
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'scenario-mismatch', phase: 'single' },
      identity: {
        ...cell.identity,
        path: cell.file.path,
        previewInstanceId: 'scenario-mismatch-preview',
        scenarioId: cell.scenarioId,
        sourceVersion: cell.file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'scenario-mismatch-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })).rejects.toMatchObject({ code: 'scenario-action-mismatch' })
  })
})

Test('Studio checkpoints survive a refreshed preview for the same scenario cell', async () => {
  await withStudioProject(async session => {
    const registered = await registerScenarioCell(session, 'cell-checkpoint-before')
    const baseIdentity = {
      ...registered.identity,
      path: registered.file.path,
      previewInstanceId: 'cell-checkpoint-before',
      scenarioId: registered.scenarioId,
      sourceVersion: registered.file.sourceVersion,
    }
    const begun = await session.applySourceAction({
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'cell-checkpoint', phase: 'begin' },
      identity: baseIdentity,
      protocolVersion: studioProtocolVersion,
      requestId: 'cell-checkpoint-begin',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    session.registerCellPreview({
      ...registered.identity,
      previewInstanceId: 'cell-checkpoint-after',
    })
    const refreshedIdentity = {
      ...baseIdentity,
      previewInstanceId: 'cell-checkpoint-after',
      sourceVersion: begun.sourceVersion,
    }
    const committed = await session.applySourceAction({
      action: { component: 'Number', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'cell-checkpoint', phase: 'commit' },
      identity: refreshedIdentity,
      protocolVersion: studioProtocolVersion,
      requestId: 'cell-checkpoint-commit',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    const undone = await session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'cell-checkpoint',
      identity: { ...refreshedIdentity, sourceVersion: committed.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'cell-checkpoint-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })

    Expect(committed.content).toContain('Number(0)')
    Expect(undone.content).toBe(registered.file.content)
  })
})

Test('Studio saves a captured provider state as a named Tao fixture through the source-action bus', async () => {
  await withStudioProject(async session => {
    session.registerPreview({ previewInstanceId: 'capture-preview' })
    const file = await session.readFile('Garden.tao')
    const envelope = {
      action: {
        fixtureName: 'CapturedState',
        kind: 'insert-captured-fixture',
        plan: {
          accounts: [],
          creates: [{ entity: 'Account', fields: { Name: 'Captured' }, name: 'Account1' }],
        },
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'captured-fixture', phase: 'single' },
      identity: {
        ...session.identity(),
        path: file.path,
        previewInstanceId: 'capture-preview',
        sourceVersion: file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'captured-fixture-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const
    const proposal = await session.proposeSourceAction(envelope)

    Expect(proposal.diff).toContain('+++ Garden.tao (proposed)')
    Expect(proposal.diff).toContain('+fixture CapturedState')
    Expect(proposal.content).toContain('fixture CapturedState')
    Expect((await session.readFile('Garden.tao')).content).toBe(file.content)

    const applied = await session.applySourceAction(envelope)

    Expect(applied.content).toContain('fixture CapturedState')
    Expect(applied.content).toContain('Account1 = create Account {')
    Expect(applied.content).toContain('Name: "Captured"')
  })
})

Test('Studio source-action proposals anchor pure insertions as a valid unified diff hunk', () => {
  const diff = StudioProjectSession.testing.sourceActionProposalDiff(
    'Garden.tao',
    'first\nlast',
    'first\ninserted\nlast',
  )

  Expect(diff).toContain('@@ -1,0 +2,1 @@')
  Expect(diff).toContain('+inserted')
})

Test('Studio restores the original Tao source when a captured fixture fails compilation', async () => {
  let compileCount = 0
  await withStudioProject(async (session, paths) => {
    session.registerPreview({ previewInstanceId: 'capture-preview' })
    const original = await session.readFile('Garden.tao')
    const request = {
      action: {
        fixtureName: 'RejectedState',
        kind: 'insert-captured-fixture',
        plan: {
          accounts: [],
          creates: [{ entity: 'Account', fields: { Name: 'Rejected' }, name: 'Account1' }],
        },
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'rejected-fixture', phase: 'single' as const },
      identity: {
        ...session.identity(),
        path: original.path,
        previewInstanceId: 'capture-preview',
        sourceVersion: original.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'rejected-fixture-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action' as const,
    }

    await Expect(session.applySourceAction(request)).rejects.toThrow(
      'Studio did not save the fixture because its Tao source failed to compile',
    )
    Expect(await FS.readText(paths['Garden.tao'])).toBe(original.content)
    Expect(compileCount).toBe(2)

    const retried = await session.applySourceAction(request)
    Expect(retried.content).toContain('fixture RejectedState')
    Expect(compileCount).toBe(3)
  }, () => {
    compileCount += 1
    if (compileCount === 1) {
      Errors.throwUserInput('Injected fixture compilation failure.')
    }
  })
})

Test(
  'Studio proposes the exact capture diff without writing, then applies exactly that content and refuses a stale version',
  async () => {
    // verbatim: the diff below asserts exact line numbers and text, which indent-stripping would shift.
    await withTaoFiles('tao-studio-capture-diff-', {
      'Data.tao': 'folder data Accounts / Account { Name text }\n',
      'Garden.tao': 'app Garden {\n   view Main\n}\n\nview Main() {\n   render Text("Before")\n}\n',
    }, async (paths, root) => {
      const session = await StudioProjectSession.open({
        async compile() {},
        entryPath: paths['Garden.tao'],
        projectRoot: root,
      })
      session.registerPreview({ previewInstanceId: 'capture-diff-preview' })
      const original = await session.readFile('Garden.tao')
      const envelope = {
        action: {
          fixtureName: 'CapturedState',
          kind: 'insert-captured-fixture',
          plan: {
            accounts: [],
            creates: [{ entity: 'Account', fields: { Name: 'Captured' }, name: 'Account1' }],
          },
        },
        channel: studioProtocolChannel,
        checkpoint: { id: 'capture-diff', phase: 'single' },
        identity: {
          ...session.identity(),
          path: original.path,
          previewInstanceId: 'capture-diff-preview',
          sourceVersion: original.sourceVersion,
        },
        protocolVersion: studioProtocolVersion,
        requestId: 'capture-diff-request',
        sourceActionVersion: studioSourceActionVersion,
        type: 'source-action',
      } as const

      const proposal = await session.proposeSourceAction(envelope)

      // The diff is exactly the added fixture block: nothing about the file's existing lines changes.
      Expect(proposal.diff).toBe(
        [
          '--- Garden.tao',
          '+++ Garden.tao (proposed)',
          '@@ -8,0 +9,5 @@',
          '+fixture CapturedState {',
          '+   Account1 = create Account {',
          '+      Name: "Captured"',
          '+}  }',
          '+',
        ].join('\n'),
      )
      Expect(proposal.content).toBe(
        'app Garden {\n   view Main\n}\n\nview Main() {\n   render Text("Before")\n}\n'
          + '\nfixture CapturedState {\n   Account1 = create Account {\n      Name: "Captured"\n}  }\n',
      )
      Expect(await FS.readText(paths['Garden.tao'])).toBe(original.content)
      Expect((await session.readFile('Garden.tao')).content).toBe(original.content)

      const applied = await session.applySourceAction(envelope)

      Expect(applied.content).toBe(proposal.content)
      Expect(await FS.readText(paths['Garden.tao'])).toBe(proposal.content)

      await Expect(session.applySourceAction({
        ...envelope,
        requestId: 'capture-diff-stale-request',
      })).rejects.toMatchObject({ code: 'stale-source' })
      Expect(await FS.readText(paths['Garden.tao'])).toBe(proposal.content)
    }, { verbatim: true })
  },
)

Test('Studio groups a visual gesture into one checkpoint and undoes its exact current source', async () => {
  let compileCount = 0
  await withStudioProject(async session => {
    session.registerPreview({ previewInstanceId: 'preview-gesture' })
    const original = await session.readFile('Garden.tao')
    const identity = {
      ...session.identity(),
      path: original.path,
      previewInstanceId: 'preview-gesture',
      sourceVersion: original.sourceVersion,
    }
    await Expect(session.applySourceAction({
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'stale-preview-checkpoint', phase: 'single' },
      identity: { ...identity, previewInstanceId: 'stale-preview' },
      protocolVersion: studioProtocolVersion,
      requestId: 'stale-preview-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })).rejects.toMatchObject({ code: 'stale-preview' })
    const first = await session.applySourceAction({
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'gesture-1', phase: 'begin' },
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'gesture-request-1',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    session.registerPreview({ previewInstanceId: 'preview-gesture-refreshed' })
    const committed = await session.applySourceAction({
      action: { component: 'Number', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'gesture-1', phase: 'commit' },
      identity: {
        ...identity,
        path: FS.resolvePath(original.path, session.projectRoot),
        previewInstanceId: 'preview-gesture-refreshed',
        sourceVersion: first.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'gesture-request-2',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    await Expect(session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'gesture-1',
      identity: { ...identity, previewInstanceId: 'preview-gesture-refreshed' },
      protocolVersion: studioProtocolVersion,
      requestId: 'stale-version-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })).rejects.toBeInstanceOf(StudioSourceConflictError)
    const undone = await session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'gesture-1',
      identity: {
        ...identity,
        path: FS.resolvePath(original.path, session.projectRoot),
        previewInstanceId: 'preview-gesture-refreshed',
        sourceVersion: committed.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'gesture-undo-1',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })

    Expect(first.checkpoint.status).toBe('open')
    Expect(committed.checkpoint.status).toBe('committed')
    Expect(committed.content).toContain('Text("New text")')
    Expect(committed.content).toContain('Number(0)')
    Expect(undone.checkpoint).toEqual({ id: 'gesture-1', status: 'undone' })
    Expect(undone.content).toBe(original.content)
    Expect(await FS.readText(FS.resolvePath('Garden.tao', session.projectRoot))).toBe(original.content)
    Expect(compileCount).toBe(3)
  }, () => {
    compileCount += 1
  })
})

Test('Studio commits an abandoned visual gesture before accepting the next checkpoint', async () => {
  await withStudioProject(async session => {
    session.registerPreview({ previewInstanceId: 'preview-recovery' })
    const original = await session.readFile('Garden.tao')
    const identity = {
      ...session.identity(),
      path: original.path,
      previewInstanceId: 'preview-recovery',
      sourceVersion: original.sourceVersion,
    }
    const abandoned = await session.applySourceAction({
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'abandoned-gesture', phase: 'begin' },
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'abandoned-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    const next = await session.applySourceAction({
      action: { component: 'Number', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'next-action', phase: 'single' },
      identity: { ...identity, sourceVersion: abandoned.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'next-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })

    Expect(next.checkpoint).toEqual({ id: 'next-action', status: 'committed' })
    Expect(session.checkpoints().map(checkpoint => [checkpoint.id, checkpoint.status])).toEqual([
      ['abandoned-gesture', 'committed'],
      ['next-action', 'committed'],
    ])
  })
})

Test('Studio registers one preview instance and acknowledges only its compiled revision', async () => {
  await withStudioProject(async session => {
    session.registerPreview({ previewInstanceId: 'preview-1' })
    const compiled = await session.compileInitial()
    const message = {
      appliedRevision: compiled.compileRevision,
      channel: studioProtocolChannel,
      compileRevision: compiled.compileRevision,
      identity: {
        ...session.identity(),
        previewInstanceId: 'preview-1',
      },
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    }

    Expect(session.acknowledgePreview(message)).toBe(true)
    Expect(session.compileSnapshot().appliedRevision).toBe(compiled.compileRevision)
    Expect(session.acknowledgePreview({
      ...message,
      identity: { ...message.identity, previewInstanceId: 'stale-preview' },
    })).toBe(false)
    await Expect(Promise.resolve().then(() => session.registerPreview({ previewInstanceId: '' }))).rejects.toThrow(
      'cannot be empty',
    )
  })
})

Test('Studio project session exposes concurrent matrix cells and rejects stale reconfiguration', async () => {
  await withStudioProject(async session => {
    const compiled = await session.compileInitial()
    const cell = {
      args: {},
      cellId: 'cell:phone',
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' as const },
        scheme: systemLightScheme(),
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
      scenarioId: 'Garden.phone',
      stateLayers: [],
    }
    const manifest = {
      capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' as const },
      cells: [cell],
      compileRevision: compiled.compileRevision,
      fixtures: [{
        fixtureId: 'fixture:base',
        label: 'Base',
        plan: {},
        source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
      }],
      generationDeclarations: [],
      manifestRevision: 'manifest-1',
      parametersBySubject: { 'app:Garden': [] },
      project: {
        appName: session.appName,
        entryPath: 'Garden.tao',
        root: session.projectRoot,
      },
      renders: [{
        elementName: 'Text',
        renderId: `${session.projectRoot}/Garden.tao:1:2`,
        source: { kind: 'tao' as const, path: `${session.projectRoot}/Garden.tao`, range: { end: 2, start: 1 } },
        studioRectId: 'title',
      }],
      scenarios: [{
        args: {},
        fixtureId: 'fixture:base',
        group: 'Garden',
        label: 'Garden phone',
        prepare: [],
        scenarioId: 'Garden.phone',
        source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
        stateLayers: [],
        subjectId: 'app:Garden',
      }],
      sourceVersions: { 'Garden.tao': 'text-v1:test' },
      states: [],
      subjects: [{
        appName: 'Garden',
        kind: 'app' as const,
        source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
        subjectId: 'app:Garden',
      }],
      version: 2 as const,
    }
    session.setMatrixManifest(manifest)
    const identity = StudioPreviewManifest.cellIdentity(manifest, cell)
    const registered = session.registerCellPreview({ ...identity, previewInstanceId: 'cell-preview-1' })
    const layoutMessage = {
      channel: studioProtocolChannel,
      identity: { ...registered.identity, previewInstanceId: 'cell-preview-1' },
      measurements: [{
        elementName: 'Text',
        rect: { height: 30, width: 80, x: 12, y: 18 },
        renderId: `${session.projectRoot}/Garden.tao:1:2`,
        studioRectId: 'title',
      }],
      protocolVersion: studioProtocolVersion,
      type: 'preview-layout-measurements',
    } as const
    Expect(session.recordPreviewLayoutMeasurements(layoutMessage)).toEqual({ accepted: true })
    Expect(session.previewLayoutMeasurement(
      { ...registered.identity, previewInstanceId: 'cell-preview-1' },
      `${session.projectRoot}/Garden.tao:1:2`,
    )).toMatchObject({ studioRectId: 'title' })
    Expect(session.measuredUnsnapRect(
      { ...registered.identity, previewInstanceId: 'cell-preview-1' },
      `${session.projectRoot}/Garden.tao:1:2`,
      { height: 40, width: 60 },
    )).toEqual({ height: 30, id: 'title', kind: 'Text', width: 60, x: 0, y: 10 })
    // A clipped row may be zoomed in the viewport but must not become negative source-layout geometry.
    session.recordPreviewLayoutMeasurements({
      ...layoutMessage,
      measurements: [{
        ...layoutMessage.measurements[0],
        rect: { height: 30, width: 80, x: 12, y: -5 },
        viewportRect: { height: 30, width: 80, x: 12, y: -5 },
      }],
    })
    Expect(session.previewLayoutMeasurement(
      { ...registered.identity, previewInstanceId: 'cell-preview-1' },
      `${session.projectRoot}/Garden.tao:1:2`,
    )).toBeUndefined()
    session.recordPreviewLayoutMeasurements(layoutMessage)

    const file = await session.readFile('Garden.tao')
    const cellSourceAction = {
      action: { component: 'Text', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'cell-action', phase: 'single' },
      identity: {
        ...registered.identity,
        path: file.path,
        previewInstanceId: 'cell-preview-1',
        scenarioId: cell.scenarioId,
        sourceVersion: file.sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'cell-action-request',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    } as const
    await Expect(session.proposeSourceAction({
      ...cellSourceAction,
      identity: { ...cellSourceAction.identity, scenarioId: 'Garden.stale' },
    })).rejects.toMatchObject({ code: 'stale-scenario' })
    Expect((await session.proposeSourceAction(cellSourceAction)).content).toContain('Text("New text")')
    const applied = {
      appliedRevision: compiled.compileRevision,
      channel: studioProtocolChannel,
      compileRevision: compiled.compileRevision,
      identity: { ...registered.identity, previewInstanceId: 'cell-preview-1' },
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    }
    Expect(session.acknowledgePreview(applied)).toBe(true)
    Expect(session.compileSnapshot().appliedRevision).toBe(compiled.compileRevision)
    Expect(() =>
      session.acknowledgePreview({
        ...applied,
        identity: { ...applied.identity, previewInstanceId: 'stale-cell-preview' },
      })
    ).toThrow('no longer current')
    const replay = {
      capturedAt: 1_788_100_000_000,
      domains: [{ domain: 'data', value: { snapshots: {} }, version: 1 }],
      version: 1,
    }
    const next = session.reconfigureCell({
      ...identity,
      environment: {
        ...cell.environment,
        network: { latencyMs: 250, outcome: 'normal' },
      },
      replay,
    })
    session.registerCellPreview({ ...next.identity, previewInstanceId: 'cell-preview-2' })
    Expect(() => session.recordPreviewLayoutMeasurements(layoutMessage)).toThrow('stale configuration revision')
    const events: StudioSessionEvent[] = []
    const unsubscribe = session.subscribe(event => events.push(event))
    session.setMatrixManifest({
      ...manifest,
      cells: [{ ...cell, cellRevision: 0 }],
      compileRevision: compiled.compileRevision + 1,
      manifestRevision: 'manifest-2',
    })
    unsubscribe()
    const handshake = await session.handshake()
    Expect(registered.identity).toEqual(identity)
    Expect(next.identity.cellRevision).toBe(1)
    Expect(next.replay).toEqual(replay)
    Expect(handshake.previewManifest?.manifestRevision).toBe('manifest-2')
    Expect(() => session.previewCellInstance('cell-preview-2')).toThrow('no longer current')
    const refreshed = session.registerCellPreview({
      ...session.previewCell(cell.cellId).identity,
      previewInstanceId: 'cell-preview-3',
    })
    Expect(refreshed.identity).toMatchObject({
      cellRevision: 1,
      compileRevision: compiled.compileRevision + 1,
      manifestRevision: 'manifest-2',
    })
    Expect(refreshed.cell.environment.network.latencyMs).toBe(250)
    Expect(refreshed.replay).toBe(undefined)
    Expect(events.some(event => event.type === 'preview-manifest-changed')).toBe(true)
    Expect(handshake.capabilities.matrix).toEqual({
      concurrentCells: true,
      scheme: 'reactive-browser-fixed-light-native',
      version: 2,
    })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/preview/cell/reconfigure' })
    Expect(handshake.endpoints).toContainEqual({ method: 'GET', path: '/api/ai/availability' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/ai/fixture' })
    await Expect(
      Promise.resolve().then(() =>
        session.registerCellPreview({
          ...identity,
          previewInstanceId: 'stale-cell-preview',
        })
      ),
    ).rejects.toThrow('stale manifest revision')
  })
})

async function withStudioProject(
  use: (
    session: StudioProjectSession,
    paths: Record<'Garden.tao' | 'Support.tao', string>,
    root: string,
  ) => Promise<void>,
  onCompile: (request: {
    changes: readonly { path: string; sourceVersion?: string }[]
    compileRevision: number
  }) => void = () => {},
): Promise<void> {
  await withTaoFiles(
    'tao-studio-session-',
    {
      'Garden.tao': `
        data Accounts / Account { Name text }
        app Garden { view MainView }
        view MainView() {
          render Stack() {
            Text("Before")
          }
        }
        scene Card(Title text, Owner Account) { render Text(Title) }
        fixture Cards { Lead = create Account { Name: "Ada" } }
        scenarios Card "states" {
          fixture Cards
          device phone
          scenario "lead" {
            render (Title: "Old", Owner: Lead)
          }
        }
      `,
      'Support.tao': 'view Support() { }\n',
    },
    async (paths, root) => {
      const session = await StudioProjectSession.open({
        async compile(request) {
          onCompile(request)
        },
        entryPath: paths['Garden.tao'],
        projectRoot: root,
      })
      await use(session, paths, root)
    },
  )
}

async function registerScenarioCell(session: StudioProjectSession, previewInstanceId: string) {
  const compiled = await session.compileInitial()
  const file = await session.readFile('Garden.tao')
  const scenarioId = 'Card.states.lead'
  const cell = {
    args: {},
    cellId: 'cell:card:lead',
    cellRevision: 0,
    environment: {
      network: { latencyMs: 0, outcome: 'normal' as const },
      scheme: systemLightScheme(),
      viewport: { height: 844, presetId: 'phone', width: 390 },
    },
    scenarioId,
    stateLayers: [],
  }
  const manifest = {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' as const },
    cells: [cell],
    compileRevision: compiled.compileRevision,
    fixtures: [{
      fixtureId: 'fixture:Cards',
      label: 'Cards',
      plan: { accounts: [], creates: [] },
      source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: 10, start: 0 } },
    }],
    generationDeclarations: [],
    manifestRevision: `manifest:${previewInstanceId}`,
    parametersBySubject: { 'view:Card': [] },
    project: {
      appName: session.appName,
      entryPath: 'Garden.tao',
      root: session.projectRoot,
    },
    scenarios: [{
      args: {},
      fixtureId: 'fixture:Cards',
      group: 'states',
      label: 'lead',
      prepare: [],
      scenarioId,
      source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: file.content.length, start: 0 } },
      stateLayers: [],
      subjectId: 'view:Card',
    }],
    sourceVersions: { 'Garden.tao': file.sourceVersion },
    states: [],
    subjects: [{
      kind: 'view' as const,
      source: { kind: 'tao' as const, path: 'Garden.tao', range: { end: file.content.length, start: 0 } },
      subjectId: 'view:Card',
      viewName: 'Card',
    }],
    version: 2 as const,
  }
  session.setMatrixManifest(manifest)
  const identity = StudioPreviewManifest.cellIdentity(manifest, cell)
  session.registerCellPreview({ ...identity, previewInstanceId })
  return { cell, file, identity, manifest, scenarioId }
}

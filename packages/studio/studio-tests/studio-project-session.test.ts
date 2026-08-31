import { FS } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
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
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/design' })
    Expect(handshake.endpoints).toContainEqual({ method: 'WS', path: '/api/language/lsp' })
    Expect(handshake.endpoints).toContainEqual({ method: 'POST', path: '/api/language/highlight' })
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

    Expect(await session.inspectDesign({ path: file.path, sourceVersion: file.sourceVersion })).toEqual([
      { kind: 'token', name: 'ink', value: '#121826' },
      { entries: ['gap 8', 'fg ink'], kind: 'bundle', name: 'card' },
    ])
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

    const outside = await FS.mkTmpDir(FS.resolvePath('tao-studio-crud-outside-', FS.tmpdir()))
    await FS.symlink(outside, FS.resolvePath('Linked', root))
    try {
      await Expect(session.createFile({ path: 'Linked/Escaped.tao', writeId: 'symlink-create' }))
        .rejects.toThrow('outside the project')
    } finally {
      await FS.remove(outside)
    }
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
      throw new Error('listener failed')
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
    } finally {
      unsubscribe()
    }
  }, () => {
    compileCount += 1
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
    session.registerPreview({ previewInstanceId: 'scenario-preview' })
    const file = await session.readFile('Garden.tao')
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
        ...session.identity(),
        path: file.path,
        previewInstanceId: 'scenario-preview',
        sourceVersion: file.sourceVersion,
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
      throw new Error('Injected fixture compilation failure.')
    }
  })
})

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
    })).rejects.toThrow('stale preview instance')
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
    const committed = await session.applySourceAction({
      action: { component: 'Number', kind: 'insert-component' },
      channel: studioProtocolChannel,
      checkpoint: { id: 'gesture-1', phase: 'commit' },
      identity: { ...identity, sourceVersion: first.sourceVersion },
      protocolVersion: studioProtocolVersion,
      requestId: 'gesture-request-2',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    })
    await Expect(session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'gesture-1',
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'stale-version-undo',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    })).rejects.toBeInstanceOf(StudioSourceConflictError)
    const undone = await session.undoSourceAction({
      channel: studioProtocolChannel,
      checkpointId: 'gesture-1',
      identity: { ...identity, sourceVersion: committed.sourceVersion },
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
    const cell = {
      args: {},
      cellId: 'cell:phone',
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' as const },
        scheme: { requested: 'light' as const, status: 'inert' as const },
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
      scenarioId: 'Garden.phone',
      stateLayers: [],
    }
    const manifest = {
      capabilities: { captureDomains: ['data'], scheme: 'inert' as const },
      cells: [cell],
      compileRevision: 0,
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
    const events: StudioSessionEvent[] = []
    const unsubscribe = session.subscribe(event => events.push(event))
    session.setMatrixManifest({
      ...manifest,
      cells: [{ ...cell, cellRevision: 0 }],
      compileRevision: 1,
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
      compileRevision: 1,
      manifestRevision: 'manifest-2',
    })
    Expect(refreshed.cell.environment.network.latencyMs).toBe(250)
    Expect(refreshed.replay).toBe(undefined)
    Expect(events.some(event => event.type === 'preview-manifest-changed')).toBe(true)
    Expect(handshake.capabilities.matrix).toEqual({ concurrentCells: true, scheme: 'inert', version: 2 })
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
        view Card(Title text, Owner Account) { render Text(Title) }
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

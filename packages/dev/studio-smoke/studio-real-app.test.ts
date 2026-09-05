import { FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  StudioInspector,
} from '@studio'

Test('Studio compiles, visually edits, and undoes the real HNReader app', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/real-app', Repo.getRoot())
  const projectRoot = await mkTestDir('tao-studio-hnreader-')
  const previewRuntimeRoot = FS.resolvePath('runtime', artifactRoot)
  await FS.remove(previewRuntimeRoot)
  await FS.copyDirectory(Repo.resolvePath('Apps/HNReader'), projectRoot)

  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  try {
    preview = await openStudioPreviewSession({
      appName: 'HNReaderStub',
      entryPath: FS.resolvePath('HNReader.tao', projectRoot),
      previewRuntimeRoot,
      projectRoot,
    })
    preview.session.registerPreview({ previewInstanceId: 'real-app-preview' })
    const initialCompile = await preview.session.compileInitial()
    const initial = await preview.session.readFile('HNReader.tao')
    const identity = {
      ...preview.session.identity(),
      path: initial.path,
      previewInstanceId: 'real-app-preview',
      sourceVersion: initial.sourceVersion,
    }
    const applied = await preview.session.applySourceAction(StudioInspector.singleAction({
      action: { component: 'Text', kind: 'insert-component' },
      checkpointId: 'real-app-visual-edit',
      identity,
      requestId: 'real-app-insert-text',
    }))
    const undone = await preview.session.undoSourceAction(StudioInspector.undo({
      checkpointId: 'real-app-visual-edit',
      identity: { ...identity, sourceVersion: applied.sourceVersion },
      requestId: 'real-app-undo',
    }))
    const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
    const stableRoot = await FS.readText(FS.resolvePath('App.tsx', generatedRoot))
    const project = await FS.readText(FS.resolvePath('TaoStudioProject.ts', generatedRoot))
    const revision = await FS.readText(FS.resolvePath('TaoStudioRevision.ts', generatedRoot))

    Expect(initialCompile.status).toBe('compiled')
    Expect(initialCompile.compileRevision).toBe(1)
    Expect(applied.compile.compileRevision).toBe(2)
    Expect(applied.content).toContain('Text("New text")')
    Expect(undone.compile.compileRevision).toBe(3)
    Expect(undone.content).toBe(initial.content)
    Expect(await FS.readText(FS.resolvePath('HNReader.tao', projectRoot))).toBe(initial.content)
    Expect(stableRoot).toContain('TR.Studio.PreviewBridge')
    Expect(project).toContain('"appName":"HNReaderStub"')
    Expect(revision).toContain('"compileRevision":3')
    Expect(revision).toContain(FS.resolvePath('HNReader.tao', projectRoot))
    Expect(revision).toContain(initial.sourceVersion)
  } finally {
    await preview?.close()
    await FS.remove(projectRoot)
  }
}, 120_000)

import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

Test('Studio preview session resolves a package created after its first compile', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-new-package-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-new-package-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-garden-new-package" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Garden") }
        `,
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        try {
          const initial = await preview.session.compileInitial()
          if (initial.status !== 'compiled') {
            Errors.throwUnexpected(initial.message)
          }
          // The preview reuses its workspace between compiles, and a workspace indexes `@` packages
          // when it opens; one created later must still resolve.
          const dataPath = FS.resolvePath('@model/Data.tao', root)
          await FS.mkdir(FS.dirname(dataPath))
          await FS.writeText(dataPath, 'public data Plants / Plant { Name text }\n')
          await preview.session.noteWatchChanges([{ path: dataPath }])
          const file = await preview.session.readFile('Garden.tao')
          const saved = await preview.session.syncDraft({
            content: `use Plant from @model\n${file.content}\nfixture Seed { Fern = create Plant { Name: "Fern" } }\n`,
            path: file.path,
            sourceVersion: file.sourceVersion,
            writeId: 'use-new-package',
          })
          if (saved.compile?.status !== 'compiled') {
            Errors.throwUnexpected(`Draft using the new package did not compile: ${saved.compile?.message}`)
          }
          Expect(saved.compile.status).toBe('compiled')
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio preview session keeps design and consumer source epochs distinct across edits and a revert', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-design-epochs-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-design-epochs-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          use StackNav from @tao/nav
          use Theme from ./Theme
          app Garden { id "tao-studio-garden-design-epochs" version "1.0.0" name "Garden" Navigator StackNav { Initial Main } Design Theme }
          scene Main() { Title "Main" render Text("Before") [title] }
        `,
        'Theme.tao': 'public design Theme { ink #111 title [fg ink] }\n',
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
        const generatedConsumer = () => FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))
        const generatedDesign = () => FS.readText(FS.resolvePath('modules/Theme.tao.tsx', generatedRoot))
        try {
          const initial = await preview.session.compileInitial()
          if (initial.status !== 'compiled') {
            Errors.throwUnexpected(initial.message)
          }
          Expect(initial.compileRevision).toBe(1)
          const initialConsumer = await generatedConsumer()
          const initialDesign = await generatedDesign()
          Expect(initialConsumer).toContain('Before')
          Expect(initialConsumer).toContain('const __tao_design_cohort__ = TR.Design.Cohort({')
          Expect(initialDesign).toContain('"ink": "#111"')
          const initialDesignMetadata = emittedDesignDeclarationMetadata(initialDesign)
          Expect(initialDesignMetadata.path).toBe(paths['Theme.tao'])
          Expect(initialDesignMetadata.epoch).toBe(1)
          Expect(initialDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(1)
          const initialRenderSource = emittedRenderDesignSource(initialConsumer, paths['Garden.tao'])
          Expect(initialRenderSource.epoch).toBe(1)
          Expect(initialRenderSource.designEpochs[paths['Theme.tao']]).toBe(1)

          const consumer = await preview.session.readFile('Garden.tao')
          const consumerEdit = await preview.session.syncDraft({
            content: consumer.content.replace('Before', 'After'),
            path: consumer.path,
            sourceVersion: consumer.sourceVersion,
            writeId: 'change-consumer',
          })
          Expect(consumerEdit.saved).toBe(true)
          Expect(consumerEdit.compile?.compileRevision).toBe(2)
          const changedConsumer = await generatedConsumer()
          const unchangedDesign = await generatedDesign()
          Expect(changedConsumer).toContain('After')
          Expect(changedConsumer).not.toBe(initialConsumer)
          Expect(unchangedDesign).toBe(initialDesign)
          const changedRenderSource = emittedRenderDesignSource(changedConsumer, paths['Garden.tao'])
          Expect(changedRenderSource.epoch).toBe(2)
          Expect(changedRenderSource.designEpochs[paths['Theme.tao']]).toBe(1)

          const design = await preview.session.readFile('Theme.tao')
          const designEdit = await preview.session.syncDraft({
            content: design.content.replace('#111', '#222'),
            path: design.path,
            sourceVersion: design.sourceVersion,
            writeId: 'change-design',
          })
          Expect(designEdit.saved).toBe(true)
          Expect(designEdit.compile?.compileRevision).toBe(3)
          const changedDesign = await generatedDesign()
          Expect(await generatedConsumer()).toBe(changedConsumer)
          Expect(changedDesign).toContain('"ink": "#222"')
          Expect(changedDesign).not.toBe(initialDesign)
          const changedDesignMetadata = emittedDesignDeclarationMetadata(changedDesign)
          Expect(changedDesignMetadata.epoch).toBe(3)
          Expect(changedDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(2)

          const reverted = await preview.session.syncDraft({
            content: design.content,
            path: designEdit.file.path,
            sourceVersion: designEdit.file.sourceVersion,
            writeId: 'revert-design',
          })
          Expect(reverted.saved).toBe(true)
          Expect(reverted.compile?.compileRevision).toBe(4)
          Expect(reverted.file.sourceVersion).toBe(design.sourceVersion)
          const revertedDesign = await generatedDesign()
          Expect(revertedDesign).toContain('"ink": "#111"')
          Expect(revertedDesign).not.toBe(initialDesign)
          Expect(await generatedConsumer()).toBe(changedConsumer)
          const revertedDesignMetadata = emittedDesignDeclarationMetadata(revertedDesign)
          Expect(revertedDesignMetadata.epoch).toBe(4)
          Expect(revertedDesignMetadata.epoch).toBeGreaterThan(initialDesignMetadata.epoch)
          Expect(revertedDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(2)
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

function emittedDesignDeclarationMetadata(code: string): {
  path: string
  epoch: number
  sourceEpochs: Record<string, number>
} {
  const match = code.match(
    /TR\.Design\.Declaration\([\s\S]*?,\s*\{\s*path:\s*("(?:\\.|[^"\\])*"),\s*epoch:\s*(\d+),\s*sourceEpochs:\s*(\{[^}]*\})/u,
  )
  if (match === null) {
    Errors.throwUnexpected('Expected generated Design declaration source metadata.')
  }
  return { path: JSON.parse(match[1]!), epoch: Number(match[2]), sourceEpochs: JSON.parse(match[3]!) }
}

function emittedRenderDesignSource(code: string, sourcePath: string): {
  epoch: number
  designEpochs: Record<string, number>
} {
  const sources = code.matchAll(
    /path:\s*("(?:\\.|[^"\\])*"),\s*cohort:\s*__tao_design_cohort__,\s*epoch:\s*(\d+),\s*designEpochs:\s*(\{[^}]*\})/gu,
  )
  const match = [...sources].find(source => JSON.parse(source[1]!) === sourcePath)
  if (match === undefined) {
    Errors.throwUnexpected(`Expected generated render Design source metadata for ${sourcePath}.`)
  }
  return { epoch: Number(match[2]), designEpochs: JSON.parse(match[3]!) }
}

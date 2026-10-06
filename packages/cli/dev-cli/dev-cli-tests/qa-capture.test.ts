import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { QaCapture } from '../dev-cli-src/qa/QaCapture'

async function review(artifactRoot: string, statuses: string[]): Promise<{ manifestPath: string }> {
  const manifestPath = FS.resolvePath('manifest.json', artifactRoot)
  await FS.writeJson(manifestPath, {
    cells: statuses.map((status, index) => ({
      key: `cell-${index}`,
      group: 'views',
      label: `cell ${index}`,
      status,
      screenshot: `cell-${index}.png`,
      sha256: 'a'.repeat(64),
    })),
  })
  return { manifestPath }
}

Describe('isolated QA capture', () => {
  Test(
    'captures an owned snapshot with source hashes and never creates runtime state in the original project',
    async () => {
      const root = await mkTestDir('qa-capture-')
      const original = FS.resolvePath('app', root)
      await FS.writeText(FS.resolvePath('App.tao', original), 'use Text from @tao/ui\n')
      await FS.writeText(FS.resolvePath('Nested/View.tao', original), 'use App from ..\n')
      await FS.writeText(FS.resolvePath('.tao/sessions/existing.json', original), 'existing original session')
      await FS.writeText(FS.resolvePath('node_modules/vendor.js', original), 'vendor must not be copied')
      await FS.writeText(FS.resolvePath('secrets/token.json', original), '{"path":"../outside"}')
      await FS.writeText(FS.resolvePath('credentials/account.json', original), '{"path":"../outside"}')
      await FS.writeText(FS.resolvePath('App.tao.ts', original), 'import type TR from "../../runtime/TR"\n')
      const capture = new QaCapture(root, async (staged, options) => {
        Expect(staged).not.toBe(original)
        Expect(await FS.isDirectory(FS.resolvePath('.tao', staged))).toBe(true)
        Expect(await FS.listDir(FS.resolvePath('.tao', staged))).toEqual([])
        Expect(await FS.exists(FS.resolvePath('node_modules', staged))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('secrets', staged))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('credentials', staged))).toBe(false)
        Expect(await FS.readText(FS.resolvePath('Nested/View.tao', staged))).toBe('use App from ..\n')
        await FS.writeText(FS.resolvePath('.tao/sessions/capture.json', staged), 'capture side effect')
        return await review(options.artifactRoot, ['captured'])
      })
      await capture.run('app', { app: 'App', output: '.artifacts/capture' })
      Expect(await FS.readText(FS.resolvePath('App.tao', original))).toBe('use Text from @tao/ui\n')
      Expect(await FS.listDir(FS.resolvePath('.tao/sessions', original))).toEqual(['existing.json'])
      const receipt = await FS.readJson<
        { originalProject: string; status: string; files: { path: string; sha256: string }[] }
      >(FS.resolvePath('.artifacts/capture/source-snapshot.json', root))
      Expect(receipt.originalProject).toBe(await FS.realPath(original))
      Expect(receipt.status).toBe('complete')
      Expect(receipt.files.map(file => file.path)).toEqual(['App.tao', 'Nested/View.tao'])
      Expect(receipt.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/u)
    },
  )

  Test(
    'a capture that finishes with a failed cell, or without a manifest, is partial rather than complete',
    async () => {
      const root = await mkTestDir('qa-capture-partial-')
      await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Text from @tao/ui\n')
      await new QaCapture(root, async (_, options) => await review(options.artifactRoot, ['captured', 'failed']))
        .run('app', { app: 'App', output: '.artifacts/partial' })
      const receipt = await FS.readJson<{ status: string; cells: Record<string, string>[] }>(
        FS.resolvePath('.artifacts/partial/source-snapshot.json', root),
      )
      Expect(receipt.status).toBe('partial')
      Expect(receipt.cells[0]).toEqual({
        key: 'cell-0',
        group: 'views',
        label: 'cell 0',
        status: 'captured',
        screenshot: 'cell-0.png',
        sha256: 'a'.repeat(64),
      })
      Expect(receipt.cells.map(cell => cell['status'])).toEqual(['captured', 'failed'])
      await new QaCapture(root, async () => ({})).run('app', { app: 'App', output: '.artifacts/unattested' })
      Expect(
        (await FS.readJson<{ status: string }>(FS.resolvePath('.artifacts/unattested/source-snapshot.json', root)))
          .status,
      ).toBe('partial')
    },
  )

  Test('retains the failed snapshot and blocks imports outside the project before launching capture', async () => {
    const root = await mkTestDir('qa-capture-blocked-')
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Shared from ../shared\n')
    let launches = 0
    const capture = new QaCapture(root, async () => {
      launches += 1
    })
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/blocked' })).rejects.toThrow(
      'QA capture was blocked',
    )
    Expect(launches).toBe(0)
    const scratch = FS.resolvePath('.artifacts/scratch/qa-capture', root)
    const ids = await FS.listDir(scratch)
    const receipt = await FS.readJson<{ status: string; error: string }>(
      FS.resolvePath(`${ids[0]}/snapshot.json`, scratch),
    )
    Expect(receipt.status).toBe('blocked')
    Expect(receipt.error).toContain('Move the referenced source inside the project')
    Expect(await FS.exists(FS.resolvePath('app/.tao', root))).toBe(false)
    const outside = await mkTestDir('qa-capture-outside-')
    await Expect(capture.run(outside, { app: 'App', output: '.artifacts/outside' })).rejects.toThrow(
      'inside this checkout',
    )
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Text from @tao/ui\n')
    await FS.symlink(outside, FS.resolvePath('app/Linked', root))
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/symlink' })).rejects.toThrow(
      'QA capture was blocked',
    )
    Expect(launches).toBe(0)
  })

  Test('a capture failure after writing session state leaves only the owned snapshot dirty', async () => {
    const root = await mkTestDir('qa-capture-failure-')
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Text from @tao/ui\n')
    const capture = new QaCapture(root, async staged => {
      await FS.writeText(FS.resolvePath('.tao/sessions/failed.json', staged), 'owned failed session')
      Errors.throwHostEnvironment('Capture did not reach a ready scenario.')
    })
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/failed' })).rejects.toThrow(
      'QA capture was blocked',
    )
    Expect(await FS.listDir(FS.resolvePath('app', root))).toEqual(['App.tao'])
  })

  Test(
    'blocks package, implementation, expression, multiline and injected script references before capture',
    async () => {
      const root = await mkTestDir('qa-capture-references-')
      const samples = [
        'use package ../shared as shared',
        'use Main from ..',
        'use package .. as parent',
        'use Main from /* note */ ../outside',
        'use /* note */ package ../outside',
        'project {} use Foo from ../shared',
        'use Foo,\n Bar\n from ../shared',
        'provider Local from ../Local.ts',
        'nav StackNav from ../Nav.ts',
        'value Bridge = Value from ../bridge.ts',
        'inject ```ts\nimport value from "../bridge.ts"\n```',
        'inject ```ts\nconst value = require("../bridge.ts")\n```',
        'inject ```ts\nconst value = import("../bridge.ts")\n```',
        'inject ```ts\nconst value = import(`../bridge.ts`)\n```',
        'inject ```ts\nconst value = require(`../bridge.ts`)\n```',
        'inject ```ts\nconst value = import("./" + "../outside.js")\n```',
        'inject ```ts\nconst value = require("./" + "../outside.js")\n```',
        'inject ```ts\nconst value = require /* note */ ("../outside.js")\n```',
        'inject ```ts\nconst value = import /* note */ ("../outside.js")\n```',
        'inject ```ts\nimport value from "@tao/../../outside"\n```',
        'inject ```ts\nimport value from "@/../outside"\n```',
      ]
      let launches = 0
      const capture = new QaCapture(root, async () => {
        launches += 1
      })
      for (const [index, source] of samples.entries()) {
        await FS.writeText(FS.resolvePath('app/App.tao', root), source)
        await Expect(capture.run('app', { app: 'App', output: `.artifacts/blocked-${index}` })).rejects.toThrow(
          'QA capture was blocked',
        )
        Expect(launches).toBe(0)
        Expect(await FS.readText(FS.resolvePath('app/App.tao', root))).toBe(source)
      }
    },
  )

  Test('admits Tao package references only to package directories staged with the project', async () => {
    const root = await mkTestDir('qa-capture-packages-')
    await FS.writeText(FS.resolvePath('app/@model/Data.tao', root), 'workspace\ndata Item {}\n')
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Item from @model\n')
    let staged = ''
    const capture = new QaCapture(root, async project => {
      staged = project
    })
    await capture.run('app', { app: 'App', output: '.artifacts/packaged' })
    Expect(await FS.readText(FS.resolvePath('@model/Data.tao', staged))).toBe('workspace\ndata Item {}\n')
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Item from @elsewhere\n')
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/unstaged' })).rejects.toThrow(
      'QA capture was blocked',
    )
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'inject ```ts\nimport value from "@model"\n```')
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/script' })).rejects.toThrow(
      'QA capture was blocked',
    )
    await FS.writeText(FS.resolvePath('app/App.tao', root), 'use Item from @model\n')
    await FS.writeText(FS.resolvePath('app/tsconfig.json', root), '{ "extends": "/tmp/base.json" }\n')
    await Expect(capture.run('app', { app: 'App', output: '.artifacts/absolute-json' })).rejects.toThrow(
      'QA capture was blocked',
    )
  })

  Test('rejects scratch ancestors before making any output or staging directories', async () => {
    const root = await mkTestDir('qa-capture-overlap-')
    await FS.writeText(FS.resolvePath('.artifacts/scratch/App.tao', root), 'use Text from @tao/ui\n')
    let launches = 0
    const capture = new QaCapture(root, async () => {
      launches += 1
    })
    await Expect(capture.run('.artifacts/scratch', { app: 'App', output: '.artifacts/new-parent/output' })).rejects
      .toThrow('source contains its scratch directory')
    Expect(await FS.listDir(FS.resolvePath('.artifacts/scratch', root))).toEqual(['App.tao'])
    Expect(await FS.exists(FS.resolvePath('.artifacts/new-parent', root))).toBe(false)
    await FS.mkdir(FS.resolvePath('.artifacts/scratch/qa-capture', root))
    await Expect(capture.run('.artifacts/scratch/qa-capture', { app: 'App', output: '.artifacts/new-parent/output' }))
      .rejects.toThrow('source contains its scratch directory')
    Expect(await FS.listDir(FS.resolvePath('.artifacts/scratch/qa-capture', root))).toEqual([])
    Expect(launches).toBe(0)
  })
})

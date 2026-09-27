import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { BuildRecord } from '../cli-src/build-command'

Describe('native watch build CLI', () => {
  Test('retains Swift source and an independently buildable Xcode snapshot without Expo output', async () => {
    const output = Repo.resolvePath(`.artifacts/watch-build-test-${Platform.randomUUID()}`)
    try {
      for (const compileOnly of [true, false]) {
        const result = await CLI.run('./tao', {
          args: [
            'build',
            'Apps/WatchHello',
            '--watchos',
            '--output',
            output,
            ...(compileOnly ? ['--compile-only'] : []),
          ],
          cwd: Repo.getRoot(),
          processPolicy: 'test',
          timeoutMs: 60_000,
        })
        Expect({ stderr: result.stderr, stdout: result.stdout, exitCode: result.exitCode }).toMatchObject({
          exitCode: 0,
        })
        const records = await Promise.all(
          (await FS.listDir(output)).map(id => FS.readJson<BuildRecord>(FS.resolvePath(`${id}/build.json`, output))),
        )
        const record = records.find(value => value.mode === (compileOnly ? 'compile-only' : 'artifact'))!
        Expect(record.results.watchos?.status).toBe('succeeded')
        Expect(record.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
        const watch = FS.resolvePath(`${record.id}/${compileOnly ? 'compiled/watchos' : 'watchos'}`, output)
        const sources = compileOnly ? watch : FS.resolvePath('Sources', watch)
        Expect(await FS.isFile(FS.resolvePath('WatchApp.swift', sources))).toBe(true)
        Expect(await FS.isFile(FS.resolvePath('TaoValues.swift', sources))).toBe(true)
        Expect(await FS.exists(FS.resolvePath('site', watch))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('_gen_tao-app', watch))).toBe(false)
        Expect(await FS.isFile(FS.resolvePath('TaoWatch.xcodeproj/project.pbxproj', watch))).toBe(!compileOnly)
        if (!compileOnly) {
          Expect(await FS.readText(FS.resolvePath('en.lproj/InfoPlist.strings', watch))).toContain(
            'CFBundleDisplayName = "Rep Counter";',
          )
        }
      }
    } finally {
      await FS.remove(output)
    }
  }, 120_000)
})

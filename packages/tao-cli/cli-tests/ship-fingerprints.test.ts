import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { dataSchemaFingerprint, runtimeFingerprint } from '../cli-src/ship-fingerprints'

Describe('tao ship compatibility fingerprints', () => {
  Test('keeps the data fingerprint stable for copy changes and changes it for schema changes', async () => {
    await withTaoFiles('tao-ship-fingerprint-', {
      'App.tao': `data Notes / Note { Body text }\nview Main() { render Text { Value "one" } }`,
    }, async paths => {
      const root = FS.dirname(paths['App.tao']!)
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(
        paths['App.tao']!,
        `data Notes / Note { Body text }\nview Main() { render Text { Value "two" } }`,
      )
      Expect(await dataSchemaFingerprint(root)).toBe(before)
      await FS.writeText(paths['App.tao']!, `data Notes / Note { Body text Pinned boolean }\nview Main() { }`)
      Expect(await dataSchemaFingerprint(root)).not.toBe(before)
    })
  })

  Test('reads Expo fingerprint output through an injected command runner', async () => {
    const runtimeRoot = await mkTestDir('tao-runtime-fingerprint-')
    await FS.writeJson(FS.resolvePath('_gen_tao-app/ship.json', runtimeRoot), { buildNumber: 'stale' })
    const seen: string[] = []
    const fingerprint = await runtimeFingerprint(runtimeRoot, async (command, spec) => {
      seen.push(`${command} ${spec?.args?.join(' ')}`)
      return {
        args: [...(spec?.args ?? [])],
        command,
        cwd: spec?.cwd,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: '{"hash":"native-hash","sources":[]}',
      }
    })
    Expect(fingerprint).toBe('native-hash')
    Expect(seen).toEqual([`${runtimeRoot}/node_modules/.bin/fingerprint fingerprint:generate --platform ios`])
    Expect(await FS.exists(FS.resolvePath('_gen_tao-app/ship.json', runtimeRoot))).toBe(false)
  })
})

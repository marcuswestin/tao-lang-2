import { Errors, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { publishAccountServerReadiness } from '../account-server-src/AccountServerReadiness'

Describe('Account server readiness publication', () => {
  Test('keeps partially written JSON private until complete, including replacement of an existing record', async () => {
    const root = await mkTestDir('account-readiness-')
    const ready = FS.resolvePath('ready.json', root)
    const previous = { url: 'http://127.0.0.1:10001', resource: 'previous' }
    const next = { url: 'http://127.0.0.1:10002', resource: 'next' }
    try {
      for (const replacing of [false, true]) {
        if (replacing) {
          await FS.writeJson(ready, previous)
        }
        const release = Deferred()
        let writing: string | undefined
        const publication = publishAccountServerReadiness(ready, next, async (path, content) => {
          await FS.writeText(path, '{"url":')
          writing = path
          await release.promise
          await FS.writeJson(path, content)
        })
        try {
          await until(() => writing !== undefined, { description: 'partial readiness write' })
          Expect(await FS.readText(writing!)).toBe('{"url":')
          if (replacing) {
            Expect(await FS.readJson(ready)).toEqual(previous)
          } else {
            Expect(await FS.exists(ready)).toBe(false)
          }
        } finally {
          release.resolve()
          await publication
        }
        Expect(await FS.readJson(ready)).toEqual(next)
        Expect(await FS.listDir(root)).toEqual(['ready.json'])
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves the previous record and removes staging after a failed write', async () => {
    const root = await mkTestDir('account-readiness-')
    const ready = FS.resolvePath('ready.json', root)
    try {
      const previous = { url: 'http://127.0.0.1:10001' }
      await FS.writeJson(ready, previous)
      await Expect(publishAccountServerReadiness(ready, { url: 'http://127.0.0.1:10002' }, async path => {
        await FS.writeText(path, '{')
        Errors.throwHostEnvironment('Controlled readiness write failure')
      })).rejects.toThrow('Controlled readiness write failure')
      Expect(await FS.readJson(ready)).toEqual(previous)
      Expect(await FS.listDir(root)).toEqual(['ready.json'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('removes staging after a failed rename without deleting the destination', async () => {
    const root = await mkTestDir('account-readiness-')
    const ready = FS.resolvePath('ready.json', root)
    try {
      await FS.writeText(FS.resolvePath('sentinel', ready), 'keep')
      await Expect(publishAccountServerReadiness(ready, { url: 'http://127.0.0.1:10002' })).rejects.toThrow()
      Expect(await FS.readText(FS.resolvePath('sentinel', ready))).toBe('keep')
      Expect(await FS.listDir(root)).toEqual(['ready.json'])
    } finally {
      await FS.remove(root)
    }
  })
})

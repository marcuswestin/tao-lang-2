import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { dataSchemaFingerprint, runtimeFingerprint } from '../cli-src/ship-fingerprints'

Describe('tao ship compatibility fingerprints', () => {
  Test('keeps the data fingerprint stable for copy changes and changes it for schema changes', async () => {
    await withTaoFiles('tao-ship-fingerprint-', {
      'App.tao': `data Notes / Note { Body text }\nview Main() { render Text("one") }`,
    }, async paths => {
      const root = FS.dirname(paths['App.tao']!)
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(
        paths['App.tao']!,
        `data Notes / Note { Body text }\nview Main() { render Text("two") }`,
      )
      Expect(await dataSchemaFingerprint(root)).toBe(before)
      await FS.writeText(paths['App.tao']!, `data Notes / Note { Body text, Pinned boolean }\nview Main() { }`)
      Expect(await dataSchemaFingerprint(root)).not.toBe(before)
    })
  })

  Test('hashes canonical schema semantics instead of comments, whitespace, or trait order', async () => {
    await withTaoFiles('tao-ship-semantic-fingerprint-', {
      'App.tao': `data Notes / Note {
        Title text (title, unique),
        Body text? (search, default ""),

        index Title,
        order by Title desc
      }`,
    }, async paths => {
      const root = FS.dirname(paths['App.tao']!)
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(
        paths['App.tao']!,
        `
        // Formatting and trait order do not change the stored schema.
        data   Notes/Note{Body text ? (default "",search), Title text(unique,title),
          index Title,
          order by Title desc
        }
      `,
      )

      Expect(await dataSchemaFingerprint(root)).toBe(before)
      await FS.move(paths['App.tao']!, FS.resolvePath('Model.tao', root))
      Expect(await dataSchemaFingerprint(root)).toBe(before)
    })
  })

  Test('changes the fingerprint when explicit relation or value types change', async () => {
    await withTaoFiles('tao-ship-typed-fingerprint-', {
      'App.tao': `
        type Role is one of Admin, Member
        type Status is one of Open, Closed
        data Accounts / Account { Name text }
        data Teams / Team { Name text }
        data Notes / Note { Owner Account, State Role }
      `,
    }, async paths => {
      const path = paths['App.tao']!
      const root = FS.dirname(path)
      const source = await FS.readText(path)
      const before = await dataSchemaFingerprint(root)
      for (
        const changed of [source.replace('Owner Account', 'Owner Team'), source.replace('State Role', 'State Status')]
      ) {
        await FS.writeText(path, changed)
        Expect(await dataSchemaFingerprint(root)).not.toBe(before)
      }
    })
  })

  Test('hashes composite unique membership while ignoring constraint and member order', async () => {
    await withTaoFiles('tao-ship-unique-fingerprint-', {
      'App.tao': `data Memberships / Membership {
        Workspace text, Person text, Email text, unique Workspace + Person, unique Email
      }`,
    }, async paths => {
      const path = paths['App.tao']!
      const root = FS.dirname(path)
      const source = await FS.readText(path)
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(
        path,
        source.replace('unique Workspace + Person, unique Email', 'unique Email, unique Person + Workspace'),
      )
      Expect(await dataSchemaFingerprint(root)).toBe(before)
      for (
        const changed of [
          source.replace(', unique Workspace + Person', ''),
          source.replace('unique Workspace + Person', 'unique Workspace + Email'),
        ]
      ) {
        await FS.writeText(path, changed)
        Expect(await dataSchemaFingerprint(root)).not.toBe(before)
      }
    })
  })

  Test('hashes the stored shape of named value types from another file', async () => {
    await withTaoFiles('tao-ship-value-shape-fingerprint-', {
      'App.tao': 'use Label, Role from ./Types\ndata Notes / Note { Label, State Role }',
      'Types.tao': 'public type Label is text\npublic type Role is one of Admin, Member',
    }, async paths => {
      const root = FS.dirname(paths['App.tao']!)
      const path = paths['Types.tao']!
      const source = await FS.readText(path)
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(path, source.replace('Admin, Member', 'Member, Admin'))
      Expect(await dataSchemaFingerprint(root)).toBe(before)
      for (
        const changed of [
          source.replace('is text', 'is number'),
          source.replace('Admin, Member', 'Admin, Member, Guest'),
        ]
      ) {
        await FS.writeText(path, changed)
        Expect(await dataSchemaFingerprint(root)).not.toBe(before)
      }
    })
  })

  Test('refuses to fingerprint source recovered from parser or lexer errors', async () => {
    await withTaoFiles('tao-ship-invalid-fingerprint-', {
      'App.tao': 'data Notes / Note { Body text Pinned boolean }',
    }, async paths => {
      const path = paths['App.tao']!
      const root = FS.dirname(path)
      await Expect(dataSchemaFingerprint(root)).rejects.toThrow(
        `Cannot fingerprint data schema: '${path}' contains invalid Tao syntax.`,
      )
      await FS.writeText(path, 'data Notes / Note { Body text } `')
      await Expect(dataSchemaFingerprint(root)).rejects.toThrow(
        `Cannot fingerprint data schema: '${path}' contains invalid Tao syntax.`,
      )
      await FS.writeText(path, 'data Notes / Note { Body text }')
      const before = await dataSchemaFingerprint(root)
      await FS.writeText(FS.resolvePath('Invalid.test.tao', root), 'data Notes / Note { Body text Pinned boolean }')
      Expect(await dataSchemaFingerprint(root)).toBe(before)
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

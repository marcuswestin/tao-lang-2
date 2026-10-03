import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { latestStableRelease, readReleasePages } from '../cli-src/check-for-updates'
import { mergeProjectLocks, readProjectLock, writeProjectLock, writeToolchainPin } from '../cli-src/ship-lock'
import { ToolchainPin } from '../cli-src/toolchain-pin'

Describe('toolchain pin', () => {
  Test('an explicit +version wins over TAO_VERSION and the project pin, and leaves the arguments', async () => {
    await withProject('0.4.0', async project => {
      const request = await ToolchainPin.requestedVersion(['+0.4.2', 'check', '.'], { TAO_VERSION: '0.4.1' }, project)

      Expect(request).toEqual({ args: ['check', '.'], source: 'argument', version: '0.4.2' })
    })
  })

  Test('TAO_VERSION wins over the project pin', async () => {
    await withProject('0.4.0', async project => {
      Expect(await ToolchainPin.requestedVersion(['check'], { TAO_VERSION: '0.4.1' }, project))
        .toEqual({ args: ['check'], source: 'environment', version: '0.4.1' })
    })
  })

  Test('reads the pin of the nearest project from any directory inside it', async () => {
    await withProject('0.4.0', async project => {
      const inside = FS.resolvePath('Items/Detail', project)
      await FS.mkdir(inside)

      Expect(await ToolchainPin.requestedVersion(['dev'], {}, inside))
        .toEqual({ args: ['dev'], source: 'project', version: '0.4.0' })
    })
  })

  Test('migrates a legacy project lock before choosing its pinned release', async () => {
    const project = await mkTestDir('tao-toolchain-legacy-')
    try {
      await FS.writeText(
        FS.resolvePath('.tao-project/lock.jsonc', project),
        '{ "schemaVersion": 1, "toolchain": { "version": "0.4.0" } }\n',
      )
      Expect(await ToolchainPin.requestedVersion(['dev'], {}, project))
        .toEqual({ args: ['dev'], source: 'project', version: '0.4.0' })
      Expect(await FS.isFile(FS.resolvePath('.tao/store/lock.jsonc', project))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao-project/lock.jsonc', project))).toBe(false)
    } finally {
      await FS.remove(project)
    }
  })

  // A project nested in another is its own project, pin or no pin.
  Test('a nearer project without a pin does not inherit the outer one', async () => {
    await withProject('0.4.0', async project => {
      const nested = FS.resolvePath('experiments/sketch', project)
      await FS.writeText(FS.resolvePath('.tao/store/lock.jsonc', nested), '{ "schemaVersion": 1 }\n')

      Expect(await ToolchainPin.requestedVersion(['dev'], {}, nested)).toBeUndefined()
    })
  })

  Test('a development build runs every command itself, pin or no pin', async () => {
    await withProject('0.4.0', async project => {
      const delegation = await ToolchainPin.delegate(['+0.4.2', 'check'], {
        cwd: project,
        env: {},
        ownVersion: 'development',
      })

      Expect(delegation).toEqual({ args: ['+0.4.2', 'check'] })
    })
  })

  Test('a release asked for itself runs the command, without the +version', async () => {
    await withProject('0.4.0', async project => {
      Expect(await ToolchainPin.delegate(['+0.4.0', 'check'], { cwd: project, env: {}, ownVersion: '0.4.0' }))
        .toEqual({ args: ['check'] })
    })
  })

  Test('hands a pinned project to the installed release it pins, and returns that release’s status', async () => {
    await withProject('0.4.0', async project => {
      const home = FS.resolvePath('tao-home', project)
      const argsPath = FS.resolvePath('handed-args.txt', project)
      const pinned = ToolchainPin.versionBinary('0.4.0', home)
      await FS.writeText(pinned, `#!/bin/sh\necho "$TAO_VERSION $*" > '${argsPath}'\nexit 7\n`)
      await FS.chmod(pinned, 0o755)

      const delegation = await ToolchainPin.delegate(['check', '.'], {
        cwd: project,
        env: { PATH: '/usr/bin:/bin' },
        ownVersion: '0.5.0',
        taoHome: home,
      })

      Expect(delegation).toEqual({ exitCode: 7 })
      Expect(await FS.readText(argsPath)).toBe('0.4.0 check .\n')
    })
  })

  Test('without a terminal, names a pinned release that is not installed rather than waiting', async () => {
    await withProject('0.4.0', async project => {
      await Expect(ToolchainPin.delegate(['check'], {
        cwd: project,
        env: {},
        interactive: false,
        ownVersion: '0.5.0',
        taoHome: FS.resolvePath('empty-home', project),
      })).rejects.toThrow('This project names Tao 0.4.0, which is not installed')
    })
  })

  Test('asks before downloading a pin, checks its hash and version, and preserves the default binary', async () => {
    await withProject('0.4.0', async project => {
      const home = FS.resolvePath('tao-home', project)
      const defaultBinary = FS.resolvePath('bin/tao', home)
      const versionProbe = FS.resolvePath('version-probe.txt', project)
      await FS.writeText(defaultBinary, 'the default release stays here\n')
      const script =
        `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf '%s|%s|%s\\n' "$PWD" "\${TAO_VERSION:-unset}" "$*" > '${versionProbe}'\n  echo 0.4.0\nfi\n`
      const archive = new Uint8Array(Bun.gzipSync(new TextEncoder().encode(script)))
      const checksum = new TextEncoder().encode(`${Platform.sha256Hex(archive)}  tao-darwin-arm64.gz\n`)
      const questions: string[] = []
      const downloads: string[] = []
      const options = {
        cwd: project,
        env: { PATH: '/usr/bin:/bin', TAO_VERSION: '0.4.0' },
        interactive: true,
        ownVersion: '0.5.0',
        taoHome: home,
        releasesUrl: 'https://example.invalid/releases',
        confirmDownload: async (question: string) => {
          questions.push(question)
          return false
        },
        downloadBytes: async (url: string) => {
          downloads.push(url)
          return url.endsWith('.sha256') ? checksum : archive
        },
      }

      await Expect(ToolchainPin.delegate(['check'], options)).rejects.toThrow('install.sh | TAO_VERSION=0.4.0 sh')
      Expect(questions).toHaveLength(1)
      Expect(questions[0]).toContain('Download it now')
      Expect(downloads).toHaveLength(0)

      await Expect(ToolchainPin.delegate(['check'], {
        ...options,
        confirmDownload: async () => true,
        downloadBytes: async url => url.endsWith('.sha256') ? new TextEncoder().encode('wrong') : archive,
      })).rejects.toThrow('does not match its published checksum')
      Expect(await FS.isFile(ToolchainPin.versionBinary('0.4.0', home))).toBe(false)

      Expect(
        await ToolchainPin.delegate(['check'], {
          ...options,
          confirmDownload: async () => true,
        }),
      ).toEqual({ exitCode: 0 })
      Expect(downloads).toEqual([
        'https://example.invalid/releases/download/v0.4.0/tao-darwin-arm64.gz',
        'https://example.invalid/releases/download/v0.4.0/tao-darwin-arm64.gz.sha256',
      ])
      Expect(await FS.readText(versionProbe)).toBe('/|unset|--version\n')
      Expect(await FS.readText(defaultBinary)).toBe('the default release stays here\n')
    })
  })

  // A binary labelled with the wrong version would otherwise hand the run on forever.
  Test('refuses to hand a run on again', async () => {
    await withProject('0.4.0', async project => {
      await Expect(ToolchainPin.delegate(['check'], {
        cwd: project,
        env: { TAO_HANDED_OFF_BY: '0.5.0' },
        ownVersion: '0.4.1',
      })).rejects.toThrow('handed this run to Tao 0.4.0, but that binary reports 0.4.1')
    })
  })

  // The version becomes a directory name and a URL, so it must not be able to name anything else.
  Test('refuses a version that is not one', async () => {
    await withProject('0.4.0', async project => {
      await Expect(ToolchainPin.delegate(['+../../bin', 'check'], { cwd: project, env: {}, ownVersion: '0.4.0' }))
        .rejects.toThrow('which is not a version')
    })
  })

  Test('writing the pin keeps what shipping recorded, and a pin alone gains no ship section', async () => {
    const root = await mkTestDir('tao-toolchain-pin-lock-')
    try {
      await writeToolchainPin(root, '0.4.0')
      Expect(await readProjectLock(root)).toEqual({ schemaVersion: 1, toolchain: { version: '0.4.0' } })

      const shipped = mergeProjectLocks({ schemaVersion: 1 }, { schemaVersion: 1, ship: { apps: {} } })
      await writeProjectLock(root, shipped)
      Expect((await readProjectLock(root)).toolchain).toEqual({ version: '0.4.0' })
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('check-for-updates', () => {
  Test('picks the highest stable published CLI release, skipping drafts, prereleases, and other tags', () => {
    Expect(latestStableRelease([
      { draft: false, prerelease: false, tag_name: 'studio-v99.0.0' },
      { draft: false, prerelease: false, tag_name: 'v0.4.10' },
      { draft: false, prerelease: false, tag_name: 'v0.4.9' },
      { draft: true, prerelease: false, tag_name: 'v0.9.0' },
      { draft: false, prerelease: true, tag_name: 'v0.8.0' },
      { draft: false, prerelease: false, tag_name: 'v1.0.0-beta' },
    ])).toBe('0.4.10')
    Expect(latestStableRelease({ message: 'Not Found' })).toBeUndefined()
  })

  // Studio and the prebuilt hosts publish to the same listing, so the newest CLI release can sit
  // past the first page.
  Test('reads the listing a page at a time until a short page', async () => {
    const hosts = Array.from({ length: 100 }, (_, index) => ({ tag_name: `host-${index}` }))
    const requested: number[] = []

    const releases = await readReleasePages(async page => {
      requested.push(page)
      return page === 1 ? hosts : [{ draft: false, prerelease: false, tag_name: 'v0.4.3' }]
    })

    Expect(requested).toEqual([1, 2])
    Expect(latestStableRelease(releases)).toBe('0.4.3')
  })
})

async function withProject(pin: string, run: (project: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-toolchain-pin-')
  try {
    const project = FS.resolvePath('tally', root)
    await FS.writeText(
      FS.resolvePath('.tao/store/lock.jsonc', project),
      `{\n  // written by tao create\n  "schemaVersion": 1,\n  "toolchain": { "version": "${pin}" }\n}\n`,
    )
    await run(project)
  } finally {
    await FS.remove(root)
  }
}

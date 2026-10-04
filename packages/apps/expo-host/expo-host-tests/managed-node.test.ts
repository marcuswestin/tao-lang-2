import { ManagedNode, type NodeManifest } from '@expo-host'
import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

// The tarball here is a stand-in shaped like nodejs.org's, with a shell script for `bin/node`;
// `just standalone-cli-acceptance` downloads the real one through an installed binary.
Describe('ManagedNode', () => {
  Test('downloads the recorded Node once, unpacks it runnable, and reuses it after', async () => {
    await withNode(async ({ downloads, install, installRoot }) => {
      const binary = await ManagedNode.ensureIn(install, approved)
      await ManagedNode.ensureIn(install, approved)

      Expect(binary).toBe(FS.resolvePath('bin/node', installRoot))
      Expect((await CLI.mustRun(binary, { args: ['--version'] })).stdout.trim()).toBe('v24.0.0-stand-in')
      Expect(downloads).toEqual([install.manifest.url])
    })
  })

  Test('refuses a download that does not match the recorded SHA-256, and installs nothing', async () => {
    await withNode(async ({ install, installRoot }) => {
      const tampered = { ...install, manifest: { ...install.manifest, sha256: '0'.repeat(64) } }

      await Expect(ManagedNode.ensureIn(tampered, approved)).rejects.toThrow('does not match the SHA-256')

      Expect(await FS.exists(installRoot)).toBe(false)
    })
  })

  Test('asks first, and without a terminal or advance approval downloads nothing', async () => {
    await withNode(async ({ downloads, install }) => {
      await Expect(ManagedNode.ensureIn(install, { environment: {}, interactive: false }))
        .rejects.toThrow('TAO_HOST_INSTALL=yes')

      Expect(downloads).toEqual([])
    })
  })
})

const approved = { environment: { TAO_HOST_INSTALL: 'yes' }, interactive: false }

type FakeNode = {
  downloads: string[]
  install: { download: (url: string) => Promise<Uint8Array>; installRoot: string; manifest: NodeManifest }
  installRoot: string
}

async function withNode(run: (node: FakeNode) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-managed-node-')
  try {
    const packaged = FS.resolvePath('node-v24.0.0-darwin-arm64', root)
    await FS.writeText(FS.resolvePath('bin/node', packaged), '#!/bin/sh\necho v24.0.0-stand-in\n')
    await FS.chmod(FS.resolvePath('bin/node', packaged), 0o755)
    const archive = FS.resolvePath('node.tar.gz', root)
    await CLI.mustRun('/usr/bin/tar', { args: ['-czf', archive, '-C', root, 'node-v24.0.0-darwin-arm64'] })
    const tarball = await FS.readFile(archive)
    const downloads: string[] = []
    const installRoot = FS.resolvePath('versions/0.4.0/node', root)
    await run({
      downloads,
      install: {
        async download(url) {
          downloads.push(url)
          return tarball
        },
        installRoot,
        manifest: {
          sha256: Platform.sha256Hex(tarball),
          url: 'https://nodejs.org/dist/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz',
          version: '24.0.0',
        },
      },
      installRoot,
    })
  } finally {
    await FS.remove(root)
  }
}

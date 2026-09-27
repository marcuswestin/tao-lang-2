import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Immutable public release surfaces', () => {
  for (const phase of [1, 2, 3, 4, 5] as const) {
    Test(`phase ${phase} filters discovery and rejects unsupported execution before project access`, async () => {
      const root = await mkTestDir('release-surface-')
      try {
        const source = FS.resolvePath('probe.ts', root)
        const cli = Repo.resolvePath('packages/cli/tao-cli/cli-src')
        await FS.writeText(
          source,
          `
          import { createCommands } from ${JSON.stringify(FS.resolvePath('tao-cli.ts', cli))}
          import { runTaoBuild } from ${JSON.stringify(FS.resolvePath('build-command.ts', cli))}
          import { runShipCommand } from ${JSON.stringify(FS.resolvePath('ship-command.ts', cli))}
          import { HCI, ReleaseCapabilities } from ${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))
          }
          const commands = createCommands()
          const errors = []
          for (const operation of [
            () => runTaoBuild('/missing-project', { targets: ['desktop'] }),
            () => runShipCommand('/missing-project', { update: true }),
            () => runShipCommand('/missing-project', {}),
          ]) {
            try { await operation() } catch (error) { errors.push(String(error)) }
          }
          HCI.writeLine(JSON.stringify({
            phase: ReleaseCapabilities.current().phase,
            commands: commands.commands.map(command => command.name()),
            dev: commands.commands.find(command => command.name() === 'dev').options.map(option => option.long),
            ship: commands.commands.find(command => command.name() === 'ship')?.options.map(option => option.long),
            errors,
          }))
        `,
        )
        const build = await Bun.build({
          define: { TAO_RELEASE_PHASE: String(phase), TAO_STANDALONE: 'true' },
          entrypoints: [source],
          outdir: root,
          target: 'bun',
        })
        Expect(build.success).toBe(true)
        const result = await CLI.mustRun('bun', {
          args: [FS.resolvePath('probe.js', root)],
          // Runtime environment values cannot unlock a compiled public binary.
          env: { TAO_RELEASE_PHASE: 'development' },
        })
        const value = JSON.parse(result.stdout) as {
          commands: string[]
          dev: string[]
          errors: string[]
          phase: number
          ship?: string[]
        }
        Expect(value.phase).toBe(phase)
        Expect(value.commands).not.toContain('agents')
        Expect(value.commands).not.toContain('review')
        Expect(value.dev).toContain('--web')
        Expect(value.dev).not.toContain('--desktop')
        Expect(value.dev).not.toContain('--android')
        Expect(value.dev.includes('--ios')).toBe(phase >= 2)
        Expect(value.commands.includes('ship')).toBe(phase === 5)
        Expect(value.ship ?? []).not.toContain('--update')
        Expect(value.errors).toHaveLength(3)
        Expect(value.errors[0]).toContain('Desktop app builds is unavailable')
        Expect(value.errors[1]).toContain(
          phase === 5 ? 'Over-the-air updates is unavailable' : 'TestFlight shipping is unavailable',
        )
        Expect(value.errors[2]).toContain(
          phase === 5 ? 'External distribution is unavailable' : 'TestFlight shipping is unavailable',
        )
        Expect(value.errors.join('\n')).not.toContain('missing-project')
      } finally {
        await FS.remove(root)
      }
    })
  }
})

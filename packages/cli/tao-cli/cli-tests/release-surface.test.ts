import { CLI, FS, ReleaseCapabilities, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import type { Command } from 'commander'
import { createCommands } from '../cli-src/tao-cli'

Describe('Immutable public release surfaces', () => {
  Test('every command and option is classified, so none reaches a public build by default', () => {
    const unclassified: string[] = []
    const visit = (command: Command, path: string) => {
      for (const option of command.options) {
        if (ReleaseCapabilities.optionCapability(path, option.long ?? option.flags) === 'unclassified') {
          unclassified.push(`${path} ${option.long ?? option.flags}`)
        }
      }
      for (const child of command.commands) {
        visit(child, `${path} ${child.name()}`)
      }
    }
    for (const command of (createCommands() as unknown as Command).commands) {
      if (ReleaseCapabilities.commandCapability(command.name()) === 'unclassified') {
        unclassified.push(command.name())
      }
      visit(command, command.name())
    }
    Expect(unclassified).toEqual([])
    Expect(ReleaseCapabilities.commandCapability('future-command')).toBe('unclassified')
    Expect(ReleaseCapabilities.allows('unclassified', ReleaseCapabilities.profile(5))).toBe(false)
  })

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
          import { runTaoDev } from ${JSON.stringify(FS.resolvePath('dev-command.ts', cli))}
          import { runTaoBuild } from ${JSON.stringify(FS.resolvePath('build-command.ts', cli))}
          import { runShipCommand } from ${JSON.stringify(FS.resolvePath('ship-command.ts', cli))}
          import { HCI, ReleaseCapabilities } from ${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))
          }
          const commands = createCommands()
          const errors = []
          for (const operation of [
            () => runTaoBuild('/missing-project', { targets: ['desktop'] }),
            () => runTaoBuild('/missing-project', { targets: ['visionos'] }),
            () => runTaoBuild('/missing-project', { targets: ['watchos'] }),
            () => runShipCommand('/missing-project', { update: true }),
            () => runShipCommand('/missing-project', {}),
          ]) {
            try { await operation() } catch (error) { errors.push(String(error)) }
          }
          if (ReleaseCapabilities.current().phase < 4) {
            try { await runTaoDev('/missing-project', { device: 'phone' }) }
            catch (error) { errors.push(String(error)) }
          }
          HCI.writeLine(JSON.stringify({
            phase: ReleaseCapabilities.current().phase,
            commands: commands.commands.map(command => command.name()),
            dev: commands.commands.find(command => command.name() === 'dev').options.map(option => option.long),
            build: commands.commands.find(command => command.name() === 'build').options.map(option => option.long),
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
          build: string[]
          commands: string[]
          dev: string[]
          errors: string[]
          phase: number
          ship?: string[]
        }
        Expect(value.phase).toBe(phase)
        Expect(value.commands).not.toContain('agents')
        Expect(value.commands).not.toContain('review')
        for (const deferred of ['bridge', 'secrets', 'instantdb']) {
          Expect(value.commands).not.toContain(deferred)
        }
        Expect(value.build).toContain('--web')
        Expect(value.build).not.toContain('--visionos')
        Expect(value.build).not.toContain('--watchos')
        Expect(value.dev).toContain('--web')
        Expect(value.dev).not.toContain('--desktop')
        Expect(value.dev).not.toContain('--android')
        Expect(value.dev.includes('--ios')).toBe(phase >= 2)
        Expect(value.dev.includes('--device')).toBe(phase >= 4)
        Expect(value.commands.includes('ship')).toBe(phase === 5)
        Expect(value.ship ?? []).not.toContain('--update')
        Expect(value.errors).toHaveLength(phase < 4 ? 6 : 5)
        if (phase < 4) {
          Expect(value.errors[5]).toContain('Companion')
        }
        Expect(value.errors[0]).toContain('Desktop app builds is unavailable')
        Expect(value.errors[1]).toContain('visionOS builds is unavailable')
        Expect(value.errors[2]).toContain('watchOS builds is unavailable')
        Expect(value.errors[3]).toContain(
          phase === 5 ? 'Over-the-air updates is unavailable' : 'TestFlight shipping is unavailable',
        )
        Expect(value.errors[4]).toContain(
          phase === 5 ? 'External distribution is unavailable' : 'TestFlight shipping is unavailable',
        )
        Expect(value.errors.join('\n')).not.toContain('missing-project')
      } finally {
        await FS.remove(root)
      }
    })
  }
})

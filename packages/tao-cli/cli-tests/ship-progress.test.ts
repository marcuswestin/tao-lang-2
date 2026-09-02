import { Errors } from '@shared'
import { Describe, Expect, fakeTerminal, Test } from '@shared/test'
import { planShipProgress, shipCommandFailure, ShipProgress } from '../cli-src/ship-progress'

Describe('tao ship progress', () => {
  Test('plans stable full-build and resume phases', () => {
    Expect(
      planShipProgress({
        beta: true,
        buildId: 'previous-build',
        noWait: false,
        reuseBuild: false,
        rollback: false,
        update: false,
      }).map(item => item.id),
    )
      .toEqual([
        'app-store-connect',
        'compile',
        'bundle-export',
        'ios-project',
        'ios-dependencies',
        'ios-archive',
        'upload',
        'apple-processing',
        'testflight',
        'checkpoint',
      ])
    Expect(
      planShipProgress({ beta: true, noWait: false, reuseBuild: true, rollback: false, update: false }).map(item =>
        item.id
      ),
    )
      .toEqual(['app-store-connect', 'apple-processing', 'testflight', 'checkpoint'])
  })

  Test('emits concise progress markers and rejects execution drift', () => {
    const terminal = fakeTerminal()
    const phases = planShipProgress({
      beta: false,
      buildId: 'build-1',
      noWait: false,
      reuseBuild: true,
      rollback: false,
      update: false,
    })
    const progress = new ShipProgress(phases, terminal)

    progress.step('app-store-connect')
    progress.step('app-review')
    progress.step('checkpoint')

    Expect(terminal.outputText()).toBe([
      '[ship 1/3] Connect to App Store Connect…',
      '[ship 2/3] Submit the build for App Store review…',
      '[ship 3/3] Record the ship result…',
      '',
    ].join('\n'))
    Expect(() => progress.step('checkpoint')).toThrow(Errors.UnexpectedBehaviorError)
  })

  Test('summarizes a command diagnostic and points to its detailed log', () => {
    const error = new Errors.CommandExecutionError({
      args: ['archive'],
      command: 'xcodebuild',
      exitCode: 65,
      signal: null,
      stderr: 'noise\nApp.xcodeproj: error: Signing requires a development team.\n',
      stdout: 'more noise',
    })

    const message = shipCommandFailure(
      error,
      'Archive and sign the iOS app',
      '/repo/.artifacts/logs/ship/build.log',
    ).message
    Expect(message).toContain(
      'Archive and sign the iOS app failed: App.xcodeproj: error: Signing requires a development team.',
    )
    Expect(message).toContain('Detailed log:')
    Expect(message).toContain('.artifacts/logs/ship/build.log')
  })
})

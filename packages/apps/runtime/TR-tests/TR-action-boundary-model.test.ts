import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('action boundary model packaging', () => {
  Test('checks and executes native ownership against the pure model without enabling JSX', async () => {
    await withTaoFiles('tao-action-boundary-model-', {}, async (_paths, root) => {
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import { MountedActionBoundary, ActionBoundaryContext, type TaoActionFailureSink } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-boundary-model.ts'))
        }
        import { TaoActionOwner } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-native-subscription.ts'))
        }
        import { runAction } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts'))
        }
        import { TaoActionFailure } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-errors.ts'))
        }
        const first = new MountedActionBoundary(), second = new MountedActionBoundary()
        const unmountFirst = first.mount(), unmountSecond = second.mount()
        const owner = new TaoActionOwner()
        owner.boundary = first
        const initial: TaoActionFailureSink = owner.captureFailureSink()!
        let changes = 0
        const unsubscribe = first.subscribe(() => { changes++ })
        try {
          await runAction('Model', [], () => { throw new TaoActionFailure('InvalidInput', 'Model rejected.') },
            false, false, undefined, undefined, owner)
          const failure = first.failure!
          if (failure.message !== 'Model rejected.' || second.failure !== undefined) throw new Error('host isolation')
          first.recover()
          if (initial(failure)) throw new Error('recovered generation accepted')
          const current: TaoActionFailureSink = owner.captureFailureSink()!
          owner.dispose(); owner.active = true
          if (current(failure)) throw new Error('disposed generation accepted')
          if (!owner.captureFailureSink()!(failure)) throw new Error('reactivated generation rejected')
          const staleMount: TaoActionFailureSink = first.capture()!
          unmountFirst()
          const disposeRemount = first.mount()
          if (staleMount(failure)) throw new Error('old mount accepted')
          disposeRemount()
          if (first.capture() !== undefined) throw new Error('unmounted boundary capture')
          console.log(JSON.stringify({ context: ActionBoundaryContext.Provider !== undefined, changes,
            secondHealthy: second.failure === undefined }))
        } finally { unsubscribe(); owner.dispose(); unmountFirst(); unmountSecond() }
      `,
      )
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.writeJson(config, {
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          esModuleInterop: true,
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          types: ['bun', 'node'],
          typeRoots: [Repo.resolvePath('node_modules/@types')],
        },
        files: [program],
      })
      const checked = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
        processPolicy: 'test',
      })
      Expect({ exitCode: checked.exitCode, stdout: checked.stdout, stderr: checked.stderr })
        .toEqual({ exitCode: 0, stdout: '', stderr: '' })
      const executed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: executed.exitCode, stderr: executed.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(executed.stdout)).toEqual({ context: true, changes: 3, secondHealthy: true })
    })
  })
})

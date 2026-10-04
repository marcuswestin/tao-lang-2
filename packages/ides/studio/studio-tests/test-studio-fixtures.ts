import { CLI, Errors, FS, Repo, Time } from '@shared'
import type { StudioCellEnvironment, StudioSchemeEnvironment } from '../studio-src/StudioPreviewManifest'
import type { StudioSketchCatalogRequest } from '../studio-src/StudioSketchCatalog'

/** systemLightScheme is the scheme a fresh browser cell reports: system-requested, resolved light. */
export function systemLightScheme(): StudioSchemeEnvironment {
  return { capability: 'reactive-browser', requested: 'system', resolved: 'light', source: 'system' }
}

/** cellEnvironment is a phone-sized, online, light cell; pass only the sections a test changes. */
export function cellEnvironment(overrides: Partial<StudioCellEnvironment> = {}): StudioCellEnvironment {
  return {
    network: { latencyMs: 0, outcome: 'normal' },
    scheme: systemLightScheme(),
    viewport: { height: 844, width: 390 },
    ...overrides,
  }
}

/** Starts a real second session and holds its first catalog contention poll until resumed. */
export function contendingSketchCreate(projectRoot: string, request: StudioSketchCatalogRequest) {
  const waiting = FS.resolvePath(`catalog-wait-${crypto.randomUUID()}`, projectRoot)
  const resume = FS.resolvePath(`catalog-resume-${crypto.randomUUID()}`, projectRoot)
  const result = CLI.run('bun', {
    args: [
      '-e',
      `
      import { StudioProjectSession } from ${
        JSON.stringify(Repo.resolvePath('packages/ides/studio/studio-src/StudioProjectSession.ts'))
      }
      import { FS } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))}
      const root = ${JSON.stringify(projectRoot)}
      const session = await StudioProjectSession.open({
        async compile() {},
        entryPath: FS.resolvePath('Garden.tao', root),
        projectRoot: root,
      })
      const originalTimeout = globalThis.setTimeout
      let observedWait = false
      globalThis.setTimeout = ((callback, milliseconds, ...args) => {
        if (!observedWait) {
          observedWait = true
          void (async () => {
            await FS.writeText(${JSON.stringify(waiting)}, 'waiting')
            while (!await FS.exists(${JSON.stringify(resume)})) {
              await new Promise(resolve => originalTimeout(resolve, 10))
            }
            callback(...args)
          })()
          return 0
        }
        return originalTimeout(callback, milliseconds, ...args)
      })
      await session.applySketchAction(${JSON.stringify(request)})
    `,
    ],
    stdio: 'pipe',
  })
  return {
    result,
    async waitForContention() {
      let observe = true
      try {
        await Promise.race([
          (async () => {
            while (observe && !await FS.exists(waiting)) {
              await Time.sleep(10) // budget-ok: Poll interval; completion requires the blocked-poll signal, not elapsed time.
            }
          })(),
          result.then(() => Errors.throwUnexpected('Independent create did not wait for rollback.')),
        ])
      } finally {
        observe = false
      }
    },
    async resume() {
      await FS.writeText(resume, 'resume')
    },
  }
}

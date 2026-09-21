import type { HostRevision, HostTarget } from '@host-control'
import { Errors, FS, Platform, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { StudioNative } from '../studio-tooling-src/StudioNative'

const firstRevision: HostRevision = { build: 'studio-host-control-1', source: 'fixture-1' }
const secondRevision: HostRevision = { build: 'studio-host-control-2', source: 'fixture-2' }
const actionTarget: HostTarget = {
  kind: 'scoped',
  scope: { kind: 'tag', value: 'host-control-workspace' },
  target: { kind: 'tag', value: 'host-control-action' },
}
const stateTarget: HostTarget = {
  kind: 'scoped',
  scope: { kind: 'tag', value: 'host-control-workspace' },
  target: { kind: 'accessibility', name: 'host-control-state' },
}

Test('StartedStudioNative exposes its real Electrobun renderer through fenced semantic host control', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/host-control', Repo.getRoot())
  const studioPort = smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_000)
  const previewPort = smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_001)
  const studioServer = Bun.serve({
    fetch: () => new Response(studioFixture(), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    hostname: '127.0.0.1',
    port: studioPort,
  })
  const previewServer = Bun.serve({
    fetch: () => new Response('<!doctype html><title>Studio host-control preview</title>'),
    hostname: '127.0.0.1',
    port: previewPort,
  })
  let native: Awaited<ReturnType<typeof StudioNative.start>> | undefined
  try {
    const studioUrl = `http://127.0.0.1:${studioServer.port}`
    native = await StudioNative.start({
      artifactRoot: FS.resolvePath('electrobun', artifactRoot),
      nativeHostCommand: 'studio-host-control-smoke',
      previewUrl: `http://127.0.0.1:${previewServer.port}`,
      projectUrl: `${studioUrl}/sessions/host-control-fixture`,
      showWindow: true,
      studioUrl,
    })
    const controller = await native.hostControl()
    const session = await controller.openSession({
      artifactRoot,
      mode: 'development',
      revision: firstRevision,
      target: 'studio-host-control-fixture',
    })

    const action = await session.observe({ expectedRevision: firstRevision, target: actionTarget })
    Expect(action.visible).toBe(true)
    await session.perform({
      expectedRevision: firstRevision,
      kind: 'click',
      lease: session.descriptor().lease,
      observation: action,
    })
    const changed = await session.observe({ expectedRevision: firstRevision, target: stateTarget })
    Expect(changed.text).toBe('clicked')
    await session.perform({
      expectedRevision: firstRevision,
      kind: 'refreshDocument',
      lease: session.descriptor().lease,
    })
    const reloaded = await session.observe({ expectedRevision: firstRevision, target: stateTarget })
    Expect(reloaded.text).toBe('ready')
    const peer = await controller.openSession({
      artifactRoot,
      mode: 'development',
      revision: firstRevision,
      target: 'studio-host-control-peer',
    })
    const peerAction = await peer.observe({ expectedRevision: firstRevision, target: actionTarget })

    await session.publishRevision({
      expectedCurrentRevision: firstRevision,
      lease: session.descriptor().lease,
      revision: secondRevision,
    })
    Expect(session.descriptor().revision).toEqual(secondRevision)
    await Expect(peer.perform({
      expectedRevision: firstRevision,
      kind: 'click',
      lease: peer.descriptor().lease,
      observation: peerAction,
    })).rejects.toThrow('no longer current')
    await Expect(session.perform({
      expectedRevision: secondRevision,
      kind: 'click',
      lease: session.descriptor().lease,
      observation: action,
    })).rejects.toThrow('no longer current')
    const refreshed = await session.observe({ expectedRevision: secondRevision, target: stateTarget })
    Expect(refreshed.text).toBe('ready')
    await peer.close(peer.descriptor().lease)
    await session.close(session.descriptor().lease)
  } finally {
    await native?.stop()
    studioServer.stop(true)
    previewServer.stop(true)
  }
}, 180_000)

function smokePort(name: string, fallback: number): number {
  const value = Number(Platform.runtimeProcess.env[name] ?? fallback)
  if (Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value
  }
  Errors.throwUserInput(`${name} must be a valid TCP port.`)
}

function studioFixture(): string {
  return `<!doctype html>
    <html><body>
      <main data-testid="host-control-workspace">
        <button data-testid="host-control-action">Click</button>
        <output aria-label="host-control-state">ready</output>
      </main>
      <script>
        document.querySelector('[data-testid="host-control-action"]')?.addEventListener('click', () => {
          const state = document.querySelector('[aria-label="host-control-state"]')
          if (state !== null) state.textContent = 'clicked'
        })
      </script>
    </body></html>`
}

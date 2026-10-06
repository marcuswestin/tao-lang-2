import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test, until } from '@shared/test'
import { connectDevLoopWorker, devLoopRequest } from '../shared-src/DevLoopControl'

Test('managed transport refuses non-loopback origins before exposing its credential', async () => {
  await Expect(devLoopRequest({ origin: 'http://example.com:8080', token: 'private', session: 'session' }, '/status'))
    .rejects.toThrow('loopback interface')
  await Expect(
    devLoopRequest({ origin: 'http://127.0.0.1.example.com:8080', token: 'private', session: 'session' }, '/status'),
  )
    .rejects.toThrow('loopback interface')
})

Test('managed worker retries a lost poll and acknowledgement, and close cancels its outstanding poll', async () => {
  const root = await mkTestDir('managed-worker-transport-')
  const credentials = FS.resolvePath('credentials.json', root)
  await FS.writeJson(credentials, { origin: 'http://127.0.0.1:1', token: 'fixture', session: 'fixture' }, {
    mode: 0o600,
  })
  await FS.chmod(root, 0o700)
  let polls = 0
  let acknowledgements = 0
  let stops = 0
  let aborts = 0
  const request: typeof devLoopRequest = async <T>(
    ...[_connection, path, _body, options]: Parameters<typeof devLoopRequest>
  ): Promise<T> => {
    if (path === '/worker/attach') {
      return { generation: 'fixture-generation' } as T
    }
    if (path === '/worker/poll') {
      polls++
      if (polls === 1) {
        throw Errors.abortError('Fixture lost poll')
      }
      if (polls === 2) {
        return { id: 'stop-fixture', generation: 'fixture-generation', action: 'stop' } as T
      }
      return await new Promise<T>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          aborts++
          reject(Errors.abortError('Fixture close cancelled poll'))
        }, { once: true })
      })
    }
    if (path === '/worker/ack') {
      acknowledgements++
      if (acknowledgements === 1) {
        throw Errors.abortError('Fixture lost acknowledgement')
      }
    }
    return { ok: true } as T
  }
  const worker = await connectDevLoopWorker(credentials, { request, sleep: async () => {} })
  try {
    worker.bind({
      stop: async () => {
        stops++
      },
      restart: async () => {},
      reload: async () => {},
    })
    await until(() => polls === 3, { description: 'the outstanding retried worker poll' })
    await until(() => acknowledgements === 2, { description: 'the retried worker acknowledgement' })
    Expect(stops).toBe(1)
    Expect(worker.stopRequested?.()).toBe(true)
    await worker.close()
    Expect(aborts).toBe(1)
    Expect(polls).toBe(3)
  } finally {
    await worker.close()
    await FS.remove(root)
  }
})

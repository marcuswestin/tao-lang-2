import { Assert, Platform } from '@shared'
import { Expect, testOverrideSlot, until } from '@shared/test'

const requestJSON = testOverrideSlot({
  read: () => Request.prototype.json,
  write: value => {
    Object.defineProperty(Request.prototype, 'json', { value })
  },
})

const serve = testOverrideSlot({
  read: () => Bun.serve,
  write: value => {
    Bun.serve = value
  },
})

/** Give the ordering assertion its standard busy-host budget before the fixture server closes idle responses. */
export async function withHeldRequestBudget(run: () => Promise<void>): Promise<void> {
  const restore = serve.install(
    new Proxy(Bun.serve, {
      apply(target, receiver, argumentsList) {
        return Reflect.apply(target, receiver, [{ ...argumentsList[0], idleTimeout: 60 }])
      },
    }),
  )
  try {
    await run()
  } finally {
    restore()
  }
}

/** Observe an actual server-side body prefix before attempting an independent authenticated operation. */
export async function withHeldSignIn(server: { url: string }, run: () => Promise<void>): Promise<void> {
  const marker = Platform.randomUUID()
  const prefix = '{"email":'
  const original = Request.prototype.json
  let receivedPrefix: string | undefined
  const restore = requestJSON.install(async function(this: Request) {
    if (this.url === `${server.url}/v1/auth/sign-in` && this.headers.get('x-fixture-request') === marker) {
      const body = this.clone().body
      Assert.defined(body, 'streaming sign-in body')
      const reader = body.getReader()
      const chunk = await reader.read()
      receivedPrefix = new TextDecoder().decode(chunk.value)
      // Cancel this observation branch without waiting for the still-open original body.
      void reader.cancel()
    }
    return await original.call(this)
  })
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stalled = fetch(`${server.url}/v1/auth/sign-in`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'application/json', 'x-fixture-request': marker },
    body: new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream
        stream.enqueue(new TextEncoder().encode(prefix))
      },
    }),
  }).then(response => ({ response, error: undefined }), error => ({ response: undefined, error }))
  try {
    await until(() => receivedPrefix !== undefined, {
      description: 'server to read the incomplete sign-in body prefix',
    })
    Expect(receivedPrefix).toBe(prefix)
    await run()
  } finally {
    try {
      Assert.defined(controller, 'held sign-in stream controller')
      controller.enqueue(
        new TextEncoder().encode('"unfinished@example.test","password":"a-good-password","resource":"notes"}'),
      )
      controller.close()
      const outcome = await stalled
      if (outcome.error !== undefined) {
        throw outcome.error
      }
      Assert.defined(outcome.response, 'completed held sign-in response')
      Expect(outcome.response.status).toBe(401)
    } finally {
      restore()
    }
  }
}

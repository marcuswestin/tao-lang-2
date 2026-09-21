import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { Expect, Test } from '@shared/test'
import { createConnection } from 'node:net'
import { startAppleFoundationModelsService } from '../generation-src/apple-server'
import {
  compileGenerationSchema,
  type EntityGenerationDeclaration,
  type JsonObject,
} from '../generation-src/generation'

if (Platform.runtimeProcess.env['TAO_LIVE_APPLE_AI'] !== '1') {
  Errors.throwUserInput('Set TAO_LIVE_APPLE_AI=1 to run live Apple Foundation Models checks.')
}

const workspace: EntityGenerationDeclaration = {
  collection: 'Workspaces',
  fields: [
    {
      guidance: 'Use a realistic name for a writing project.',
      name: 'Name',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'text' },
    },
    {
      defaultValue: { kind: 'now' },
      name: 'CreatedAt',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'time' },
    },
    {
      defaultValue: false,
      name: 'Pinned',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'boolean' },
    },
  ],
  kind: 'entity',
  name: 'Workspace',
}

Test(
  'live Swift helper supports availability, guided streaming, and realistic WordFlower entities',
  async () => {
    const service = await startAppleFoundationModelsService()
    try {
      Expect(await service.provider.availability()).toEqual({ status: 'available' })
      const compiled = compileGenerationSchema(workspace)
      const run = service.provider.generate<JsonObject>(
        compiled.schema,
        [{ name: 'scene', value: 'WorkspaceRow.novel' }],
        compiled.guide,
      )
      const partials = []
      for await (const partial of run.partials) {
        partials.push(partial)
      }
      const result = await run.final

      if (result.status === 'failure') {
        Errors.throwHostEnvironment(`Live Apple generation failed (${result.code}): ${result.message}`)
      }
      Expect(result.status).toBe('success')
      Expect(partials.length).toBeGreaterThan(0)
      Expect((result.value['Name'] as string).length).toBeGreaterThan(2)
    } finally {
      await service.stop()
    }
  },
  60_000,
)

Test(
  'live Swift helper binds only to loopback and rejects malformed HTTP safely',
  async () => {
    const compiledService = await startAppleFoundationModelsService()
    try {
      Expect(await compiledService.provider.availability()).toEqual({ status: 'available' })
    } finally {
      await compiledService.stop()
    }

    const binary = Repo.resolvePath('.artifacts/build/foundation-models/tao-foundation-models-server')
    Expect(await FS.isFile(binary)).toBe(true)
    const token = Platform.randomUUID()
    let stdout = ''
    let stderr = ''
    let resolveReady: ((port: number) => void) | undefined
    let rejectReady: ((error: Error) => void) | undefined
    const ready = new Promise<number>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const child = CLI.start(binary, {
      args: ['--port', '0'],
      stdin: `${token}\n`,
      onOutput(stream, chunk) {
        if (stream === 'stderr') {
          stderr += String(chunk)
          return
        }
        stdout += String(chunk)
        const match = /^READY (\d+)\n$/.exec(stdout)
        if (match?.[1] !== undefined) {
          resolveReady?.(Number(match[1]))
        }
      },
    })
    Expect(child.args).toEqual(['--port', '0'])
    Expect(child.args).not.toContain(token)
    child.onceError(error => rejectReady?.(error))
    child.onceClose((exitCode, signal) => {
      rejectReady?.(
        new Errors.HostEnvironmentError(
          `Helper exited before the raw checks: code=${exitCode} signal=${signal}. ${stderr}`,
        ),
      )
    })

    try {
      const port = await Promise.race([
        ready,
        Time.sleep(15_000).then(() => {
          Errors.throwHostEnvironment(`Helper did not become ready. stdout=${stdout} stderr=${stderr}`)
        }),
      ])
      const listeners = await CLI.run('/usr/sbin/lsof', {
        args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      })
      Expect(listeners.exitCode).toBe(0)
      Expect(listeners.stdout).toContain(`127.0.0.1:${port}`)
      Expect(listeners.stdout).not.toContain(`*:${port}`)

      const duplicateHeaders = await rawHTTP(
        port,
        [
          'GET /availability HTTP/1.1',
          'X-Duplicate: first',
          'X-Duplicate: second',
          '',
          '',
        ].join('\r\n'),
      )
      Expect(duplicateHeaders).toContain('HTTP/1.1 400 Bad Request')
      Expect(duplicateHeaders).toContain('Duplicate HTTP header')

      const negativeLength = await rawHTTP(
        port,
        [
          'POST /generate HTTP/1.1',
          'Content-Length: -1',
          '',
          '',
        ].join('\r\n'),
      )
      Expect(negativeLength).toContain('HTTP/1.1 400 Bad Request')
      Expect(negativeLength).toContain('Invalid Content-Length')

      const oversizedLength = await rawHTTP(
        port,
        [
          'POST /generate HTTP/1.1',
          'Content-Length: 262145',
          '',
          '',
        ].join('\r\n'),
      )
      Expect(oversizedLength).toContain('HTTP/1.1 413 Payload Too Large')
      Expect(oversizedLength).toContain('Request body exceeded its size limit')

      const availability = await rawHTTP(
        port,
        [
          'GET /availability HTTP/1.1',
          `Authorization: Bearer ${token}`,
          '',
          '',
        ].join('\r\n'),
      )
      Expect(availability).toContain('HTTP/1.1 200 OK')
      Expect(availability).toContain('"status":"available"')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await child.waitForClose()
      await child.closeOutput()
    }
  },
  60_000,
)

async function rawHTTP(port: number, request: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let response = ''
    let settled = false
    const succeed = () => {
      if (!settled) {
        settled = true
        resolve(response)
      }
    }
    const fail = (error: Error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    socket.setEncoding('utf8')
    socket.setTimeout(5_000, () => {
      socket.destroy()
      fail(new Errors.HostEnvironmentError('Timed out waiting for the helper HTTP response.'))
    })
    socket.on('connect', () => socket.write(request))
    socket.on('data', chunk => {
      response += chunk
    })
    socket.on('end', succeed)
    socket.on('close', succeed)
    socket.on('error', fail)
  })
}

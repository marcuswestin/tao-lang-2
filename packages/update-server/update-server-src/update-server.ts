import type { UpdateService } from './update-service'

export type BunUpdateServerOptions = {
  hostname?: string
  port: number
  service: UpdateService
}

/** startBunUpdateServer is the executable transport adapter; the service itself depends only on Request/Response. */
export function startBunUpdateServer(options: BunUpdateServerOptions): Bun.Server<undefined> {
  return Bun.serve({
    fetch: request => options.service.handle(request),
    hostname: options.hostname,
    port: options.port,
  })
}

import { FS } from '@shared'

export type StaticHostServer = Readonly<{ url: string; stop: () => Promise<void> }>

/** Serves one exported host app without caching and without allowing paths outside its export root. */
export function startStaticHostServer(root: string): StaticHostServer {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      let path: string
      try {
        const pathname = decodeURIComponent(new URL(request.url).pathname)
        path = FS.resolvePath(pathname === '/' ? 'index.html' : `.${pathname}`, root)
      } catch {
        return new Response('Bad path', { status: 400 })
      }
      if (!FS.pathIsWithin(path, root)) {
        return new Response('Not found', { status: 404 })
      }
      const file = Bun.file(path)
      if (!await file.exists()) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(file, { headers: { 'Cache-Control': 'no-store' } })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true)
    },
  }
}

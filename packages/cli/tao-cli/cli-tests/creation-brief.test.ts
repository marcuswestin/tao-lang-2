import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  briefPrompt,
  buildCreationBrief,
  extractReferences,
  htmlToText,
  paletteFromBmp,
} from '../cli-src/create/creation-brief'

/** bmp24 builds an uncompressed 24-bit BMP from rows of #rrggbb pixels, the format `sips` writes. */
function bmp24(rows: readonly (readonly string[])[]): Uint8Array {
  const height = rows.length
  const width = rows[0]!.length
  const stride = Math.floor((24 * width + 31) / 32) * 4
  const bytes = new Uint8Array(54 + stride * height)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(30, 0, true)
  rows.forEach((row, rowIndex) => {
    row.forEach((hex, column) => {
      const at = 54 + rowIndex * stride + column * 3
      bytes[at] = Number.parseInt(hex.slice(5, 7), 16)
      bytes[at + 1] = Number.parseInt(hex.slice(3, 5), 16)
      bytes[at + 2] = Number.parseInt(hex.slice(1, 3), 16)
    })
  })
  return bytes
}

Describe('tao create brief', () => {
  Test('finds URLs and existing image files in a description', async () => {
    const root = await mkTestDir('tao-create-brief-')
    try {
      await FS.writeText(FS.resolvePath('shot 1.png', root), 'not really a png')
      const references = await extractReferences(
        'A reader like https://news.ycombinator.com/, see "shot 1.png" and ./missing.png (https://example.com/a).',
        root,
      )
      Expect(references.urls).toEqual(['https://news.ycombinator.com/', 'https://example.com/a'])
      Expect(references.imagePaths).toEqual([FS.resolvePath('shot 1.png', root)])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reduces a page to its title, description, and readable text', () => {
    const page = htmlToText(
      '<html><head><title>Cook &amp; Eat</title><meta name="description" content="Recipes for two">'
        + '<script>track()</script><style>p{}</style></head>'
        + '<body><nav>Menu</nav><h1>Hello</h1><p>World &lt;3 &#169;</p><!-- hidden --></body></html>',
    )
    Expect(page.title).toBe('Cook & Eat')
    Expect(page.text).toBe('Recipes for two\nMenu Hello\nWorld <3 ©')
  })

  Test('reads a palette from a bitmap: lightest frequent, darkest frequent, most frequent saturated', () => {
    const light = '#f4f4f0'
    const dark = '#202020'
    const blue = '#2266cc'
    const palette = paletteFromBmp(bmp24([
      [light, light, light, light, light, light, light, light, blue, blue],
      [light, light, light, light, light, light, light, light, dark, dark],
    ]))
    Expect(palette).toEqual({ canvas: light, ink: dark, accent: blue })
    Expect(paletteFromBmp(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  Test('builds a brief from fetched pages and image palettes, and renders it within a budget', async () => {
    const root = await mkTestDir('tao-create-brief-')
    try {
      const image = FS.resolvePath('mock.png', root)
      await FS.writeText(image, 'png bytes')
      const brief = await buildCreationBrief(`Like https://example.com/app but for dogs, styled like ${image}`, {
        cwd: root,
        fetch: async (input: string) => {
          Expect(input).toBe('https://example.com/app')
          return new Response('<html><head><title>Cat App</title></head><body><p>Cats, tracked.</p></body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        },
        paletteFromImage: async () => ({ canvas: '#ffffff', ink: '#101010', accent: '#aa3300' }),
      })
      Expect(brief.sources).toEqual([
        { kind: 'url', url: 'https://example.com/app', title: 'Cat App', text: 'Cats, tracked.' },
        { kind: 'image', path: image, palette: { canvas: '#ffffff', ink: '#101010', accent: '#aa3300' } },
      ])
      Expect(brief.palette).toEqual({ canvas: '#ffffff', ink: '#101010', accent: '#aa3300' })

      const prompt = briefPrompt(brief, 4_000)
      Expect(prompt).toContain('Description: Like https://example.com/app but for dogs')
      Expect(prompt).toContain('Web page https://example.com/app (Cat App):\nCats, tracked.')
      Expect(prompt).toContain('colors read from it are canvas #ffffff, ink #101010, accent #aa3300')
      Expect(briefPrompt(brief, 60).length).toBeLessThanOrEqual(60)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps unreadable sources with their reason', async () => {
    const brief = await buildCreationBrief('Copy https://example.com/private', {
      fetch: async () => new Response('nope', { status: 403 }),
    })
    Expect(brief.sources).toEqual([{ kind: 'url', url: 'https://example.com/private', error: 'HTTP 403' }])
    Expect(briefPrompt(brief, 500)).toContain('could not be read (HTTP 403)')
  })

  Test('cancels a streaming URL body as soon as the source ceiling is reached', async () => {
    let pulls = 0
    let cancelled = false
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(encoder.encode('x'.repeat(300_000)))
      },
      cancel() {
        cancelled = true
      },
    })
    const brief = await buildCreationBrief('Read https://example.com/huge', {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
    })

    Expect(brief.sources).toEqual([{ kind: 'url', url: 'https://example.com/huge', text: 'x'.repeat(6_000) }])
    Expect(cancelled).toBe(true)
    Expect(pulls).toBeLessThanOrEqual(3)
  })
})

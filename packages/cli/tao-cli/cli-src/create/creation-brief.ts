import { CLI, Errors, FS, Platform } from '@shared'
import { formatHex, luminance, saturation } from './creation-colors'
import { type CreationPalette, DEFAULT_PALETTE } from './creation-plan'

/** CreationSource is one reference the description pointed at: a web page or a local image. */
type CreationSource =
  | { kind: 'image'; path: string; palette?: CreationPalette; error?: string }
  | { kind: 'url'; url: string; title?: string; text?: string; error?: string }

/** CreationBrief is the description plus everything Tao could read from the references it names. */
export type CreationBrief = {
  description: string
  sources: CreationSource[]
  /** The palette read from the first image that yielded one; it outranks a model's color choice. */
  palette?: CreationPalette
}

type BriefFetch = (input: string, init?: RequestInit) => Promise<Response>

export type BuildCreationBriefOptions = {
  cwd?: string
  fetch?: BriefFetch
  maxSourceChars?: number
  paletteFromImage?: (path: string) => Promise<CreationPalette | undefined>
  urlTimeoutMs?: number
}

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|heic|bmp|tiff?)$/iu
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/giu
const MAX_RESPONSE_CHARS = 512_000

/**
 * buildCreationBrief reads what the description points at, deterministically and before any model is
 * involved: web pages become text, images become a palette. Everything it could not read is kept as
 * a source with an error, so the proposal can say so.
 */
export async function buildCreationBrief(
  description: string,
  options: BuildCreationBriefOptions = {},
): Promise<CreationBrief> {
  const references = await extractReferences(description, options.cwd)
  const sources: CreationSource[] = []
  for (const url of references.urls) {
    sources.push(await readUrl(url, options))
  }
  const readPalette = options.paletteFromImage ?? paletteFromImage
  for (const path of references.imagePaths) {
    try {
      const palette = await readPalette(path)
      sources.push(
        palette === undefined
          ? { kind: 'image', path, error: 'no palette could be read' }
          : { kind: 'image', path, palette },
      )
    } catch (error) {
      sources.push({ kind: 'image', path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const palette = sources.find(source => source.kind === 'image' && source.palette !== undefined)
  return {
    description: description.trim(),
    sources,
    ...(palette?.kind === 'image' && palette.palette !== undefined ? { palette: palette.palette } : {}),
  }
}

/** extractReferences finds the URLs and the existing image files a description mentions. */
export async function extractReferences(
  description: string,
  cwd = Platform.runtimeProcess.cwd(),
): Promise<{ imagePaths: string[]; urls: string[] }> {
  const urls = [...new Set([...description.matchAll(URL_PATTERN)].map(match => match[0].replace(/[.,;:!?]+$/u, '')))]
  const withoutUrls = description.replace(URL_PATTERN, ' ')
  const candidates = new Set<string>()
  for (const match of withoutUrls.matchAll(/"([^"\n]+)"|'([^'\n]+)'|(\S+)/gu)) {
    const token = (match[1] ?? match[2] ?? match[3] ?? '').replace(/[.,;:!?)]+$/u, '')
    if (IMAGE_EXTENSIONS.test(token)) {
      candidates.add(token)
    }
  }
  const imagePaths: string[] = []
  for (const candidate of candidates) {
    const expanded = candidate.startsWith('~/') ? FS.resolvePath(candidate.slice(2), FS.homeDir()) : candidate
    const resolved = FS.resolvePath(expanded, cwd)
    if (await FS.isFile(resolved)) {
      imagePaths.push(resolved)
    }
  }
  return { imagePaths, urls }
}

async function readUrl(url: string, options: BuildCreationBriefOptions): Promise<CreationSource> {
  const fetcher = options.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.urlTimeoutMs ?? 10_000)
  try {
    const response = await fetcher(url, {
      headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1', 'user-agent': 'tao-create' },
      redirect: 'follow',
      // Bun and DOM publish structurally different AbortSignal declarations; the runtime object is shared.
      signal: controller.signal as unknown as RequestInit['signal'],
    })
    if (!response.ok) {
      return { kind: 'url', url, error: `HTTP ${response.status}` }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!/text\/|json|xml/iu.test(contentType)) {
      return { kind: 'url', url, error: `not a text page (${contentType || 'unknown type'})` }
    }
    const raw = await readCappedResponse(response, MAX_RESPONSE_CHARS, controller)
    const limit = options.maxSourceChars ?? 6_000
    if (/html/iu.test(contentType) || /<html|<body|<div|<p[\s>]/iu.test(raw.slice(0, 2_000))) {
      const page = htmlToText(raw)
      return {
        kind: 'url',
        url,
        ...(page.title === undefined ? {} : { title: page.title }),
        text: page.text.slice(0, limit),
      }
    }
    return { kind: 'url', url, text: raw.replace(/\s+/gu, ' ').trim().slice(0, limit) }
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: 'url', url, error: 'timed out' }
    }
    return { kind: 'url', url, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** readCappedResponse stops the network body as soon as the parsing ceiling has been reached. */
async function readCappedResponse(response: Response, maxChars: number, controller: AbortController): Promise<string> {
  if (response.body === null) {
    return ''
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let receivedBytes = 0
  try {
    while (receivedBytes < maxChars) {
      const next = await reader.read()
      if (next.done) {
        text += decoder.decode()
        break
      }
      const remaining = maxChars - receivedBytes
      const bounded = next.value.byteLength > remaining ? next.value.subarray(0, remaining) : next.value
      receivedBytes += bounded.byteLength
      text += decoder.decode(bounded, { stream: receivedBytes < maxChars })
    }
    return text.slice(0, maxChars)
  } finally {
    if (receivedBytes >= maxChars) {
      controller.abort()
      await reader.cancel('Tao create source limit reached').catch(() => undefined)
    }
    reader.releaseLock()
  }
}

/** htmlToText keeps a page's title, meta description, and readable text, dropping markup and scripts. */
export function htmlToText(html: string): { text: string; title?: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '').replace(/\s+/gu, ' ').trim()
  const description = decodeEntities(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/iu.exec(html)?.[1]
      ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/iu.exec(html)?.[1]
      ?? '',
  ).trim()
  const body = html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre|dd|dt)\s*>|<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
  const lines = decodeEntities(body)
    .split('\n')
    .map(line => line.replace(/\s+/gu, ' ').trim())
    .filter(line => line.length > 0)
  const text = [description, ...lines].filter(line => line.length > 0).join('\n')
  return title.length === 0 ? { text } : { text, title }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return codePoint(Number.parseInt(entity.slice(2), 16), whole)
    }
    if (entity.startsWith('#')) {
      return codePoint(Number.parseInt(entity.slice(1), 10), whole)
    }
    return named[entity.toLowerCase()] ?? whole
  })
}

/** codePoint decodes a numeric entity, keeping the source text when the number is not a code point. */
function codePoint(value: number, whole: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole
}

/**
 * paletteFromImage reads an image's dominant colors through the system's image tool, which every Mac
 * has; on other hosts it reports no palette rather than guessing.
 */
async function paletteFromImage(path: string): Promise<CreationPalette | undefined> {
  if (process.platform !== 'darwin') {
    return undefined
  }
  const scratch = await FS.mkTmpDir('tao-create-palette-')
  try {
    const bmpPath = FS.resolvePath('palette.bmp', scratch)
    const result = await CLI.run('sips', { args: ['-s', 'format', 'bmp', '-Z', '48', path, '--out', bmpPath] })
    if (result.exitCode !== 0) {
      Errors.throwHostEnvironment(`sips exited with ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`)
    }
    if (!(await FS.exists(bmpPath))) {
      Errors.throwHostEnvironment('sips wrote no bitmap.')
    }
    return paletteFromBmp(await FS.readFile(bmpPath))
  } finally {
    await FS.remove(scratch).catch(() => undefined)
  }
}

/**
 * paletteFromBmp picks canvas, ink, and accent from an uncompressed 24- or 32-bit BMP: the lightest
 * frequent color, the darkest frequent color, and the most frequent saturated mid-tone.
 */
export function paletteFromBmp(bytes: Uint8Array): CreationPalette | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return undefined
  }
  const pixelOffset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const bitsPerPixel = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  if (
    width <= 0 || rawHeight === 0 || (bitsPerPixel !== 24 && bitsPerPixel !== 32)
    || (compression !== 0 && compression !== 3)
  ) {
    return undefined
  }
  const height = Math.abs(rawHeight)
  const bytesPerPixel = bitsPerPixel / 8
  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let total = 0
  for (let row = 0; row < height; row += 1) {
    const rowStart = pixelOffset + row * stride
    for (let column = 0; column < width; column += 1) {
      const at = rowStart + column * bytesPerPixel
      if (at + 2 >= bytes.length) {
        return undefined
      }
      const b = bytes[at]!
      const g = bytes[at + 1]!
      const r = bytes[at + 2]!
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
      buckets.set(key, bucket)
      total += 1
    }
  }
  if (total === 0) {
    return undefined
  }
  const colors = [...buckets.values()]
    .map(bucket => ({
      count: bucket.count,
      rgb: { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count },
    }))
    .sort((left, right) => right.count - left.count)
  const frequent = (share: number) => colors.filter(color => color.count >= total * share)
  const accent = colors.find(color => {
    const light = luminance(color.rgb)
    return saturation(color.rgb) >= 0.3 && light >= 0.06 && light <= 0.7
  })
  const canvas = frequent(0.02).filter(color => luminance(color.rgb) >= 0.6)
    .sort((left, right) => luminance(right.rgb) - luminance(left.rgb))[0]
  const ink = frequent(0.01).filter(color => luminance(color.rgb) <= 0.3)
    .sort((left, right) => luminance(left.rgb) - luminance(right.rgb))[0]
  const contrastOk = canvas !== undefined && ink !== undefined && luminance(canvas.rgb) - luminance(ink.rgb) >= 0.4
  return {
    canvas: contrastOk ? formatHex(canvas.rgb) : DEFAULT_PALETTE.canvas,
    ink: contrastOk ? formatHex(ink.rgb) : DEFAULT_PALETTE.ink,
    accent: accent === undefined ? DEFAULT_PALETTE.accent : formatHex(accent.rgb),
  }
}

/**
 * briefPrompt renders the brief for a model within `maxChars`: the description first, then each
 * readable source with a fair share of what remains.
 */
export function briefPrompt(brief: CreationBrief, maxChars: number): string {
  const parts: string[] = [`Description: ${brief.description.slice(0, Math.min(2_000, maxChars))}`]
  const readable = brief.sources.filter(source => source.kind === 'url' && source.text !== undefined)
  const remaining = maxChars - parts[0]!.length
  const share = readable.length === 0 ? 0 : Math.max(0, Math.floor(remaining / readable.length) - 120)
  for (const source of brief.sources) {
    if (source.kind === 'url') {
      const heading = `Web page ${source.url}${source.title === undefined ? '' : ` (${source.title})`}`
      if (source.text === undefined) {
        parts.push(`${heading}: could not be read (${source.error ?? 'unknown reason'}).`)
      } else {
        parts.push(`${heading}:\n${source.text.slice(0, share)}`)
      }
    } else if (source.palette !== undefined) {
      const { canvas, ink, accent } = source.palette
      parts.push(`Image ${source.path}: colors read from it are canvas ${canvas}, ink ${ink}, accent ${accent}.`)
    } else {
      parts.push(`Image ${source.path}: could not be read (${source.error ?? 'unknown reason'}).`)
    }
  }
  return parts.join('\n\n').slice(0, maxChars)
}

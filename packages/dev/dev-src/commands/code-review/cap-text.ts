import type { CappedText } from './types'

/** capText trims text to a byte budget, keeping the head and tail around a marker. */
export function capText(text: string, maxBytes: number): CappedText {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Text cap must be a positive integer byte count.')
  }
  const originalBytes = Buffer.byteLength(text, 'utf8')
  if (originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes }
  }
  const buffer = Buffer.from(text, 'utf8')
  const marker = `\n\n[... ${originalBytes - maxBytes} bytes truncated ...]\n\n`
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  if (markerBytes >= maxBytes) {
    return { text: decodeUtf8Head(buffer, maxBytes), truncated: true, originalBytes }
  }
  const remainingBytes = maxBytes - markerBytes
  const headBytes = Math.floor(remainingBytes * 0.7)
  const head = decodeUtf8Head(buffer, headBytes)
  const tail = decodeUtf8Tail(buffer, remainingBytes - headBytes)
  return { text: `${head}${marker}${tail}`, truncated: true, originalBytes }
}

function decodeUtf8Head(buffer: Buffer, maxBytes: number): string {
  for (let byteCount = maxBytes; byteCount >= 0; byteCount--) {
    const decoded = tryDecodeUtf8(buffer.subarray(0, byteCount))
    if (decoded !== undefined) {
      return decoded
    }
  }
  return ''
}

function decodeUtf8Tail(buffer: Buffer, maxBytes: number): string {
  const startByte = Math.max(0, buffer.length - maxBytes)
  for (let byteIndex = startByte; byteIndex <= buffer.length; byteIndex++) {
    const decoded = tryDecodeUtf8(buffer.subarray(byteIndex))
    if (decoded !== undefined) {
      return decoded
    }
  }
  return ''
}

function tryDecodeUtf8(buffer: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return undefined
  }
}

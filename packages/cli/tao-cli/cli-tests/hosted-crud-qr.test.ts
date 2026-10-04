import { Describe, Expect, Test } from '@shared/test'
import QRCode from 'qrcode'
import { renderTerminalQr } from '../cli-src/hosted-crud-qr'

const RESET = '\u001b[0m'
const CELL = /\u001b\[48;2;(0;0;0|255;255;255)m(?:\u001b\[38;2;0;0;0m([▀▄])|( ))/gu

Describe('hosted CRUD terminal QR', () => {
  Test('renders the exact URL matrix as black on white with a four-module quiet zone', () => {
    const url = 'exp://192.168.1.5:8081?token=case-sensitive%2Fvalue'
    const qr = QRCode.create(url)
    const width = qr.modules.size + 8
    const output = renderTerminalQr(url)
    Expect(output).toBeDefined()
    const lines = output!.split('\n')
    Expect(lines).toHaveLength(Math.ceil(width / 2))

    const pixels: boolean[][] = []
    for (const line of lines) {
      Expect(line.startsWith(RESET)).toBe(true)
      Expect(line.endsWith(RESET)).toBe(true)
      const body = line.slice(RESET.length, -RESET.length)
      const cells = [...body.matchAll(CELL)]
      Expect(cells).toHaveLength(width)
      Expect(body.replaceAll(CELL, '')).toBe('')
      const top: boolean[] = []
      const bottom: boolean[] = []
      for (const cell of cells) {
        const [color, glyph, space] = cell.slice(1)
        if (space) {
          top.push(color === '0;0;0')
          bottom.push(color === '0;0;0')
        } else {
          Expect(color).toBe('255;255;255')
          top.push(glyph === '▀')
          bottom.push(glyph === '▄')
        }
      }
      pixels.push(top, bottom)
    }

    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= 4 && x < width - 4 && y >= 4 && y < width - 4
        const expected = inside && qr.modules.data[(y - 4) * qr.modules.size + x - 4] === 1
        Expect(pixels[y]![x]).toBe(expected)
      }
    }
  })

  Test('omits the code when its final cell could wrap', () => {
    const url = 'exp://192.168.1.5:8081'
    const columns = QRCode.create(url).modules.size + 8
    Expect(renderTerminalQr(url, columns)).toBeUndefined()
    Expect(renderTerminalQr(url, columns + 1)).toBeDefined()
  })
})

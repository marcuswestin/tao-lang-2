import QRCode from 'qrcode'

const QUIET_ZONE = 4
const BLACK_BACKGROUND = '\u001b[48;2;0;0;0m'
const WHITE_BACKGROUND = '\u001b[48;2;255;255;255m'
const BLACK_FOREGROUND = '\u001b[38;2;0;0;0m'
const RESET = '\u001b[0m'

/** Pair QR rows in one terminal cell; solid modules use the cell background, not a glyph. */
export function renderTerminalQr(url: string, columns?: number): string | undefined {
  const { modules } = QRCode.create(url)
  const width = modules.size + QUIET_ZONE * 2
  // A full-width final cell can wrap before the explicit newline on some terminals.
  if (columns !== undefined && columns <= width) {
    return undefined
  }

  const dark = (x: number, y: number): boolean => {
    const moduleX = x - QUIET_ZONE
    const moduleY = y - QUIET_ZONE
    return moduleX >= 0 && moduleX < modules.size
      && moduleY >= 0 && moduleY < modules.size
      && modules.data[moduleY * modules.size + moduleX] === 1
  }

  const rows: string[] = []
  for (let y = 0; y < width; y += 2) {
    let row = RESET
    for (let x = 0; x < width; x++) {
      const top = dark(x, y)
      const bottom = dark(x, y + 1)
      row += top === bottom
        ? `${top ? BLACK_BACKGROUND : WHITE_BACKGROUND} `
        : `${WHITE_BACKGROUND}${BLACK_FOREGROUND}${top ? '▀' : '▄'}`
    }
    rows.push(row + RESET)
  }
  return rows.join('\n')
}

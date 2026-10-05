import { Text } from './core/shared-core'

// RxDB 17.5.0's Dexie console.warn advertisement. Match the complete text so storage diagnostics,
// changed notices, and incomplete output always remain visible.
const DEXIE_PROMOTION = [
  '-------------- RxDB Open Core RxStorage -------------------------------',
  'You are using the free Dexie.js based RxStorage implementation from RxDB https://rxdb.info/rx-storage-dexie.html?console=dexie',
  'While this is a great option, we want to let you know that there are faster storage solutions available in our premium plugins.',
  'For professional users and production environments, we highly recommend considering these premium options to enhance performance and reliability.',
  'https://rxdb.info/premium/?console=dexie',
  'If you already purchased premium access you can disable this log by calling the setPremiumFlag() function from rxdb-premium/plugins/shared.',
  '---------------------------------------------------------------------',
]
const EXPO_PREFIXES = ['', 'WARN ', 'LOG ', 'INFO ', '(NOBRIDGE) WARN ', '(NOBRIDGE) LOG ', '(NOBRIDGE) INFO ']

/** DevAppLogFilter suppresses only the known complete advertisement in displayed app logs. */
export class DevAppLogFilter {
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  private pending = ''
  private candidate: string[] = []
  private lineAlreadyShown = false

  static isPromotion(message: string): boolean {
    const lines = Text.stripAnsi(message).trim().split(/\r?\n/)
    return lines.length === DEXIE_PROMOTION.length
      && lines.every((line, index) => normalizedLine(line, index === 0) === DEXIE_PROMOTION[index])
  }

  /** write accepts arbitrary process chunk boundaries, retaining only a possible promotion. */
  write(chunk: string | Buffer): string {
    const text = typeof chunk === 'string'
      ? this.decoder.decode() + chunk
      : this.decoder.decode(chunk, { stream: true })
    return this.writeText(text)
  }

  private writeText(text: string): string {
    this.pending += text
    let output = ''
    let newline: number
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline + 1)
      this.pending = this.pending.slice(newline + 1)
      if (this.candidate.length > 0) {
        if (normalizedLine(line, false) === DEXIE_PROMOTION[this.candidate.length]) {
          this.candidate.push(line)
          if (this.candidate.length === DEXIE_PROMOTION.length) {
            this.candidate = []
          }
          continue
        }
        output += this.candidate.join('')
        this.candidate = []
      }
      if (!this.lineAlreadyShown && normalizedLine(line, true) === DEXIE_PROMOTION[0]) {
        this.candidate.push(line)
      } else {
        output += line
      }
      this.lineAlreadyShown = false
    }
    if (this.candidate.length > 0 && !couldContinuePromotion(this.pending, this.candidate.length)) {
      output += this.candidate.join('')
      this.candidate = []
    }
    if (this.candidate.length === 0 && (this.lineAlreadyShown || !couldStartPromotion(this.pending))) {
      output += this.pending
      this.lineAlreadyShown ||= this.pending.length > 0
      this.pending = ''
    }
    // A changed notice must not retain an arbitrarily large unterminated line.
    if (this.pending.length > 4_096) {
      output += this.releasePending()
    }
    return output
  }

  /** flush preserves incomplete notices when the process closes. */
  flush(): string {
    return this.writeText(this.decoder.decode()) + this.releasePending()
  }

  private releasePending(): string {
    const output = this.candidate.join('') + this.pending
    const promotion = this.candidate.length > 0 && DevAppLogFilter.isPromotion(output)
    this.candidate = []
    this.pending = ''
    this.lineAlreadyShown = false
    return promotion ? '' : output
  }
}

function normalizedLine(line: string, first: boolean): string {
  const plain = Text.stripAnsi(line).trim()
  return first ? plain.replace(/^(?:\(NOBRIDGE\)\s+)?(?:WARN|LOG|INFO)\s+/, '') : plain
}

function couldStartPromotion(pending: string): boolean {
  const plain = partialLine(pending).trimStart().replace(/[\t ]+/g, ' ')
  return EXPO_PREFIXES.some(prefix => `${prefix}${DEXIE_PROMOTION[0]}`.startsWith(plain))
}

function couldContinuePromotion(pending: string, index: number): boolean {
  return DEXIE_PROMOTION[index]!.startsWith(partialLine(pending).trim())
}

function partialLine(pending: string): string {
  return Text.stripAnsi(pending).replace(/\u001b(?:\[[\d;]*)?$/, '')
}

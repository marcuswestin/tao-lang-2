import { DevAppLogFilter } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { dexiePromotion } from './fixtures/dexie-promotion'

Describe('developer app-log display filter', () => {
  Test('suppresses the exact complete Dexie promotion across every process chunk split', () => {
    const text = `before\n\u001b[33m WARN \u001b[39m ${dexiePromotion}\nafter\n`
    for (let split = 0; split <= text.length; split++) {
      const filter = new DevAppLogFilter()
      Expect(filter.write(text.slice(0, split)) + filter.write(text.slice(split)) + filter.flush())
        .toBe('before\nafter\n')
    }
    const filter = new DevAppLogFilter()
    Expect([...text].map(character => filter.write(character)).join('') + filter.flush()).toBe('before\nafter\n')
    const noFinalNewline = new DevAppLogFilter()
    Expect(noFinalNewline.write(dexiePromotion) + noFinalNewline.flush()).toBe('')
  })

  Test('keeps real RxDB and native diagnostics, changed promotion text, and incomplete notices', () => {
    const notices = [
      ' WARN RxDB Dexie storage failed: quota exceeded\n',
      ' ERROR Native Firebase persistence unavailable\n',
      ` ERROR ${dexiePromotion}\n`,
      `${dexiePromotion.replace('reliability.', 'reliability. Storage failed.')}\n`,
      dexiePromotion.split('\n').slice(0, 5).join('\n'),
      `${dexiePromotion}\nadditional diagnostic`,
    ]
    for (const text of notices.slice(0, -1)) {
      for (let split = 0; split <= text.length; split++) {
        const filter = new DevAppLogFilter()
        Expect(filter.write(text.slice(0, split)) + filter.write(text.slice(split)) + filter.flush()).toBe(text)
      }
      Expect(DevAppLogFilter.isPromotion(text)).toBe(false)
    }
    Expect(DevAppLogFilter.isPromotion(notices.at(-1)!)).toBe(false)
    Expect(DevAppLogFilter.isPromotion(dexiePromotion)).toBe(true)
  })

  Test('passes ordinary unterminated progress through immediately', () => {
    const filter = new DevAppLogFilter()
    Expect(filter.write('Bundling 40%\r')).toBe('Bundling 40%\r')
    Expect(filter.flush()).toBe('')
  })

  Test('preserves Unicode diagnostics across every byte split and flushes final incomplete bytes', () => {
    const text = '\uFEFFWARN Native persistence unavailable: café, 東京, 😀\n'
    const bytes = Buffer.from(text)
    for (let split = 0; split <= bytes.length; split++) {
      const filter = new DevAppLogFilter()
      Expect(filter.write(bytes.subarray(0, split)) + filter.write(bytes.subarray(split)) + filter.flush()).toBe(text)
    }
    const oneByte = new DevAppLogFilter()
    Expect([...bytes].map(byte => oneByte.write(Buffer.from([byte]))).join('') + oneByte.flush()).toBe(text)
    const truncated = new DevAppLogFilter()
    Expect(truncated.write(Buffer.from([0xe2, 0x82]))).toBe('')
    Expect(truncated.flush()).toBe('\uFFFD')
  })

  Test('releases a possible promotion and partial diagnostic as soon as the next line disproves it', () => {
    const header = `${dexiePromotion.split('\n')[0]}\n`
    const diagnostic = '\u001b[31mERROR Native persistence unavailable'
    for (let split = 0; split <= diagnostic.length; split++) {
      const filter = new DevAppLogFilter()
      Expect(filter.write(header)).toBe('')
      Expect(filter.write(diagnostic.slice(0, split)) + filter.write(diagnostic.slice(split)))
        .toBe(header + diagnostic)
      Expect(filter.flush()).toBe('')
    }
  })
})

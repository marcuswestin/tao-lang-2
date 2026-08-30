import { Describe, Expect, Test } from '@shared/test'
import { StudioHighlight } from '../studio-src/StudioHighlight'
import { StudioTextMateLanguage } from '../studio-src/StudioTextMateLanguage'

Describe('Studio highlighting', () => {
  Test('tokenizes Tao and injected TypeScript through the generated TextMate grammar', async () => {
    const source = `
      view MainView() {
        render inject Count \`\`\`ts
          return <RN.Text accessibilityLabel="count">{Count + 1}</RN.Text>
        \`\`\`
      }
    `
    const tokens = await StudioHighlight.testing.tokenize(source)
    const tokenText = tokens.map(token => source.slice(token.from, token.to))
    const tokenColors = new Set(tokens.map(token => token.color).filter(Boolean))

    Expect(tokenText.some(text => text.includes('view'))).toBe(true)
    Expect(tokenText.some(text => text.includes('MainView'))).toBe(true)
    Expect(tokenText).toContain('return')
    Expect(tokenText.some(text => text.includes('<'))).toBe(true)
    Expect(tokenText.some(text => text.includes('RN'))).toBe(true)
    Expect(tokenText.some(text => text.includes('accessibilityLabel'))).toBe(true)
    Expect(tokenColors.size).toBeGreaterThan(1)
  })

  Test('builds safe CodeMirror decorations from server highlight tokens', () => {
    const decorations = StudioTextMateLanguage.testing.buildDecorations([
      { color: '#c792ea', from: 0, to: 4 },
      { color: '#82aaff', from: 5, to: 13 },
      { color: 'red; background: red', from: 14, to: 15 },
      { from: 16, to: 17 },
    ], 17)

    Expect(decorations.size).toBe(2)
  })
})

import { AST } from '@parser'
import { Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { insertValueEntryCommas } from '../source-actions-src/value-entry-actions'
import { parseDocument, parseRawDocument, sourceActionOptionsFor } from './test-source-actions'

/** migrates checks the exact comma edits before formatting and verifies a second pass has no edits. */
function migrates(source: string, expected: string): () => Promise<void> {
  return async () => {
    const document = await parseDocument(source)
    Expect(document.parseResult.lexerErrors).toEqual([])
    Expect(document.parseResult.parserErrors).toEqual([])
    const migrated = insertValueEntryCommas(document)
    Expect(migrated).toBe(`${Text.stripIndent(expected)}\n`)
    const reparsed = await parseRawDocument(migrated!)
    Expect(reparsed.parseResult.lexerErrors).toEqual([])
    Expect(reparsed.parseResult.parserErrors).toEqual([])
    Expect(insertValueEntryCommas(reparsed)).toBeUndefined()
  }
}

Describe('value entry commas', () => {
  Test(
    'separates same-line and nested item values',
    migrates(
      `
      let Value = item { First: 1 Second: item { Left: 2 Right: 3 } Third: 4 }
    `,
      `
      let Value = item { First: 1, Second: item { Left: 2, Right: 3 }, Third: 4 }
    `,
    ),
  )

  Test(
    'separates every configuration value branch and nested blocks',
    migrates(
      `
      let Value = nav {
         @home { Title "Home" Count 1 }
         Label: "named"
         Initial MainView
         Other { First 1 Second 2 }
         Catalog.Member,
         Selected,
         "literal" 4
         Nested.Member 5
      }
    `,
      `
      let Value = nav {
         @home { Title "Home", Count 1 },
         Label: "named",
         Initial MainView,
         Other { First 1, Second 2 },
         Catalog.Member,
         Selected,
         "literal", 4,
         Nested.Member 5
      }
    `,
    ),
  )

  Test(
    'ignores commas in line and block comments and in escaped text',
    migrates(
      `
      let Value = item { First: "escaped \\"quote\\", text" // comma, stays
         Second: 2 /* another, comma */ Third: 3 }
      let Settings = nav { First "comma," // configuration, comment
         Second 2 /* block, comment */ Third 3 }
    `,
      `
      let Value = item { First: "escaped \\"quote\\", text", // comma, stays
         Second: 2, /* another, comma */ Third: 3 }
      let Settings = nav { First "comma,", // configuration, comment
         Second 2, /* block, comment */ Third 3 }
    `,
    ),
  )

  Test(
    'retains existing commas even when comments separate them from values',
    migrates(
      `
      let Value = item { First: 1 /* comma, comment */, Second: 2 Third: 3 }
      let Settings = nav { First 1 // comma, comment
         , Second 2 Third 3 }
    `,
      `
      let Value = item { First: 1 /* comma, comment */, Second: 2, Third: 3 }
      let Settings = nav { First 1 // comma, comment
         , Second 2, Third 3 }
    `,
    ),
  )

  Test(
    'resets configuration value runs at each directive',
    migrates(
      `
      let Value = app with {
         First 1 Second 2
         Restore fresh
         Third 3 Fourth 4
         view MainView
         Fifth 5 Sixth 6
         requires @vendor/example version "1.0.0"
         Seventh 7 Eighth 8
         guard { error -> Text("failed") }
         Ninth 9 Tenth 10
      }
    `,
      `
      let Value = app with {
         First 1, Second 2
         Restore fresh
         Third 3, Fourth 4
         view MainView
         Fifth 5, Sixth 6
         requires @vendor/example version "1.0.0"
         Seventh 7, Eighth 8
         guard { error -> Text("failed") }
         Ninth 9, Tenth 10
      }
    `,
    ),
  )

  Test('leaves canonical values, empty values, declarations, and render children untouched', async () => {
    const document = await parseDocument(`
      type Record is {
         First number
         Second text
      }
      data Records / Row {
         First number,
         Second text
      }
      let EmptyItem = item { }
      let Item = item { First: 1, Second: 2 }
      let Settings = nav { First 1, Second 2 }
      let EmptySettings = nav { }
      view MainView() {
         render Column {
            Text("first")
            Text("second")
         }
      }
    `)
    Expect(document.parseResult.parserErrors).toEqual([])
    Expect(insertValueEntryCommas(document)).toBeUndefined()
  })

  Test('preserves trailing commas on recovered legacy source without adding another', async () => {
    // The old grammar rejects trailing value commas; the transform leaves that punctuation intact.
    const document = await parseRawDocument('let Value = item { First: 1, }\nlet Settings = nav { First 1, }\n')
    const nodes = AST.streamAllContents(document.parseResult.value)
    Expect(nodes.filter(AST.isItemLiteral).map(item => item.properties.length)).toEqual([1])
    Expect(nodes.filter(AST.isConfigurationBlock).map(block => block.entries.length)).toEqual([1])
    Expect(insertValueEntryCommas(document)).toBeUndefined()
  })

  Test('normal fixing preserves item values and configuration entries and is idempotent', async () => {
    const document = await parseDocument(`
      let Item = item { First: 1 Second: "two" }
      let Settings = nav {
         Initial MainView
         Routes {
            First 1
            Second 2
         }
      }
    `)
    const fixed = await SourceActions.fixSource(document, await sourceActionOptionsFor(document))
    Expect(fixed).toContain(Text.stripIndent(`
      let Item = item {
         First: 1,
         Second: "two"
      }
    `))
    Expect(fixed).toContain('Initial MainView,')
    Expect(fixed).toContain('First 1,\n      Second 2')
    const reparsed = await parseRawDocument(fixed)
    Expect(reparsed.parseResult.parserErrors).toEqual([])
    const nodes = AST.streamAllContents(reparsed.parseResult.value)
    const item = nodes.find(AST.isItemLiteral)!
    Expect(item.properties.map(property => property.label)).toEqual(['First', 'Second'])
    Expect(item.properties.map(property => property.value.$type)).toEqual(['NumberLiteral', 'StringLiteral'])
    Expect(AST.isNumberLiteral(item.properties[0]!.value) && item.properties[0]!.value.value).toBe(1)
    Expect(AST.isStringLiteral(item.properties[1]!.value) && item.properties[1]!.value.value).toBe('two')
    Expect(nodes.filter(AST.isConfigurationBlock).map(block => block.entries.map(entry => entry.name)))
      .toEqual([['Initial', 'Routes'], ['First', 'Second']])
    Expect(await SourceActions.fixSource(reparsed, await sourceActionOptionsFor(reparsed))).toBe(fixed)
  })
})

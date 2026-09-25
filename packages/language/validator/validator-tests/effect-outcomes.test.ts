import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { EffectOutcomesValidator } from '../validator-src/validators/effect-outcomes-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { app, rejects, stubContainer, stubView, testValidateCode } from './test-validate'

const messages = EffectOutcomesValidator.messages

const declarations = `
  ${stubContainer('Stack')}
  ${stubView('Text', 'Value text')}
  view Button(Press action()) { render Text("Press") }
  type ExportFailure is one of Offline, TooLarge
  type SaveFailure is one of Full
  action ExportDocument(Format text)
    fails Offline "Exporting needs a connection."
    fails TooLarge "This document is too long to export."
    from ./Export.ts
  action Save() { fail Full "The disk is full." }
  action SaveAndExport() {
    do Save()
    do ExportDocument(Format: "pdf")
  }
  action ExportOrQueue() {
    when do ExportDocument(Format: "pdf") {
      Offline -> { }
    }
  }
  action ExportQuietly() {
    when do ExportDocument(Format: "pdf") {
      rejected -> { }
    }
  }
  action Quiet() { }
`

function outcomesApp(body: string, extra = ''): string {
  return app(`state Failure = "" ${body}`, `${declarations}${extra}`)
}

async function warnings(source: string): Promise<string[]> {
  const result = await testValidateCode(source)
  return Diagnostics.messages(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning'))
}

Describe('validator: effect outcomes', () => {
  Test('accepts saved, a declared case, rejected, and error with their payloads', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button() {
          on press -> {
            when do ExportDocument(Format: "pdf") {
              saved -> { set Failure = "" }
              Offline -> Problem { set Failure = Problem }
              rejected -> Problem { set Failure = Problem }
              error -> Message { set Failure = Message }
            }
          }
        }
      }
    `))
    Expect(found).toEqual([])
  })

  Test(
    'rejects a case the verb does not declare',
    rejects(
      outcomesApp(`
        action Run() {
          when do ExportDocument(Format: "pdf") { Full -> { } }
        }
        render Text("Ready")
      `),
      messages.unknownOutcome('Full', '`ExportDocument`'),
    ),
  )

  Test(
    'rejects an outcome named twice',
    rejects(
      outcomesApp(`
        action Run() {
          when do Save() {
            saved -> { }
            saved -> { }
          }
        }
        render Text("Ready")
      `),
      messages.duplicateOutcome('saved'),
    ),
  )

  Test(
    'rejects a payload on saved',
    rejects(
      outcomesApp(`
        action Run() {
          when do Save() { saved -> Result { } }
        }
        render Text("Ready")
      `),
      messages.savedPayload,
    ),
  )

  Test(
    'rejects a check inside an outcome block, which would stop only that block',
    rejects(
      outcomesApp(`
        action Run() {
          when do Save() { saved -> { check Failure is empty } }
        }
        render Text("Ready")
      `),
      FunctionalCoreValidator.messages.checkPlacement,
    ),
  )

  Test('accepts a case the verb reaches through a plain do', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button() {
          on press -> {
            when do SaveAndExport() {
              Full -> { }
              Offline -> { }
              TooLarge -> { }
            }
          }
        }
      }
    `))
    Expect(found).toEqual([])
  })

  Test('warns at an unhandled root invocation and names every case', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button() { on press -> { do ExportDocument(Format: "pdf") } }
        Button() { on press SaveAndExport }
      }
    `))
    Expect(found).toEqual([
      messages.unhandledFailure('`ExportDocument`', ['Offline', 'TooLarge']),
      messages.unhandledFailure('`SaveAndExport`', ['Full', 'Offline', 'TooLarge']),
    ])
  })

  Test('subtracts the cases a when do inside the verb handles', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button() { on press ExportOrQueue }
        Button() { on press ExportQuietly }
        Button() { on press Quiet }
      }
    `))
    Expect(found).toEqual([messages.unhandledFailure('`ExportOrQueue`', ['TooLarge'])])
  })

  Test('warns at a root when do for the cases it leaves unhandled', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button() {
          on press -> {
            when do ExportDocument(Format: "pdf") { Offline -> { } }
          }
        }
      }
    `))
    Expect(found).toEqual([messages.unhandledOutcome('`ExportDocument`', ['TooLarge'])])
  })

  Test('does not warn at a plain do inside another action', async () => {
    const found = await warnings(outcomesApp(`
      action Run() { do ExportDocument(Format: "pdf") }
      render Text("Ready")
    `))
    Expect(found).toEqual([])
  })

  Test('warns at a command do clause and an on select handler', async () => {
    const found = await warnings(outcomesApp(
      `
        render Stack() {
          loop ["One"] / Row {
            Text(Row)
            on select -> { do Save() }
          }
        }
      `,
      `
        command Export() {
          Title "Export"
          do ExportDocument(Format: "pdf")
        }
      `,
    ))
    Expect(found).toEqual([
      messages.unhandledFailure('`Save`', ['Full']),
      messages.unhandledFailure('`ExportDocument`', ['Offline', 'TooLarge']),
    ])
  })
})

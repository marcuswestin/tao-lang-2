import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { EffectOutcomesValidator } from '../validator-src/validators/effect-outcomes-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { app, rejects, stubContainer, stubView, testValidateCode, validationErrorMessages } from './test-validate'

const messages = EffectOutcomesValidator.messages

const declarations = `
  ${stubContainer('Stack')}
  ${stubView('Text', 'Value text')}
  view Button(Title text, Press action()) { render Text(Title) }
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
  action ExportPartly() {
    do ExportDocument(Format: "pdf") then { Offline -> { } }
  }
  action ExportHandled() {
    do ExportDocument(Format: "pdf") then {
      Offline -> { }
      TooLarge -> { }
      error -> Message { }
    }
  }
  action Cleanup() { fail Full "The cleanup failed." }
  action CleanupAtExit() { defer Cleanup() }
  action CleanupInBlock() { defer { do Cleanup() } }
  action Quiet() { }
`

function outcomesApp(body: string, extra = ''): string {
  return app(`state Failure = "" ${body}`, `${declarations}${extra}`)
}

async function validated(source: string): Promise<{ errors: string[]; warnings: string[] }> {
  const result = await testValidateCode(source)
  return {
    errors: validationErrorMessages(result),
    warnings: Diagnostics.messages(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')),
  }
}

async function warnings(source: string): Promise<string[]> {
  return (await validated(source)).warnings
}

Describe('validator: effect outcomes', () => {
  Test('accepts saved, a declared case, rejected, and error with their payloads', async () => {
    const found = await validated(outcomesApp(`
      render Stack() {
        Button(Title: "Press") {
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
    Expect(found).toEqual({ errors: [], warnings: [] })
  })

  Test('accepts selected `then` outcomes and requires no payload on done or cancelled', async () => {
    const found = await validated(outcomesApp(`
      render Stack() {
        Button(Title: "Press") {
          on press -> {
            do ExportDocument(Format: "pdf") then {
              done -> { set Failure = "" }
              Offline -> { set Failure = "offline" }
              error -> Message { set Failure = Message }
              cancelled -> { set Failure = "cancelled" }
              otherwise -> { set Failure = "other" }
            }
          }
        }
      }
    `))
    Expect(found).toEqual({ errors: [], warnings: [] })
  })

  Test(
    'rejects a payload on done',
    rejects(
      outcomesApp(`
        action Run() { do Save() then { done -> Result { } } }
        render Text("Ready")
      `),
      messages.donePayload,
    ),
  )

  Test(
    'rejects a legacy outcome word in a `then` continuation',
    rejects(
      outcomesApp(`
        action Run() { do Save() then { saved -> { } } }
        render Text("Ready")
      `),
      messages.unknownOutcome('saved', '`Save`', true),
    ),
  )

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
    const found = await validated(outcomesApp(`
      render Stack() {
        Button(Title: "Press") {
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
    Expect(found).toEqual({ errors: [], warnings: [] })
  })

  Test('warns at an unhandled root invocation and names every case', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button(Title: "Press") { on press -> { do ExportDocument(Format: "pdf") } }
        Button(Title: "Press") { on press SaveAndExport }
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
        Button(Title: "Press") { on press ExportOrQueue }
        Button(Title: "Press") { on press ExportQuietly }
        Button(Title: "Press") { on press Quiet }
      }
    `))
    Expect(found).toEqual([messages.unhandledFailure('`ExportOrQueue`', ['TooLarge'])])
  })

  Test('subtracts named `then` failures and keeps the open remainder until error or otherwise', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button(Title: "Press") { on press ExportPartly }
        Button(Title: "Press") { on press ExportHandled }
      }
    `))
    Expect(found).toEqual([messages.unhandledFailure('`ExportPartly`', ['TooLarge'])])
  })

  Test('includes failures from both defer forms in the owning action contract', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button(Title: "Press") { on press CleanupAtExit }
        Button(Title: "Press") { on press CleanupInBlock }
      }
    `))
    Expect(found).toEqual([
      messages.unhandledFailure('`CleanupAtExit`', ['Full']),
      messages.unhandledFailure('`CleanupInBlock`', ['Full']),
    ])
  })

  Test('warns at a root when do for the cases it leaves unhandled', async () => {
    const found = await warnings(outcomesApp(`
      render Stack() {
        Button(Title: "Press") {
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
  Test('keeps an async block out of the enclosing action contract', async () => {
    const found = await warnings(outcomesApp(
      `
        render Stack() {
          Button(Title: "Press") { on press Deferred }
        }
      `,
      'action Deferred() { async { when do ExportDocument(Format: "pdf") { rejected -> { } } } }',
    ))
    Expect(found).toEqual([])
  })

  Test(
    'rejects naming an async-only case at a caller that can never catch it',
    rejects(
      outcomesApp(
        `
          action Run() {
            when do Deferred() { Offline -> { } }
          }
          render Text("Ready")
        `,
        'action Deferred() { async { do ExportDocument(Format: "pdf") } }',
      ),
      messages.unknownOutcome('Offline', '`Deferred`'),
    ),
  )

  Test('warns at a plain do directly inside an async block, which runs as its own root', async () => {
    const found = await warnings(outcomesApp(`
      action Run() {
        async { do ExportDocument(Format: "pdf") }
      }
      render Text("Ready")
    `))
    Expect(found).toEqual([messages.unhandledFailure('`ExportDocument`', ['Offline', 'TooLarge'])])
  })

  Test(
    'rejects a named case for a dynamic verb, whose contract is unknown',
    rejects(
      outcomesApp(`
        action Run(Callback action()) {
          when do Callback() { Offline -> { } }
        }
        render Text("Ready")
      `),
      messages.unknownOutcome('Offline', 'this action'),
    ),
  )
})

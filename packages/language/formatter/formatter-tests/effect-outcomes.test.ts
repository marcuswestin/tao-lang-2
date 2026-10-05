import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { formats } from './test-format'

Describe('formatter: effect outcomes', () => {
  Test('formats `when do` with one outcome per line and short outcome blocks on one line', async () => {
    Expect(
      await Formatter.formatCode(
        'view Main(){state Failure="" action Run(){when do Export( Format:"pdf" ){saved->{set Failure=""}Offline->{set Failure="offline"\nset Failure="twice"}rejected->Problem{set Failure=Problem}error  ->  Message{set Failure=Message}}}}',
      ),
    ).toBe(
      [
        'view Main() {',
        '   state Failure = ""',
        '   action Run() {',
        '      when do Export(Format: "pdf") {',
        '         saved -> { set Failure = "" }',
        '         Offline -> {',
        '            set Failure = "offline"',
        '            set Failure = "twice"',
        '         }',
        '         rejected -> Problem { set Failure = Problem }',
        '         error -> Message { set Failure = Message }',
        '}  }  }',
        '',
      ].join('\n'),
    )
  })

  Test(
    'formats `then` continuations and both defer forms',
    formats(
      'action Save(){} action Delete(File text){} action Run(){do Save() then{done->{ } Full->Message{} error->Message{} cancelled->{} otherwise->{ }} defer{do Delete(File:"old")} defer Delete(File:"later")}',
      `
      action Save() { }

      action Delete(File text) { }

      action Run() {
         do Save() then {
            done -> { }
            Full -> Message { }
            error -> Message { }
            cancelled -> { }
            otherwise -> { }
         }
         defer {
            do Delete(File: "old")
         }
         defer Delete(File: "later")
      }
    `,
    ),
  )

  Test(
    'formats bar-form `then` outcomes as one indented arm per line',
    formats(
      'action Save(){} action Run(){do Save() then|done->{ }|otherwise->{ }}',
      `
      action Save() { }

      action Run() {
         do Save() then
            | done -> { }
            | otherwise -> { }
      }
    `,
    ),
  )

  Test(
    'formats left-side result and failure bindings with async and single-action bodies',
    async () => {
      const formatted = await Formatter.formatCode(
        'action Export(){} action Notify(Value text){} action Run(){do Export() then{done Duration->async{do Notify(Duration)} error Problem->do Notify(Problem)}}',
      )
      Expect(formatted).toBe([
        'action Export() { }',
        '',
        'action Notify(Value text) { }',
        '',
        'action Run() {',
        '   do Export() then {',
        '      done Duration -> async {',
        '         do Notify(Duration)',
        '      }',
        '      error Problem -> do Notify(Problem)',
        '}  }',
        '',
      ].join('\n'))
    },
  )
})

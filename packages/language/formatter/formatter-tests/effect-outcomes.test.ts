import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'

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
})

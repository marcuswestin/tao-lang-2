import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: numeric units', () => {
  Test(
    'formats owned unit tables and default markers with stable commas',
    formats(
      'type Measure is numeric with{units{seconds 1(default),minutes 60}}',
      `
      type Measure is numeric with {
         units {
            seconds 1 (default),
            minutes 60
         }
      }
    `,
    ),
  )
  Test(
    'preserves ordered with-body entries around the unit table',
    formats(
      'type Measure is numeric with{Label text,units{seconds 1(default)},Other number}',
      `
      type Measure is numeric with {
         Label text,
         units {
            seconds 1 (default)
         },
         Other number
      }
    `,
    ),
  )
  Test(
    'formats invalid signed scales without changing their sign',
    formats(
      'type Measure is numeric with{units{seconds - 1(default),other 0}}',
      `
      type Measure is numeric with {
         units {
            seconds -1 (default),
            other 0
         }
      }
    `,
    ),
  )
  Test(
    'preserves a last unit table closing without changing ordinary closing-brace groups',
    formats(
      `type Measure is numeric with{Label text,units{seconds 1(default)}}
       function Read(Value boolean){if Value{return "ordinary"}}`,
      `
      type Measure is numeric with {
         Label text,
         units {
            seconds 1 (default)
         }
      }

      func Read(Value boolean) {
         if Value {
            return "ordinary"
      }  }
    `,
    ),
  )
  Test('retains signed and grouped suffix precedence and the linked AST after formatting', async () => {
    const source = `
      type Measure is numeric with{units{seconds 1(default)}}
      let Signed=-2   Measure.seconds
      let Grouped=(1+2)   Measure.seconds
      let Negated=-(2   Measure.seconds)
    `
    const formatted = await formats(
      source,
      `
      type Measure is numeric with {
         units {
            seconds 1 (default)
         }
      }

      let Signed = -2 Measure.seconds
      let Grouped = (1 + 2) Measure.seconds
      let Negated = -(2 Measure.seconds)
    `,
    )()
    for (const text of [source, formatted]) {
      const parsed = await Parser.parseCode(text)
      Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
      const aliases = parsed.entry.ast.statements.filter(AST.isAliasDeclaration)
      const signed = aliases.find(alias => alias.name === 'Signed')!.value
      Expect.Is(signed, AST.isNumericUnitConstruction)
      Expect.Is(signed.input, AST.isUnaryExpression)
      Expect(signed.input.operator).toBe('-')
      Expect.Is(signed.input.operand, AST.isNumberLiteral)
      Expect(signed.input.operand.value).toBe(2)
      Expect(signed.unit.ref?.name).toBe('seconds')
      const grouped = aliases.find(alias => alias.name === 'Grouped')!.value
      Expect.Is(grouped, AST.isNumericUnitConstruction)
      Expect.Is(grouped.input, AST.isBinaryExpression)
      Expect(grouped.input.operator).toBe('+')
      Expect(grouped.unit.ref?.name).toBe('seconds')
      const negated = aliases.find(alias => alias.name === 'Negated')!.value
      Expect.Is(negated, AST.isUnaryExpression)
      Expect(negated.operator).toBe('-')
      Expect.Is(negated.operand, AST.isNumericUnitConstruction)
      Expect(negated.operand.unit.ref?.name).toBe('seconds')
    }
  })
})

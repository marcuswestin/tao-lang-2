import { Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { canonicalFunctionSource } from '../formatter-src/formatters/AssociatedMethodsFormatter'
import { formats } from './test-format'

Describe('associated methods formatter', () => {
  Test(
    'formats text-derived receivers, inherited types, structural requirements and forwarding calls',
    formats(
      `type Token is text with{func ToText( )fails never->text{return "token:{Token}"}}\ntype Label is text with{func ToText( )->text{return "label:{Label}"}}\ntype Child is Token\ncan Display{ToText( )fails never->text}\nfunc Relay(Value Display)fails never->Display{return Value}\nfunc Show(Value Display)->text{return Relay(Value) . ToText ( )}\nlet First=Token "a"\nlet Second=Label "b"\nlet Inherited=Child "c"\nlet FirstText=Show(First)\nlet SecondText=Show(Second)\nlet InheritedText=Show(Inherited)`,
      `
        type Token is text with {
           func ToText() fails never -> text {
              return "token:{ Token }"
           }
        }

        type Label is text with {
           func ToText() -> text {
              return "label:{ Label }"
           }
        }

        type Child is Token

        can Display {
           ToText() fails never -> text
        }

        func Relay(Value Display) fails never -> Display {
           return Value
        }

        func Show(Value Display) -> text {
           return Relay(Value).ToText()
        }

        let First = Token "a"
        let Second = Label "b"
        let Inherited = Child "c"
        let FirstText = Show(First)
        let SecondText = Show(Second)
        let InheritedText = Show(Inherited)
      `,
    ),
  )

  Test(
    'formats inferred results, multiple signatures and parameter shadowing inside associated methods',
    formats(
      `can Display{ToText( )->text,Prefix(Value text)fails never->text}\ntype Token is text with{func ToText( ){return Token}func Prefix(Token text)fails never->text{return Token}}\nfunc Show(Value Display){return Value . ToText ( )}`,
      `
        can Display {
           ToText() -> text,
           Prefix(Value text) fails never -> text
        }

        type Token is text with {
           func ToText() {
              return Token
           }

           func Prefix(Token text) fails never -> text {
              return Token
           }
        }

        func Show(Value Display) {
           return Value.ToText()
        }
      `,
    ),
  )

  Test(
    'formats legacy declarations with canonical function keywords while preserving comments and literal text',
    formats(
      `// function Label returns text\nfunction Label(Value text)fails never returns text{return "function returns {Value}"}`,
      `
        // function Label returns text
        func Label(Value text) fails never -> text {
           return "function returns { Value }"
        }
      `,
    ),
  )

  Test('migrates legacy function keywords while preserving comments and literal text', async () => {
    const source =
      '// function Label returns text\nfunction Label(Value text)fails never returns text{return "function returns {Value}"}'
    const expected =
      '// function Label returns text\nfunc Label(Value text)fails never -> text{return "function returns {Value}"}'
    const parsed = await Parser.parseCode(source, { validation: false })
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    Expect(canonicalFunctionSource(parsed.entry.document)).toBe(expected)
    const migrated = await Parser.parseCode(expected, { validation: false })
    Expect(migrated.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(migrated.entry.document.parseResult.parserErrors).toEqual([])
    Expect(canonicalFunctionSource(migrated.entry.document)).toBeUndefined()
  })
})

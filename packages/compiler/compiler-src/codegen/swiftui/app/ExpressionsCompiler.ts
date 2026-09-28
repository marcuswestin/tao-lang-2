import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { Compile } from '../Compile'

export const ExpressionsCompiler = {
  Expression(value: AST.Expression): string {
    Assert(
      AST.isNumberLiteral(value) || AST.isStringLiteral(value) || AST.isBooleanLiteral(value)
        || AST.isValueReference(value) || AST.isBinaryExpression(value) || AST.isUnaryExpression(value)
        || AST.isInterpolatedString(value),
      'validated Swift expression has an emitter',
    )
    return Switch.type(value, {
      NumberLiteral: number => {
        const literal = String(number.value)
        return Number.isInteger(number.value) && !/[eE]/.test(literal) ? `${literal}.0` : literal
      },
      StringLiteral: text => Compile.String(text.value),
      BooleanLiteral: boolean => boolean.value,
      ValueReference: reference => {
        Assert(
          AST.isStateDeclaration(reference.target.ref) || AST.isAliasDeclaration(reference.target.ref),
          'validated Swift scalar reference resolves',
        )
        return Compile.Name(reference.target.ref)
      },
      BinaryExpression: binary => {
        if (binary.operator === '==' || binary.operator === '!=') {
          const left = Compile.Expression(binary.left)
          const right = Compile.Expression(binary.right)
          const type = Type.ofExpression(binary.left)
          if (type.kind === 'primitive' && (type.primitive === 'number' || type.primitive === 'text')) {
            const equality = `TaoValues.equal(${left}, ${right})`
            return binary.operator === '==' ? equality : `!${equality}`
          }
          return `(${left} ${binary.operator} ${right})`
        }
        const operator = binary.operator === 'and' ? '&&' : binary.operator === 'or' ? '||' : binary.operator
        return `(${Compile.Expression(binary.left)} ${operator} ${Compile.Expression(binary.right)})`
      },
      UnaryExpression: unary => `(${unary.operator === 'not' ? '!' : '-'}${Compile.Expression(unary.operand)})`,
      InterpolatedString: text =>
        `(${
          text.parts.map(part =>
            Switch.type(part, {
              InterpolatedStringText: part => Compile.String(part.value),
              StringInterpolation: interpolation => `TaoValues.text(${Compile.Expression(interpolation.expression)})`,
            })
          ).join(' + ')
        })`,
    })
  },

  Name(value: { name: string }): string {
    return `tao_${value.name}`
  },

  String(value: string): string {
    return `"${
      Array.from(value, character => {
        if (character === '"' || character === '\\') {
          return `\\${character}`
        }
        const code = character.codePointAt(0)!
        return code < 32 || code === 127 ? `\\u{${code.toString(16)}}` : character
      }).join('')
    }"`
  },
} as const

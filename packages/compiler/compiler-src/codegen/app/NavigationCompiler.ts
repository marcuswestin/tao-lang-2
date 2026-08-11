import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

/** NavigationCompiler lowers declared destination stacks and navigation actions to TR.Navigation. */
export const NavigationCompiler = {
  StackDeclaration(stack: AST.StackDeclaration): Compiled {
    return gen`
      ${gen.scopeName(stack)} = TR.Navigation.Stack({
        name: ${gen.jsLiteral(stack.name)},
        initial: ${gen.jsLiteral(stack.block.initial.destinationName)},
        destinations: {
          ${gen.list(stack.block.destinations, Compile.NavigationDestination)}
        },
      })
    `
  },

  NavigationDestination(destination: AST.NavigationDestination): Compiled {
    const view = resolveRef(destination.view)
    return gen`
      [${gen.jsLiteral(view.name)}]: {
        render: (_NavigationArguments, _NavigationProps) =>
          <${gen.scopeName(view)}${
      gen.join(AST.parametersOf(view), parameter => {
        const name = Type.parameterName(parameter)
        return gen` ${gen.Name({ name })}={_NavigationArguments[${gen.jsLiteral(name)}]}`
      }, { separator: '' })
    } __tao={_NavigationProps} />,
      },
    `
  },

  PresentStatement(presentation: AST.PresentStatement): Compiled {
    const resolved = ASTUtils.resolveNavigationInvocation(presentation)
    Assert.defined(resolved.stack, 'validated navigation presentation resolves its stack')
    Assert.defined(resolved.view, 'validated navigation presentation resolves its destination view')
    Assert(resolved.diagnostics.length === 0, 'validated navigation presentation has no binding diagnostics')
    return gen`TR.Navigation.Present(
      ${gen.scopeName(resolved.stack)},
      ${gen.jsLiteral(resolved.view.name)},
      { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
    )`
  },

  NavigationArgument(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen`[${gen.jsLiteral(Type.parameterName(pair.parameter))}]: ${Compile.Argument(pair.argument)},`
  },

  BackStatement(back: AST.BackStatement): Compiled {
    return gen`TR.Navigation.Back(${gen.scopeName(resolveRef(back.stack))})`
  },
} as const

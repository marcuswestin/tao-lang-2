import { type CstNode, DefaultValueConverter, GrammarAST, ValueConverter } from 'langium'

/** TaoValueConverter decodes escapes in the quote-free text tokens of interpolated strings. */
export class TaoValueConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode) {
    if (rule.name === 'STRING_TEXT') {
      return ValueConverter.convertString(`"${input}"`)
    }
    return super.runConverter(rule, input, cstNode)
  }
}

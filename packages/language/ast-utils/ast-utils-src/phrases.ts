import { AST } from '@parser'
import { Type } from './Type'

/** PluralCategory declares the CLDR plural categories a phrase's forms may use (Decisions §14). */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** pluralCategories lists every CLDR category a phrase form may name, in CLDR's own order. */
export const pluralCategories: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other']

/** isPluralCategory narrows a parsed phrase form category to a known CLDR category. */
export function isPluralCategory(category: string): category is PluralCategory {
  return (pluralCategories as readonly string[]).includes(category)
}

/** phraseIsPlural reports whether a phrase declares CLDR-category forms rather than one string. */
export function phraseIsPlural(phrase: AST.PhraseDeclaration): boolean {
  return phrase.forms.length > 0
}

/** phraseNumberParameters returns every `number`-typed parameter a phrase declares. */
export function phraseNumberParameters(phrase: AST.PhraseDeclaration): AST.ParameterDeclaration[] {
  return AST.parametersOf(phrase).filter(parameter => {
    const type = Type.ofParameter(parameter)
    return type.kind === 'primitive' && type.primitive === 'number'
  })
}

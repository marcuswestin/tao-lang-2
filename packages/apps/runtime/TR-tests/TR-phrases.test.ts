import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR phrases', () => {
  Test("selects the running locale's CLDR category, falling back to other", () => {
    const forms: TR.PluralForms = {
      one: TR.Value('1 item'),
      other: TR.Value('N items'),
    }

    Expect(TR.Plural(TR.Value(0), forms).jsValue).toBe('N items')
    Expect(TR.Plural(TR.Value(1), forms).jsValue).toBe('1 item')
    Expect(TR.Plural(TR.Value(2), forms).jsValue).toBe('N items')
  })

  Test('defaults to English when no locale is given', () => {
    const forms: TR.PluralForms = {
      one: TR.Value('one'),
      other: TR.Value('other'),
    }

    Expect(TR.Plural(TR.Value(1), forms).jsValue).toBe('one')
    Expect(TR.Plural(TR.Value(1), forms, 'en').jsValue).toBe(TR.Plural(TR.Value(1), forms).jsValue)
  })

  Test('selects a locale whose CLDR rules differ from English (Polish few/many)', () => {
    // Polish: one -> 1; few -> 2-4 (excluding 12-14); many -> 0, 5-21, ...; other -> fractions.
    const forms: TR.PluralForms = {
      one: TR.Value('one'),
      few: TR.Value('few'),
      many: TR.Value('many'),
      other: TR.Value('other'),
    }

    Expect(TR.Plural(TR.Value(1), forms, 'pl').jsValue).toBe('one')
    Expect(TR.Plural(TR.Value(2), forms, 'pl').jsValue).toBe('few')
    Expect(TR.Plural(TR.Value(5), forms, 'pl').jsValue).toBe('many')
    Expect(TR.Plural(TR.Value(0), forms, 'pl').jsValue).toBe('many')
  })

  Test('falls back to other when the selected category has no form', () => {
    // Arabic distinguishes zero/one/two/few/many/other; a table missing `few` still resolves.
    const forms: TR.PluralForms = {
      other: TR.Value('other'),
    }

    Expect(TR.Plural(TR.Value(3), forms, 'ar').jsValue).toBe('other')
  })
})

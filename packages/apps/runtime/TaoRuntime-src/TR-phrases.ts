/** TaoPluralCategory declares the CLDR plural categories a compiled phrase's forms may carry. */
export type TaoPluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** TaoPluralForms is a compiled phrase's category-to-text table; `other` is always present. */
export type TaoPluralForms<T> = Partial<Record<TaoPluralCategory, T>> & { other: T }

/**
 * selectPluralForm reads the running locale's CLDR category for `count` and returns that form,
 * falling back to `other` when the locale has no form for the selected category. The locale
 * defaults to English when the caller has none to offer (Decisions §14).
 */
export function selectPluralForm<T>(count: number, forms: TaoPluralForms<T>, locale?: string): T {
  const category = pluralRulesFor(locale ?? 'en').select(count) as TaoPluralCategory
  return forms[category] ?? forms.other
}

// Constructing an Intl.PluralRules is the expensive part and its result depends only on the
// locale, so one instance per locale is kept for the process: both are immutable, so sharing them
// is invisible to a caller (mirrors TR-interaction-labels's collator/segmenter caches).
const pluralRulesByLocale = new Map<string, Intl.PluralRules>()

function pluralRulesFor(locale: string): Intl.PluralRules {
  const cached = pluralRulesByLocale.get(locale)
  if (cached) {
    return cached
  }
  const rules = new Intl.PluralRules(locale)
  pluralRulesByLocale.set(locale, rules)
  return rules
}

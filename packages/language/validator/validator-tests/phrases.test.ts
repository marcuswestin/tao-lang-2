import { Describe, Test } from '@shared/test'
import { PhrasesValidator } from '../validator-src/validators/phrases-validator'
import { accepts, app, rejects, stubContainer, stubView } from './test-validate'

const runtimeViews = `${stubContainer('Stack')}${stubView('Text', 'Value text')}`

function phraseApp(body: string, declarations = ''): string {
  return `${declarations}\n${app(body, runtimeViews)}`
}

Describe('validator: phrases', () => {
  Test(
    'accepts a single-form phrase, a parameterless phrase, and a plural phrase',
    accepts(
      phraseApp(
        'render Stack(){ Text(WeekTitle("Monday")) Text(DocumentGone) Text(ItemCount(3)) }',
        `
        phrase WeekTitle(Day text) = "Week of { Day }"
        phrase DocumentGone = "That document is gone."
        phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
        `,
      ),
    ),
  )

  Test(
    'accepts a parameterless phrase called with explicit empty parentheses',
    accepts(
      phraseApp(
        'render Text(DocumentGone())',
        'phrase DocumentGone = "That document is gone."',
      ),
    ),
  )

  Test(
    'rejects a plural phrase missing its other form',
    rejects(
      phraseApp(
        'render Text(ItemCount(3))',
        'phrase ItemCount(Count number) = one "{ Count } item"',
      ),
      PhrasesValidator.messages.phraseMissingOther('ItemCount'),
    ),
  )

  Test(
    'rejects a plural phrase with a duplicate category',
    rejects(
      phraseApp(
        'render Text(ItemCount(3))',
        'phrase ItemCount(Count number) = other "{ Count } items" / other "{ Count } more"',
      ),
      PhrasesValidator.messages.phraseDuplicateCategory('ItemCount', 'other'),
    ),
  )

  Test(
    'rejects a plural phrase with an unknown category',
    rejects(
      phraseApp(
        'render Text(ItemCount(3))',
        'phrase ItemCount(Count number) = several "{ Count } items" / other "{ Count } items"',
      ),
      PhrasesValidator.messages.phraseUnknownCategory('ItemCount', 'several'),
    ),
  )

  Test(
    'rejects a plural phrase with no number parameter',
    rejects(
      phraseApp(
        'render Text(ItemCount("x"))',
        'phrase ItemCount(Count text) = one "{ Count } item" / other "{ Count } items"',
      ),
      PhrasesValidator.messages.phraseNumberParameterCount('ItemCount'),
    ),
  )

  Test(
    'rejects a plural phrase with two number parameters',
    rejects(
      phraseApp(
        'render Text(ItemCount(1, 2))',
        'phrase ItemCount(Count number, Total number) = one "{ Count } item" / other "{ Count } items"',
      ),
      PhrasesValidator.messages.phraseNumberParameterCount('ItemCount'),
    ),
  )

  Test(
    'rejects an unknown hole in a phrase body',
    rejects(
      phraseApp(
        'render Text(WeekTitle("Monday"))',
        'phrase WeekTitle(Day text) = "Week of { Missing }"',
      ),
      "No value named 'Missing' is in scope.",
    ),
  )

  Test(
    'rejects a phrase call missing a required argument',
    rejects(
      phraseApp(
        'render Text(WeekTitle())',
        'phrase WeekTitle(Day text) = "Week of { Day }"',
      ),
      PhrasesValidator.messages.phraseMissingArgument('WeekTitle', 'Day'),
    ),
  )

  Test(
    'rejects a phrase declared inside a view body',
    rejects(
      phraseApp('phrase Inline = "Nested" render Text(Inline)'),
      PhrasesValidator.messages.phrasePlacement,
    ),
  )

  Test(
    'rejects a duplicate phrase parameter name',
    rejects(
      phraseApp(
        'render Text(Greeting("a", "b"))',
        'phrase Greeting(Name text, Name text) = "Hi { Name }"',
      ),
      PhrasesValidator.messages.duplicatePhraseParameter('Name'),
    ),
  )
})

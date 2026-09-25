import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('phrases formatter', () => {
  Test(
    'formats a single-form phrase, a parameterless phrase, and a plural phrase',
    formats(
      `phrase WeekTitle(Day text)="Week of {Day}"\nphrase DocumentGone="That document is gone."\nphrase ItemCount(Count number)=one"{Count} item"/other"{Count} items"`,
      `
        phrase WeekTitle(Day text) = "Week of { Day }"

        phrase DocumentGone = "That document is gone."

        phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"
      `,
    ),
  )

  Test(
    'keeps phrase call parentheses tight',
    formats(
      `view Main(){render Text(ItemCount( 3 ))}\nphrase ItemCount(Count number)=one "{Count} item"/other "{Count} items"\nview Text(Value text){render inject \`\`\`ts\nreturn null\n\`\`\`}`,
      `
        view Main() {
           render Text(ItemCount(3))
        }

        phrase ItemCount(Count number) = one "{ Count } item" / other "{ Count } items"

        view Text(Value text) {
           render inject \`\`\`ts
              return null
           \`\`\`
        }
      `,
    ),
  )
})

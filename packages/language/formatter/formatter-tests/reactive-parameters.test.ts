import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: reactive parameters', () => {
  Test(
    'formats parameter modifiers and writable field paths',
    formats(
      'view Editor(copy Draft text,mutable Value text)from ./Editor.tsx\nstate Draft=Record{Title:"draft"}\naction Save(){set Draft.Title="saved"}',
      `
        view Editor(copy Draft text, mutable Value text) from ./Editor.tsx

        state Draft = Record {
           Title: "draft"
        }

        action Save() {
           set Draft.Title = "saved"
        }
      `,
    ),
  )

  Test(
    'formats creates and updates from a projected input with one space around with',
    formats(
      'action Save(){create Note  with   Input update Note   with Input}',
      `
        action Save() {
           create Note with Input
           update Note with Input
        }
      `,
    ),
  )
})

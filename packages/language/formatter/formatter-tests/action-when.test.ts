import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: action when', () => {
  Test(
    'formats an atomic `on press -> when` handler',
    formats(
      'view Main{Button("Group"){on press->when GroupMode{yes->{do Enable()}no->{do Disable()}}}}',
      `
      view Main {
         Button("Group") {
            on press -> when GroupMode {
               yes -> {
                  do Enable()
               }
               no -> {
                  do Disable()
      }  }  }  }
      `,
    ),
  )

  Test(
    'formats braced action when inside an event handler',
    formats(
      'view Main{Button("Group"){on press->{when GroupMode{yes->{do Enable()}Offline Problem->{do Report(Problem)}no->{do Disable()}otherwise->{do Reset()}}}}}',
      `
      view Main {
         Button("Group") {
            on press -> {
               when GroupMode {
                  yes -> {
                     do Enable()
                  }
                  Offline Problem -> {
                     do Report(Problem)
                  }
                  no -> {
                     do Disable()
                  }
                  otherwise -> {
                     do Reset()
      }  }  }  }  }
      `,
    ),
  )
})

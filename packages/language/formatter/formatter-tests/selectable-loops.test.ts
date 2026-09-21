import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: selectable loops', () => {
  Test(
    'formats loop-owned selection handlers as inline action blocks',
    formats(
      'view Main(){state Selected="" render Stack(){loop["One"]/Row{Text(Row)on select->{set Selected=Row}}}}',
      `
        view Main() {
           state Selected = ""
           render Stack() {
              loop ["One"] / Row {
                 Text(Row)
                 on select -> { set Selected = Row }
        }  }  }
      `,
    ),
  )
})

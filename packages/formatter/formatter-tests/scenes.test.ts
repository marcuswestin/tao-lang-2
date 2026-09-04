import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: scenes', () => {
  Test(
    'formats a scene exactly as it formats a view',
    formats(
      `workspace
scene    Home()   {
Title    "Home"
render Text("Hello")
}
view   Row()  {
render Text("Hello")
}`,
      `
        workspace
        scene Home() {
           Title "Home"
           render Text("Hello")
        }

        view Row() {
           render Text("Hello")
        }
      `,
    ),
  )
})

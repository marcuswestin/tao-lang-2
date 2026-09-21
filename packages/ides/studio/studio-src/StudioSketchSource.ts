import Formatter from '@formatter'
import { Assert } from '@shared'

export type StudioSketchSourceInput = Readonly<{
  height: number
  name: string
  project: string
  width: number
}>

/** StudioSketchSource generates the flowed Tao shell for one newly drawn sketch. */
export const StudioSketchSource = {
  async generate(input: StudioSketchSourceInput): Promise<string> {
    validate(input)
    return await Formatter.formatCode(`
      use Placeholder from @tao/ui

      public
      view ${input.name}() {
        render Placeholder("${input.name}") [width ${input.width}, height ${input.height}]
      }

      scenarios ${input.name} "sketch" {
        device phone
        scenario "draft" {
          render ()
        }
      }
    `)
  },
} as const

function validate(input: StudioSketchSourceInput): void {
  Assert.input(/^View[1-9][0-9]*$/.test(input.name), 'A generated Studio sketch name must be ViewN with N above zero.')
  Assert.input(
    Number.isFinite(input.width) && Number.isInteger(input.width) && input.width > 0,
    'A generated Studio sketch width must be a positive whole number.',
  )
  Assert.input(
    Number.isFinite(input.height) && Number.isInteger(input.height) && input.height > 0,
    'A generated Studio sketch height must be a positive whole number.',
  )
  Assert.input(
    input.project.length > 0 && !/[\u0000-\u001f\u007f]/u.test(input.project),
    'A generated Studio sketch project must be non-empty text without control characters.',
  )
}

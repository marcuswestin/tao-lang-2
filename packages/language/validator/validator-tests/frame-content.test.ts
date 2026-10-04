import { Describe, Expect, Test } from '@shared/test'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const tsFence = '```ts'
const fence = '```'

Describe('validator: frame content and render injection channels', () => {
  Test('accepts one caller-content placement and one optional named-slot fill', async () => {
    await testValidateCode(`
      view Card() {
        @actions = empty
        render Col() {
          @actions
          @@content
        }
      }
      view Col() {
        render inject Content @@content ${tsFence} return Content ${fence}
      }
      view Label() {
        render inject Layout @@layout, Tag @@tag ${tsFence} return null ${fence}
      }
      view Button(Press action()) {
        render inject Press, Layout @@layout, Tag @@tag ${tsFence} return null ${fence}
      }
      view Main() {
        render Card() {
          Label()
          @actions Button() {
            #resetSignedOut
            on press -> { }
          }
        }
      }
    `)
  })

  Test('accepts a single conditional caller-content placement', async () => {
    await testValidateCode(`
      view Card(Open boolean) {
        render Col() {
          when Open {
            true -> { @@content }
            otherwise -> { Leaf() }
          }
        }
      }
      view Col() { render inject Content @@content ${tsFence} return Content ${fence} }
      view Leaf() { render inject ${tsFence} return null ${fence} }
      view Main() {
        render Card(true) { Leaf() }
      }
    `)
  })

  Test('limits caller content to at most one placement', async () => {
    const result = await testValidateCodeWithErrors(`
      view RepeatedView() {
        render Col() { @@content @@content }
      }
      view Col() { render inject Content @@content ${tsFence} return Content ${fence} }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(ViewsValidator.messages.callerContentCount('RepeatedView'))
  })

  Test('keeps views without a caller-content placement leaf-only', async () => {
    const result = await testValidateCodeWithErrors(`
      view Leaf() { render inject ${tsFence} return null ${fence} }
      view Main() { render Leaf() { Leaf() } }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.leafContent('Leaf'))
  })

  Test('rejects duplicate slot declarations, placements, and fills', async () => {
    const result = await testValidateCodeWithErrors(`
      view Card() {
        @actions = empty
        @actions = empty
        render Col() { @actions @actions @@content }
      }
      view Col() { render inject Content @@content ${tsFence} return Content ${fence} }
      view Button() { render inject ${tsFence} return null ${fence} }
      view Main() {
        render Card() { @actions Button() @actions Button() }
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(ViewsValidator.messages.duplicateRenderSlot('@actions'))
    Expect(messages).toContain(ViewsValidator.messages.renderSlotPlacementCount('@actions'))
    Expect(messages).toContain(ViewsValidator.messages.duplicateRenderSlotFill('@actions'))
  })

  Test('limits ambient channels to render inject implementations', async () => {
    const stray = await testValidateCodeWithErrors(`
      view Stray() {
        inject Layout @@layout ${tsFence} return null ${fence}
        render Leaf()
      }
      view Leaf() { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(stray)).toContain(injectionValidationMessages.ambientRenderOnly)
  })
})

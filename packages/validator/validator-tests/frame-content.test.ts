import { Describe, Expect, Test } from '@shared/test'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const tsFence = '```ts'
const fence = '```'

Describe('validator: frame content and render injection channels', () => {
  Test('accepts one caller-content placement and one optional named-slot fill', async () => {
    await testValidateCode(`
      frame Card() {
        @actions = empty
        render Col() {
          @actions
          @@content
        }
      }
      layout Col() {
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

  Test('requires exactly one caller-content placement in Tao-authored containers', async () => {
    const result = await testValidateCodeWithErrors(`
      layout EmptyLayout() { render Leaf() }
      frame RepeatedFrame() {
        render Col() { @@content @@content }
      }
      view Leaf() { render inject ${tsFence} return null ${fence} }
      layout Col() { render inject Content @@content ${tsFence} return Content ${fence} }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(ViewsValidator.messages.callerContentCount('EmptyLayout'))
    Expect(messages).toContain(ViewsValidator.messages.callerContentCount('RepeatedFrame'))
  })

  Test('keeps view, ui, and dialogue invocation blocks leaf-only', async () => {
    const result = await testValidateCodeWithErrors(`
      view Leaf() { render inject ${tsFence} return null ${fence} }
      view Main() { render Leaf() { Leaf() } }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.leafContent('Leaf'))
  })

  Test('rejects duplicate slot declarations, placements, and fills', async () => {
    const result = await testValidateCodeWithErrors(`
      frame Card() {
        @actions = empty
        @actions = empty
        render Col() { @actions @actions @@content }
      }
      layout Col() { render inject Content @@content ${tsFence} return Content ${fence} }
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

  Test('limits ambient channels to render inject and content to container implementations', async () => {
    const result = await testValidateCodeWithErrors(`
      view Stray() {
        inject Layout @@layout ${tsFence} return null ${fence}
        render Leaf()
      }
      view Leaf() {
        render inject Content @@content ${tsFence} return Content ${fence}
      }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages).toContain(injectionValidationMessages.ambientRenderOnly)
    Expect(messages).toContain(injectionValidationMessages.contentOwner)
  })
})

import { Describe, Expect, Test } from '@shared/test'
import { LayoutValidator } from '../validator-src/validators/layout-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

const layoutValidationMessages = LayoutValidator.messages

Describe('Tao validator structural diagnostics', () => {
  Test('accepts supported layout clauses on render sites', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Row from @tao/ui
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim 2, content top stretch, gap 12, pad 16, margin horizontal 4, width fill] {
          Text("Label") [width fill, height fill]
        }
      }
    `)
  })

  Test('accepts aligned layout terms without static parent direction analysis', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Row, Text from @tao/ui
      view MainView {
        render Col(){
          Row(){
            Text("Top") [aligned top]
            Text("Bottom") [aligned bottom]
          }
          Col(){
            Text("Left") [aligned left]
            Text("Right") [aligned right]
          }
        }
      }
    `)
  })

  Test('accepts content clauses on custom layouts with known root layout direction', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Text from @tao/ui
      layout Screen {
        render Col(){
          Text("Screen")
        }
      }
      view MainView {
        render Screen()[content center, gap 8]
      }
    `)
  })

  Test(
    'accepts content clauses on ordinary views because runtime resolves the eventual primitive direction',
    async () => {
      await testValidateCode(`
      app MyApp { view MainView }
      use Col, Text from @tao/ui
      view Card {
        render Col(){
          Text("Wrapped")
        }
      }
      view MainView {
        render Card()[content center]
      }
    `)
    },
  )

  Test('accepts content clauses on imported stdlib layouts by declaration identity', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Row, Text from @tao/ui
      view MainView {
        render Row()[content left center] {
          Text("Label")
        }
      }
    `)
  })

  Test('does not require stdlib identity to accept content clauses', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Row {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view MainView {
        render Row()[content left center]
      }
    `)
  })

  Test('rejects malformed and unknown layout entries', async () => {
    const malformedGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[gap fill]
      }
    `)
    const malformedClaim = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim fill]
      }
    `)
    const unknownHead = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[unknown 1]
      }
    `)
    const unknownContentTerm = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[content diagonal]
      }
    `)
    const emptyContent = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row()[content]
      }
    `)
    const longContent = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row()[content left center right]
      }
    `)
    const malformedPad = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[pad horizontal]
      }
    `)
    const malformedMargin = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[margin vertical]
      }
    `)
    const alignedStretch = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[aligned stretch]
      }
    `)
    const widthShrink = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[width shrink]
      }
    `)
    const removedExpand = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[expand]
      }
    `)
    const removedStretch = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[stretch]
      }
    `)
    const zeroGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[gap 0]
      }
    `)
    const zeroPad = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[pad 0]
      }
    `)
    const zeroMargin = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[margin left 0]
      }
    `)
    const zeroWidth = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[width 0]
      }
    `)
    const zeroHeight = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[height 0]
      }
    `)
    const zeroClaim = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim 0]
      }
    `)

    Expect(validationErrorMessages(malformedGap)).toContain(layoutValidationMessages.malformedEntry('gap fill'))
    Expect(validationErrorMessages(malformedClaim)).toContain(layoutValidationMessages.malformedEntry('claim fill'))
    Expect(validationErrorMessages(unknownHead)).toContain(layoutValidationMessages.unsupportedEntry('unknown 1'))
    Expect(validationErrorMessages(unknownContentTerm)).toContain(
      layoutValidationMessages.unsupportedTerm('content diagonal', 'diagonal'),
    )
    Expect(validationErrorMessages(emptyContent)).toContain(layoutValidationMessages.malformedEntry('content'))
    Expect(validationErrorMessages(longContent)).toContain(
      layoutValidationMessages.malformedEntry('content left center right'),
    )
    Expect(validationErrorMessages(malformedPad)).toContain(layoutValidationMessages.malformedEntry('pad horizontal'))
    Expect(validationErrorMessages(malformedMargin)).toContain(
      layoutValidationMessages.malformedEntry('margin vertical'),
    )
    Expect(validationErrorMessages(alignedStretch)).toContain(
      layoutValidationMessages.unsupportedTerm('aligned stretch', 'stretch'),
    )
    Expect(validationErrorMessages(widthShrink)).toContain(
      layoutValidationMessages.unsupportedTerm('width shrink', 'shrink'),
    )
    Expect(validationErrorMessages(removedExpand)).toContain(layoutValidationMessages.unsupportedEntry('expand'))
    Expect(validationErrorMessages(removedStretch)).toContain(layoutValidationMessages.unsupportedEntry('stretch'))
    Expect(validationErrorMessages(zeroGap)).toContain(layoutValidationMessages.positiveNumber('gap 0'))
    Expect(validationErrorMessages(zeroPad)).toContain(layoutValidationMessages.positiveNumber('pad 0'))
    Expect(validationErrorMessages(zeroMargin)).toContain(layoutValidationMessages.positiveNumber('margin left 0'))
    Expect(validationErrorMessages(zeroWidth)).toContain(layoutValidationMessages.positiveNumber('width 0'))
    Expect(validationErrorMessages(zeroHeight)).toContain(layoutValidationMessages.positiveNumber('height 0'))
    Expect(validationErrorMessages(zeroClaim)).toContain(layoutValidationMessages.positiveNumber('claim 0'))
  })

  Test('rejects duplicate and conflicting layout entries', async () => {
    const duplicateGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[gap 8, gap 12]
      }
    `)
    const duplicateClaim = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim 1, claim 2]
      }
    `)
    const compressRigid = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[compress, rigid]
      }
    `)
    const fillAlignment = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[fill, centered]
      }
    `)
    const fillClaim = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[fill, claim 2]
      }
    `)
    const fillWidth = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[fill, width fill]
      }
    `)
    const fillHeight = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[fill, height fill]
      }
    `)
    const claimRigid = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim 2, rigid]
      }
    `)
    await testValidateCode(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[claim 2, compress]
      }
    `)
    await testValidateCode(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[fill, rigid]
      }
      view OtherView {
        render Col()[width fill, height fill]
      }
    `)
    const padSide = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[pad horizontal 8 left 4]
      }
    `)
    const marginSide = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[margin vertical 8 top 4]
      }
    `)
    const contentHorizontalAxis = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row()[content left right]
      }
    `)
    const contentCrossAxis = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row()[content baseline stretch]
      }
    `)
    const contentCenter = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row()[content center center]
      }
    `)
    const duplicateWidth = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col()[width 100, width 200]
      }
    `)

    Expect(validationErrorMessages(duplicateGap)).toContain(layoutValidationMessages.duplicateEntry('gap'))
    Expect(validationErrorMessages(duplicateClaim)).toContain(layoutValidationMessages.duplicateEntry('claim'))
    Expect(validationErrorMessages(compressRigid)).toContain(
      layoutValidationMessages.conflictingEntries('compress', 'rigid'),
    )
    Expect(validationErrorMessages(fillAlignment)).toContain(
      layoutValidationMessages.conflictingEntries('fill', 'centered'),
    )
    Expect(validationErrorMessages(fillClaim)).toContain(
      layoutValidationMessages.conflictingEntries('fill', 'claim'),
    )
    Expect(validationErrorMessages(fillWidth)).toContain(
      layoutValidationMessages.conflictingEntries('fill', 'width'),
    )
    Expect(validationErrorMessages(fillHeight)).toContain(
      layoutValidationMessages.conflictingEntries('fill', 'height'),
    )
    Expect(validationErrorMessages(claimRigid)).toContain(
      layoutValidationMessages.conflictingEntries('claim', 'rigid'),
    )
    Expect(validationErrorMessages(padSide)).toContain(layoutValidationMessages.duplicateEntry('pad left'))
    Expect(validationErrorMessages(marginSide)).toContain(layoutValidationMessages.duplicateEntry('margin top'))
    Expect(validationErrorMessages(contentHorizontalAxis)).toContain(
      layoutValidationMessages.conflictingEntries('content left', 'content right'),
    )
    Expect(validationErrorMessages(contentCrossAxis)).toContain(
      layoutValidationMessages.conflictingEntries('content baseline', 'content stretch'),
    )
    Expect(validationErrorMessages(contentCenter)).toContain(layoutValidationMessages.duplicateEntry('content center'))
    Expect(validationErrorMessages(duplicateWidth)).toContain(layoutValidationMessages.duplicateEntry('width'))
  })

  Test('rejects layout clauses on render inject', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence} [gap 8]
      }
    `)

    Expect(validationErrorMessages(result)).toContain(layoutValidationMessages.injectLayout)
  })
})

import { Describe, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { accepts, rejects, stubContainer, stubView } from './test-validate'

Describe('validator: scenes', () => {
  Test(
    'accepts a scene that is presented and a view that is composed',
    accepts(`
       ${stubView('Label', 'Value text')}

       scene Home() {
          render Label("Home")
       }

       view Row() {
          render Label("Row")
       }
    `),
  )

  Test(
    'rejects a scene composed inline in a render tree',
    rejects(
      `
       ${stubView('Label', 'Value text')}
       ${stubContainer('Column')}

       scene Panel() {
          render Label("Panel")
       }

       view Page() {
          render Column() {
             Panel()
          }
       }
    `,
      ViewsValidator.messages.sceneComposed('Panel'),
    ),
  )

  Test(
    'rejects a scene as the root render of another view',
    rejects(
      `
       ${stubView('Label', 'Value text')}

       scene Panel() {
          render Label("Panel")
       }

       view Page() {
          render Panel()
       }
    `,
      ViewsValidator.messages.sceneComposed('Panel'),
    ),
  )

  Test(
    'rejects a scene bound to a view-typed parameter of another view',
    rejects(
      `
       ${stubView('Label', 'Value text')}
       ${stubView('Column')}

       scene Panel() {
          render Label("Panel")
       }

       view Frame(Body view) {
          render Column() {
             Body()
          }
       }

       view Page() {
          render Frame(Panel)
       }
    `,
      ViewsValidator.messages.sceneBoundToView('Panel', 'Body'),
    ),
  )

  Test(
    'rejects host chrome filled on a plain view',
    rejects(
      `
       ${stubView('Label', 'Value text')}

       view Page() {
          Title "Page"
          render Label("Page")
       }
    `,
      "view has no supplied slot named 'Title'",
    ),
  )

  Test(
    'accepts a headerless scene that fills no chrome',
    accepts(`
       ${stubView('Label', 'Value text')}

       scene FullBleed() {
          Header false
          render Label("Full bleed")
       }
    `),
  )

  Test(
    'rejects chrome on a scene that suppresses its header',
    rejects(
      `
       ${stubView('Label', 'Value text')}

       scene FullBleed() {
          Header false
          Title "Full bleed"
          render Label("Full bleed")
       }
    `,
      ViewsValidator.messages.headerlessChrome('FullBleed', 'Title'),
    ),
  )
})

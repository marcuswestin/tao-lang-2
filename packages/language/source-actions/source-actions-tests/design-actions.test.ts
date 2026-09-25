import { Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { parseDocument, parseRawDocument, sourceActionOptionsFor } from './test-source-actions'

/** fixText runs every source fix over exact Tao text. */
async function fixText(text: string): Promise<string> {
  const document = await parseRawDocument(text)
  return await SourceActions.fixSource(document, await sourceActionOptionsFor(document))
}

/** fixes returns a test callback asserting the fixed source and that fixing it again changes nothing. */
function fixes(source: string, expected: string): () => Promise<void> {
  return async () => {
    const document = await parseDocument(source)
    const fixed = await SourceActions.fixSource(document, await sourceActionOptionsFor(document))

    Expect(fixed).toBe(`${Text.stripIndent(expected)}\n`)
    Expect(await fixText(fixed)).toBe(fixed)
  }
}

/** alreadyFixed returns a test callback asserting canonical source survives every fix unchanged. */
function alreadyFixed(source: string): () => Promise<void> {
  return async () => {
    const text = `${Text.stripIndent(source)}\n`
    Expect(await fixText(text)).toBe(text)
  }
}

Describe('fixSource legacy visual heads', () => {
  Test(
    'renames bg and fg at a render site, including conditional and cleared entries',
    fixes(
      `
        use Text from @tao/ui

        view MainView() {
           render Text("hi") [bg paper, fg ink, bg accent when pressed, fg none]
        }
      `,
      `
        use Text from @tao/ui

        view MainView() {
           render Text("hi") [background paper, ink ink, background accent when pressed, ink none]
        }
      `,
    ),
  )

  Test(
    'renames bg and fg in a declaration header clause',
    fixes(
      `
        view Card() [pad 12, bg paper, fg ink] { }
      `,
      `
        view Card() [pad 12, background paper, ink ink] { }
      `,
    ),
  )

  Test(
    'renames bg and fg in design styles and text styles',
    fixes(
      `
        design AppDesign {
           colors {
              paper #fff
              accent #3f7657
           }
           text {
              caption [size 14, fg accent]
           }
           styles {
              card [pad 12, bg paper, bg accent when pressed, bg none when focused]
           }
        }
      `,
      `
        design AppDesign {
           colors {
              paper #fff
              accent #3f7657
           }
           text {
              caption [size 14, ink accent]
           }
           styles {
              card [pad 12, background paper, background accent when pressed, background none when focused]
           }
        }
      `,
    ),
  )

  Test(
    'leaves a clause list that spells one property both ways exactly as written',
    fixes(
      `
        use Text from @tao/ui

        view MainView() {
           render Text("hi") [bg paper, background canvas, fg ink]
           render Text("there") [bg paper]
        }
      `,
      `
        use Text from @tao/ui

        view MainView() {
           render Text("hi") [bg paper, background canvas, fg ink]
           render Text("there") [background paper]
        }
      `,
    ),
  )

  Test(
    'leaves words that only begin like a legacy head, and legacy words outside the head',
    alreadyFixed(`
      use Text from @tao/ui

      view MainView() {
         render Text("hi") [bg-soft, border bg]
      }
    `),
  )
})

Describe('fixSource flat design catalog', () => {
  Test(
    'moves flat colors and styles into new typed blocks where the first of each stood',
    fixes(
      `
        design AppDesign {
           paper #fffdf8
           ink #172019
           sizes {
              gutter 8.px
           }
           Text [fg ink]
           card [pad 12, bg paper]
        }
      `,
      `
        design AppDesign {
           colors {
              paper #fffdf8
              ink #172019
           }
           sizes {
              gutter 8.px
           }
           styles {
              Text [ink ink]
              card [pad 12, background paper]
           }
        }
      `,
    ),
  )

  Test(
    'appends flat members to existing blocks in source order, carrying their leading comments',
    fixes(
      `
        design AppDesign {
           // The palette stays quiet.
           canvas #f4f2ec
           surface #fffdf8

           colors {
              schemeCanvas when Scheme is Dark canvasDark / not canvas
           }
           styles {
              Hint [background surface, radius 8]
           }

           // Capitalized styles are element defaults.
           Text [ink ink]
           canvasDark #101612

           // Product styles describe hierarchy.
           screen [fill, pad 24, bg canvas]
           // A trailing note stays at the end of the design.
        }
      `,
      `
        design AppDesign {
           colors {
              schemeCanvas when Scheme is Dark canvasDark / not canvas

              // The palette stays quiet.
              canvas #f4f2ec
              surface #fffdf8
              canvasDark #101612
           }
           styles {
              Hint [background surface, radius 8]

              // Capitalized styles are element defaults.
              Text [ink ink]

              // Product styles describe hierarchy.
              screen [fill, pad 24, background canvas]
           }
           // A trailing note stays at the end of the design.
        }
      `,
    ),
  )

  Test(
    'appends into an empty existing block without a leading blank line',
    fixes(
      `
        design AppDesign {
           colors { }
           // The palette stays quiet.
           paper #fff
        }
      `,
      `
        design AppDesign {
           colors {
              // The palette stays quiet.
              paper #fff
           }
        }
      `,
    ),
  )

  Test(
    'migrates each design of a file on its own',
    fixes(
      `
        design LightDesign {
           paper #fff
           card [bg paper]
        }

        design DarkDesign {
           paper #101612
           styles {
              Hint [radius 8]
           }
           card [bg paper]
        }
      `,
      `
        design LightDesign {
           colors {
              paper #fff
           }
           styles {
              card [background paper]
           }
        }

        design DarkDesign {
           colors {
              paper #101612
           }
           styles {
              Hint [radius 8]
              card [background paper]
           }
        }
      `,
    ),
  )

  Test(
    'leaves source already in the typed form unchanged',
    alreadyFixed(`
      use Text from @tao/ui

      design AppDesign {
         colors {
            paper #fffdf8
            ink #172019
         }
         text {
            body [size 16, ink ink]
         }
         styles {
            Text [ink ink]
            card [pad 12, background paper, background ink when pressed, background none when focused]
         }
      }

      view Card() [pad 12, background paper] {
         render Text("hi") [ink ink]
      }
    `),
  )
})

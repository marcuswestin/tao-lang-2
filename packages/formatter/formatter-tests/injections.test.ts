import { Describe, Test } from '@shared/test'
import { fence, formats, tsFence } from './test-format'

Describe('Tao formatter injections', () => {
  Test(
    'formats injection fence bodies with dprint TypeScript style',
    formats(
      `
        view MainView() {
        render inject ${tsFence}
        const message = "hi";
        return <RN.Text accessibilityLabel='greeting'>{ message }</RN.Text>;
        ${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              const message = 'hi'
              return <RN.Text accessibilityLabel="greeting">{message}</RN.Text>
           ${fence}
        }
      `,
    ),
  )

  Test(
    'indents injection fence bodies one level below the inject line',
    formats(
      `
        view CountText(Count number) {
        render inject Count ${tsFence}
        return <RN.Text>{Count}</RN.Text>
        ${fence}
        }
      `,
      `
        view CountText(Count number) {
           render inject Count ${tsFence}
              return <RN.Text>{Count}</RN.Text>
           ${fence}
        }
      `,
    ),
  )

  Test(
    'preserves relative indentation and brace lines inside fence bodies',
    formats(
      `
        view MainView() {
        render inject ${tsFence}
        function label() {
            return 'hi'
        }
        return <RN.Text>{label()}</RN.Text>
        ${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              function label() {
                return 'hi'
              }
              return <RN.Text>{label()}</RN.Text>
           ${fence}
        }
      `,
    ),
  )

  Test(
    'detects fences with trailing whitespace after the opener and leaves their bodies untouched',
    formats(
      `
        view MainView() {
        render inject ${tsFence}${' '}
        function wrap() {
           if (true) {
           }
        }
        return <RN.Text>hi</RN.Text>
        ${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              function wrap() {
                if (true) {
                }
              }
              return <RN.Text>hi</RN.Text>
           ${fence}
        }
      `,
    ),
  )

  Test(
    'ignores comment lines that mention inject fences',
    formats(
      `
        view MainView() {
        // inject some TS via ${tsFence}
        render inject ${tsFence}
        return null
        ${fence}
        }
      `,
      `
        view MainView() {
           // inject some TS via ${tsFence}
           render inject ${tsFence}
              return null
           ${fence}
        }
      `,
    ),
  )

  Test(
    'preserves trailing whitespace inside fence bodies',
    formats(
      `
        view MainView() {
        render inject ${tsFence}
        const s = \`abc${'   '}
        def\`
        return <RN.Text>{s}</RN.Text>
        ${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              const s = \`abc${'   '}
              def\`
              return <RN.Text>{s}</RN.Text>
           ${fence}
        }
      `,
    ),
  )

  Test(
    'moves body content sharing the close-fence line onto its own body line',
    formats(
      `
        view MainView() {
        render inject ${tsFence}
        const value = 1
        return value${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              const value = 1
              return value
           ${fence}
        }
      `,
    ),
  )

  Test(
    'falls back to reindent-only for invalid embedded TypeScript',
    formats(
      `
        view MainView() {
        render inject ${tsFence}
        const =
        return null
        ${fence}
        }
      `,
      `
        view MainView() {
           render inject ${tsFence}
              const =
              return null
           ${fence}
        }
      `,
    ),
  )

  Test(
    'normalizes injection argument spacing',
    formats(
      `
        let UserName = "Ro"
        view MainView() {
        render inject Name    UserName,UserName ${tsFence}
        return <RN.Text>{Name}</RN.Text>
        ${fence}
        }
      `,
      `
        let UserName = "Ro"

        view MainView() {
           render inject Name UserName, UserName ${tsFence}
              return <RN.Text>{Name}</RN.Text>
           ${fence}
        }
      `,
    ),
  )
})

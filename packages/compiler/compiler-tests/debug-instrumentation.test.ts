import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const source = `
  app Main { view Root }
  view Root() {
    state Ready = false
    action Bump() {
      toggle Ready
      set Ready = false
    }
    render Text("Ready")
  }
  view Text(Value text) {
    render inject Value \`\`\`ts
      return null
    \`\`\`
  }
`

Describe('compiler: debugger instrumentation', () => {
  Test('emits a gate before every action statement under debug', async () => {
    const compiled = await Compiler.compileCode(source, { debug: true })
    const code = compiled.code
    Expect(code).toContain(`await TR.Debug.At({ action: "Bump", path: "0", declaration:`)
    Expect(code).toContain(`await TR.Debug.At({ action: "Bump", path: "1", declaration:`)
  })

  Test('emits nothing without debug', async () => {
    const compiled = await Compiler.compileCode(source)
    Expect(compiled.code).not.toContain('TR.Debug.At')
  })

  Test('scopes instrumentation to the compile instead of the position of the app declaration', async () => {
    const appLast = `
      view Root() {
        state Ready = false
        action Bump() { toggle Ready }
        render Text("Ready")
      }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
      app Main { view Root }
    `

    const debug = await Compiler.compileCode(appLast, { debug: true })
    const ordinary = await Compiler.compileCode(appLast)

    Expect(debug.code.match(/TR\.Debug\.At/g)).toHaveLength(1)
    Expect(ordinary.code).not.toContain('TR.Debug.At')
  })

  Test('gives same-named actions canonical declaration and structural statement identities', async () => {
    const compiled = await Compiler.compileCode(
      `
      app Main { view First }
      view First() {
        state Ready = false
        action Save() { toggle Ready }
        render Text("First")
      }
      view Second() {
        state Ready = false
        action Save() { toggle Ready }
        render Text("Second")
      }
      view Text(Value text) { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `,
      { debug: true },
    )

    const identities = [...compiled.code.matchAll(
      /TR\.Debug\.At\(\{ action: "Save", path: "0", declaration: ([\s\S]*?), statement: "([^"]+)" \}/g,
    )].map(match => `${match[1]}#${match[2]}`)
    Expect(identities).toHaveLength(2)
    Expect(new Set(identities).size).toBe(2)
  })
})

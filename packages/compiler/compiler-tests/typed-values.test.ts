import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: typed values', () => {
  Test('compiles nominal typed lists through item fields and structural list parameters', async () => {
    const compiled = await Compiler.compileCode(promptTagsApp())
    const code = compiled.files[0]?.code ?? ''

    Expect(compiled.appNames).toEqual(['TypedTags'])
    Expect(code).toContain('TR.Value("daily").jsValue')
    Expect(code).toContain('["PromptTags"]: _Scope.StarterTags.evaluate().jsValue')
    Expect(code.match(/TR\.Call\(_Scope\.Join, _Scope\.Tags\.evaluate\(\), TR\.Value\(", "\)\)/g)).toHaveLength(2)
  })

  Test('wraps bridged results and omits absent item fields?', async () => {
    const compiled = await Compiler.compileCode(`
      type Profile is { Name text, Subtitle text? }
      function Join(Values list of text, Separator text) returns text {
        return Join(Values, Separator) from ./Join.ts
      }
      app TypedValues { view Main }
      view Main() {
        let Basic is Profile = Profile { Name: "Ada" }
        let Joined = Join(["Ada", "Grace"], " + ")
        render Native(Joined)
      }
      view Native(Value text) {
        render inject Value \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain("import { Join as __tao_bridge_1__ } from './Join'")
    Expect(code).toContain(
      'TR.Value(__tao_bridge_1__(_Scope.Values.evaluate().jsValue, _Scope.Separator.evaluate().jsValue))',
    )
    Expect(code).toContain('["Name"]: TR.Value("Ada").jsValue')
    Expect(code).not.toContain('["Subtitle"]')
  })
})

function promptTagsApp(): string {
  return `
    type PromptTitle is text
    type PromptMinutes is number
    type PromptTags is list of text
    type WritingPrompt is {
      PromptTitle,
      PromptMinutes,
      PromptTags,
    }

    let StarterTags = PromptTags ["daily", "warmup"]
    let StarterPrompt = WritingPrompt {
      PromptTitle: "Morning pages"
      PromptMinutes: 10
      StarterTags
    }

    function Join(Values list of text, Separator text) returns text {
      return Join(Values, Separator) from ./Join.ts
    }

    app TypedTags { view Main }
    view Main() { render TagSummary(StarterPrompt.PromptTags) }
    view TagSummary(Tags PromptTags) {
      let Positional = Join(Tags, Separator: ", ")
      let Labeled = Join(Values: Tags, Separator: ", ")
      render Text("{ Positional } / { Labeled }")
    }
    view Text(Value text) {
      render inject Value \`\`\`ts return null \`\`\`
    }
  `
}

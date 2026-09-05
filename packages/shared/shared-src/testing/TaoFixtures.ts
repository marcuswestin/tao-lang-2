/** tsFence opens an embedded TypeScript block in Tao fixture source. */
export const tsFence = '```ts'

/** fence closes an embedded code block in Tao fixture source. */
export const fence = '```'

/** app wraps a MainView body in the standard standalone Tao app fixture. */
export function app(body: string, extra = ''): string {
  return `
    app MyApp { view MainView }
    view MainView() { ${body} }
    ${extra}
  `
}

/** stubView returns a renderable Tao view fixture with an injected no-op implementation. */
export function stubView(name: string, parameters = ''): string {
  return `
    view ${name}(${parameters}) {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}

/** stubContainer returns a content-accepting Tao view fixture with an injected no-op implementation. */
export function stubContainer(name: string, parameters = ''): string {
  return `
    view ${name}(${parameters}) {
      render inject Content @@content ${tsFence}
        return Content
      ${fence}
    }
  `
}

/** promptTagsApp declares nominal typed lists that flow through item fields and structural parameters. */
export function promptTagsApp(): string {
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
    ${stubView('Text', 'Value text')}
  `
}

/** primitiveAppValueSpellings declares the same app four ways: head, head-with, let, and let-with. */
export function primitiveAppValueSpellings(navImplementation = 'nav TestNavImpl from ./TestNavImpl.ts'): string {
  return `
    public type TestStack is nav with {
      Initial view
      ${navImplementation}
    }
    workspace type CompleteTestStack is TestStack with { Initial is Home }
    workspace nav HeadNavigation = CompleteTestStack { }
    workspace nav HeadWithNavigation = CompleteTestStack with { }
    workspace let LetNavigation = CompleteTestStack { }
    workspace let LetWithNavigation = CompleteTestStack with { }

    app HeadApp {
      Name "Head"
      Navigator HeadNavigation
    }
    app HeadWithApp = app with {
      Name "Head with"
      Navigator HeadWithNavigation
    }
    workspace let LetApp = app {
      Name "Let"
      Navigator LetNavigation
    }
    workspace let LetWithApp = app with {
      Name "Let with"
      Navigator LetWithNavigation
    }

    view Home() { render Empty() }
    ${stubView('Empty')}
  `
}

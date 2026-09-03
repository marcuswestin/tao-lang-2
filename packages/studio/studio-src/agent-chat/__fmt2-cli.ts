import Formatter from '@formatter'
const base = `use Col, Row, Text, TextMultiline from @tao/ui

app A {
   Name "A"
   Navigator N { Initial V }
}

data Stories / Story {
   Title text
   CommentCount number
}

view StoryRow(Story) {
   render Row() { Text(Story.Title) }
}
`
const fixture = `\nfixture StoryStates {\n   longTitleRow = create Story { Title: "A very long title", CommentCount: 1200 }\n}\n`
const scenario = `\nscenarios StoryRow "states" {\n   fixture StoryStates\n   device phone\n   appearance light\n   network online\n   locale "en"\n   scenario "longTitle" {\n      render (Story: longTitleRow)\n}  }\n`
try { console.log('OK:\n' + await Formatter.formatCode(base + fixture + scenario)) } catch (e) { console.log('REFUSED: ' + String(e instanceof Error ? e.message : e)) }

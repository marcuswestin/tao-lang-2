grammar TaoLayout

import "./terminals"

entry LayoutGrammarEntrypoint:
    LayoutClause;

LayoutClause:
    '[' (entries+=LayoutEntry (',' entries+=LayoutEntry)*)? ']';

LayoutEntry:
    head=LayoutTerm terms+=LayoutTerm* condition=LayoutCondition?;

// `when` is a language keyword rather than an ID, so design entries need an explicit postfix
// shape. Factoring the optional `is` tail after one LayoutWord keeps Langium lookahead inside this
// rule: it admits both bare interaction states (`when focused`) and named conditions
// (`when Sidebar is active`) without reserving any of those words.
LayoutCondition:
    'when' subject=LayoutWord ('is' value=LayoutWord)?;

LayoutTerm:
    LayoutWord | LayoutNumberLiteral | LayoutColorLiteral | LayoutNoneLiteral;

// `none` after a head clears that clause rather than setting it (`bg none`, `pad left none`): the
// merged list ends without the slot. The word is already the language's keyword for absence, so it
// cannot be an ID here.
LayoutNoneLiteral:
    value='none';

LayoutWord:
    value=ID ('-' suffixes+=ID)* ('.' pathSegments+=LayoutPathSegment)*;

LayoutPathSegment returns string:
    ID | NUMBER;

LayoutNumberLiteral:
    value=NUMBER;

// Raw colors stay parseable as Studio explorations; design-check validation decides whether a
// release must promote them into the selected design's token catalog.
LayoutColorLiteral:
    value=TagOrHexColor;

grammar TaoLayout

import "./terminals"

entry LayoutGrammarEntrypoint:
    LayoutClause;

LayoutClause:
    '[' (entries+=LayoutEntry (',' entries+=LayoutEntry)*)? ']';

LayoutEntry:
    head=LayoutTerm terms+=LayoutTerm*;

LayoutTerm:
    LayoutWord | LayoutNumberLiteral | LayoutColorLiteral;

LayoutWord:
    value=ID ('-' suffixes+=ID)*;

LayoutNumberLiteral:
    value=NUMBER;

// Raw colors stay parseable as Studio explorations; design-check validation decides whether a
// release must promote them into the selected design's token catalog.
LayoutColorLiteral:
    value=TagOrHexColor;

grammar TaoLayout

import "./terminals"

entry LayoutGrammarEntrypoint:
    LayoutClause;

LayoutClause:
    '[' (entries+=LayoutEntry (',' entries+=LayoutEntry)*)? ']';

LayoutEntry:
    head=LayoutTerm terms+=LayoutTerm*;

LayoutTerm:
    LayoutWord | LayoutNumberLiteral;

LayoutWord:
    value=ID ('-' suffixes+=ID)*;

LayoutNumberLiteral:
    value=NUMBER;

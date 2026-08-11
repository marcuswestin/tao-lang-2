grammar TaoAliases

import "./expressions"
import "./visibility"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

// `let` is the current binding keyword; `alias` remains accepted for compatibility.
AliasDeclaration:
    visibility=DeclarationVisibility? keyword=BindingKeyword name=ID '=' value=Expression;

BindingKeyword returns string:
    'let' | 'alias';

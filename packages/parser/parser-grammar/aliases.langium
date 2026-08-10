grammar TaoAliases

import "./expressions"
import "./visibility"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

// `let` is the current binding keyword; `alias` stays as deprecated compatibility syntax.
AliasDeclaration:
    visibility=DeclarationVisibility? keyword=BindingKeyword name=ID '=' value=Expression;

BindingKeyword returns string:
    'let' | 'alias';

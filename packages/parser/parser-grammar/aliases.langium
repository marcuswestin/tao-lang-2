grammar TaoAliases

import "./expressions"
import "./visibility"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

AliasDeclaration:
    visibility=DeclarationVisibility? keyword=BindingKeyword name=ID '=' value=Expression;

BindingKeyword returns string:
    'let';

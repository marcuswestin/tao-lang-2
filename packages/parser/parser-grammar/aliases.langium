grammar TaoAliases

import "./expressions"
import "./visibility"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

AliasDeclaration:
    visibility=DeclarationVisibility? 'alias' name=ID '=' value=Expression;

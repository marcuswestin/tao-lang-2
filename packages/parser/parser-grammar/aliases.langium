grammar TaoAliases

import "./expressions"
import "./views"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

AliasDeclaration:
    visibility=DeclarationVisibility? 'alias' name=ID '=' value=Expression;

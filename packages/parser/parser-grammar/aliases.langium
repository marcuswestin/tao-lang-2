grammar TaoAliases

import "./expressions"
import "./terminals"

entry AliasesGrammarEntrypoint:
    AliasDeclaration;

AliasDeclaration:
    'alias' name=ID '=' value=Expression;

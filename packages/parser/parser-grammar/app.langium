grammar TaoApp

import "./blocks"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

AppDeclaration:
    'app' name=ID block=Block;

AppView:
    'view' view=[ViewDeclaration:ID];

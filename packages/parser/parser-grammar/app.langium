grammar TaoApp

import "./blocks"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

AppDeclaration:
    'app' name=ID '{' statements+=Statement* '}';

type AppStatement = AppUi;

AppUi:
    'ui' ui=[ViewDeclaration:ID];

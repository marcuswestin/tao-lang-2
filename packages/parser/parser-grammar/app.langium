grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

AppDeclaration:
    'app' name=ID block=Block;

AppView:
    'view' view=[ViewDeclaration:ID];

AppDatasource:
    'datasource' data=[DataDeclaration:ID] 'through' provider=ID;

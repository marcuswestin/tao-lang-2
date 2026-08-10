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

// A datasource binds one schema to the provider that stores it for this app. The provider is a
// plain name the validator checks, so provider names never become reserved words.
AppDatasource:
    'datasource' data=[DataDeclaration:ID] 'through' provider=ID;

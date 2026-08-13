grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

AppDeclaration:
    'app' name=ID block=AppBlock;

AppBlock:
    '{' statements+=(AppStatement | Statement)* '}';

AppStatement:
    AppName | AppNavigator | AppAuxiliaryNavigator | AppView | AppDatasource;

AppName:
    name=ID value=StringLiteral;

AppNavigator:
    name=ID value=(NavigationConfiguredValue | ValueReference);

AppAuxiliaryNavigator:
    name=USE_IMPORT_PATH value=NavigationConfiguredValue;

AppView:
    'view' view=[ViewDeclaration:ID];

AppDatasource:
    name=ID value=ProviderConfiguredValue;

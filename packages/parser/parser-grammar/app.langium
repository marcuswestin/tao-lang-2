grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

type AppValueDeclaration = AppDeclaration | AliasDeclaration;

AppDeclaration:
    'app' name=ID block=AppBlock;

AppBlock:
    '{' statements+=(AppStatement | Statement)* '}';

AppStatement:
    AppName | AppNavigator | AppAuxiliaryNavigator | AppView | AppDatasource;

AppName:
    name='Name' value=StringLiteral;

AppNavigator:
    name='Navigator' value=ConfiguredAppPropertyValue;

AppAuxiliaryNavigator:
    name=USE_IMPORT_PATH value=ConfigurationConstructor;

AppView:
    'view' view=[ViewDeclaration:ID];

AppDatasource:
    name='Datasource' value=ConfiguredAppPropertyValue;

ConfiguredAppPropertyValue:
    target=[NamedDeclaration:ID] block=ConfigurationBlock?;

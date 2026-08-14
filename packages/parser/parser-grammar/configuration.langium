grammar TaoConfiguration

import "./types"
import "./visibility"
import "./terminals"

entry ConfigurationGrammarEntrypoint:
    NavDeclaration | DatasourceDeclaration;

NavDeclaration:
    visibility=DeclarationVisibility? 'nav' name=ID block=ConfigurationDeclarationBlock;

DatasourceDeclaration:
    visibility=DeclarationVisibility? 'datasource' name=ID block=ConfigurationDeclarationBlock;

ConfigurationDeclarationBlock:
    '{' entries+=(ConfigurationPropertyDeclaration | ConfigurationKeyDeclaration | ConfigurationImplementation)* '}';

ConfigurationPropertyDeclaration:
    name=ID type=ConfigurationPropertyType;

ConfigurationPropertyType:
    TypeReference;

ConfigurationKeyDeclaration:
    name='@key' block=ConfigurationPropertyBlock;

ConfigurationPropertyBlock:
    '{' properties+=ConfigurationPropertyDeclaration* '}';

ConfigurationImplementation:
    'implement' 'inject' protocol=ConfigurationImplementationProtocol tsCodeBlock=TS_CODE_BLOCK;

ConfigurationImplementationProtocol returns string:
    'nav' | 'provider';

type ConfigurableDeclaration = NavDeclaration | DatasourceDeclaration;

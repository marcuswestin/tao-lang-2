grammar TaoConfiguration

import "./types"
import "./visibility"
import "./terminals"

entry ConfigurationGrammarEntrypoint:
    // Includes declaration-contract helpers consumed from `types` so Langium marks them reachable.
    NavDeclaration | DatasourceDeclaration | ConfigurationDeclarationBlock;

NavDeclaration:
    visibility=DeclarationVisibility? 'nav' name=ID ('=' value=Expression | block=ConfigurationBlock);

DatasourceDeclaration:
    visibility=DeclarationVisibility? 'datasource' name=ID ('=' value=Expression | block=ConfigurationBlock);

ConfigurationDeclarationBlock:
    '{' entries+=(ConfigurationPropertyDeclaration | ConfigurationKeyDeclaration | ConfigurationImplementation)* '}';

ConfigurationPropertyDeclaration:
    name=ID type=ConfigurationPropertyType ('is' value=Expression)?;

ConfigurationPropertyType:
    TypeReference;

ConfigurationKeyDeclaration:
    name='@key' block=ConfigurationPropertyBlock;

ConfigurationPropertyBlock:
    '{' properties+=ConfigurationPropertyDeclaration* '}';

ConfigurationImplementation:
    'implement' 'inject' protocol=ConfigurationImplementationProtocol
    (tsCodeBlock=TS_CODE_BLOCK | sidecarPath=STRING);

ConfigurationImplementationProtocol returns string:
    'nav' | 'provider';

type PrimitiveValueDeclaration = NavDeclaration | DatasourceDeclaration;

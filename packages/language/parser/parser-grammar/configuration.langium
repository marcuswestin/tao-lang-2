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

// The primitive's implementation is an ordinary named import: `provider Local from ./Local.ts`.
ConfigurationImplementation:
    protocol=ConfigurationImplementationProtocol exportName=ID 'from' path=USE_IMPORT_PATH;

ConfigurationImplementationProtocol returns string:
    'nav' | 'provider';

type PrimitiveValueDeclaration = NavDeclaration | DatasourceDeclaration;

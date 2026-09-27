grammar TaoConfiguration

import "./types"
import "./visibility"
import "./terminals"

entry ConfigurationGrammarEntrypoint:
    // Includes declaration-contract helpers consumed from `types` so Langium marks them reachable.
    NavDeclaration | DatasourceDeclaration | ConfigurationDeclarationBlock | ConfigurationIssues | ConfigurationAccepts
    | ConfigurationSupports;

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

// Pairing: an auth provider type issues sign-in proofs, and a datasource type accepts proofs and
// supports data capabilities. Proof kinds, capabilities, and levels are closed vocabularies parsed
// as `ID` and validated against their tables, so none of those words becomes a keyword.
ConfigurationIssues:
    'issues' '{' (proofs+=ConfigurationIssuedProof (',' proofs+=ConfigurationIssuedProof)*)? '}';

ConfigurationIssuedProof:
    kind=ID;

ConfigurationAccepts:
    'accepts' '{' (proofs+=ConfigurationAcceptedProof (',' proofs+=ConfigurationAcceptedProof)*)? '}';

// `from` names the auth provider type the proof must come from.
ConfigurationAcceptedProof:
    kind=ID ('from' issuer=NamedTypeReference)?;

ConfigurationSupports:
    'supports' '{' (capabilities+=ConfigurationCapability (',' capabilities+=ConfigurationCapability)*)? '}';

ConfigurationCapability:
    capability=ID level=ID?;

type PrimitiveValueDeclaration = NavDeclaration | DatasourceDeclaration;

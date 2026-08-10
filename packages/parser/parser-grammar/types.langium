grammar TaoTypes

import "./data"
import "./expressions"
import "./visibility"
import "./terminals"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    TypeDeclaration | ParameterTypeDeclaration | ConstructorTypeReference;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID 'is' type=TypeExpression;

TypeExpression:
    ItemTypeExpression | TypeReference;

ItemTypeExpression:
    '{' properties+=TypeProperty* '}';

TypeProperty:
    name=ID ('is' type=TypeReference)?;

// A defaulted parameter may be omitted at call sites; the default value is bound instead.
ParameterTypeDeclaration:
    name=ID 'is' type=TypeExpression ('default' defaultValue=PrimaryExpression)?;

TypeReference:
    PrimitiveTypeReference | NamedTypeReference;

ConstructorTypeReference:
    ConstructablePrimitiveTypeReference | NamedTypeReference;

PrimitiveTypeReference:
    primitive=PrimitiveType;

ConstructablePrimitiveTypeReference:
    primitive=ConstructablePrimitiveType;

NamedTypeReference:
    root=ID ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list' | 'action';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration | EntityDeclaration | FieldDeclaration;

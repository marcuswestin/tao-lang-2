grammar TaoTypes

import "./visibility"
import "./terminals"

entry TypesGrammarEntrypoint:
    TypeDeclaration | ParameterTypeDeclaration | ConstructorTypeReference;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID 'is' type=TypeExpression;

TypeExpression:
    ItemTypeExpression | TypeReference;

ItemTypeExpression:
    '{' properties+=TypeProperty* '}';

TypeProperty:
    name=ID ('is' type=TypeReference)?;

ParameterTypeDeclaration:
    name=ID 'is' type=TypeExpression;

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
    'text' | 'number' | 'item' | 'list' | 'action';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

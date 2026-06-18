grammar TaoTypes

import "./visibility"
import "./terminals"

entry TypesGrammarEntrypoint:
    TypeDeclaration;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID 'is' type=TypeExpression;

TypeExpression:
    ItemTypeExpression | TypeReference;

ItemTypeExpression:
    '{' properties+=TypeProperty* '}';

TypeProperty:
    name=ID ('is' type=TypeReference)?;

TypeReference:
    PrimitiveTypeReference | NamedTypeReference;

PrimitiveTypeReference:
    primitive=PrimitiveType;

NamedTypeReference:
    target=[TypeDefinition:ID] ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'item' | 'list' | 'action';

type TypeDefinition = TypeDeclaration | TypeProperty;

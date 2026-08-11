grammar TaoTypes

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

ParameterTypeDeclaration:
    name=ID 'is' type=TypeExpression;

TypeReference:
    ActionTypeReference | PrimitiveTypeReference | NamedTypeReference;

ActionTypeReference:
    'action' '(' (parameterTypes+=TypeReference (',' parameterTypes+=TypeReference)*)? ')';

ConstructorTypeReference:
    ConstructablePrimitiveTypeReference | NamedTypeReference;

PrimitiveTypeReference:
    primitive=PrimitiveType;

ConstructablePrimitiveTypeReference:
    primitive=ConstructablePrimitiveType;

NamedTypeReference:
    root=ID ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time' | 'item' | 'list' | 'action';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

grammar TaoTypes

import "./visibility"
import "./expressions"
import "./terminals"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    PrimitiveDeclaration | TypeDeclaration | EnumDeclaration | ParameterTypeDeclaration | ConstructablePrimitiveTypeReference;

PrimitiveDeclaration:
    'primitive' name=PrimitiveType ('with' slots=ItemTypeExpression)?;

EnumDeclaration:
    visibility=DeclarationVisibility? 'enum' name=ID block=EnumDeclarationBlock;

EnumDeclarationBlock:
    '{' cases+=EnumCase+ '}';

EnumCase:
    name=ID;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID 'is' type=TypeExpression;

TypeExpression:
    DerivedTypeExpression | UnionTypeExpression | ItemTypeExpression | TypeReference;

DerivedTypeExpression:
    base=TypeReference 'with' slots=ItemTypeExpression;

UnionTypeExpression:
    members+=TypeReference ('|' members+=TypeReference)+;

ItemTypeExpression:
    '{' (properties+=TypeProperty (',' properties+=TypeProperty)* ','?)? '}';

TypeProperty:
    name=TypeSlotName type=TypeReference? ('is' value=Expression)?;

TypeSlotName returns string:
    ID | 'implement';

ParameterTypeDeclaration:
    name=ID 'is' type=TypeExpression;

TypeReference:
    ActionTypeReference | PrimitiveTypeReference | NamedTypeReference;

ActionTypeReference:
    'action' '(' (parameterTypes+=TypeReference (',' parameterTypes+=TypeReference)*)? ')';

PrimitiveTypeReference:
    primitive=PrimitiveType;

ConstructablePrimitiveTypeReference:
    primitive=ConstructablePrimitiveType;

NamedTypeReference:
    root=ID ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time' | 'item' | 'list' | 'action' | 'ui' | 'nav' | 'datasource' | 'app';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

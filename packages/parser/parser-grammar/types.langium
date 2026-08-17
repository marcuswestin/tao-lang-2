grammar TaoTypes

import "./visibility"
import "./expressions"
import "./terminals"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    PrimitiveDeclaration | TypeDeclaration | EnumDeclaration | ParameterTypeDeclaration | ConstructablePrimitiveTypeReference;

PrimitiveDeclaration:
    'primitive' name=PrimitiveType ('is' base=PrimitiveType)? ('with' slots=ItemTypeExpression)?;

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
    '{' ((properties+=TypeProperty | keys+=ConfigurationKeyDeclaration | implementations+=ConfigurationImplementation) ','?)* '}';

TypeProperty:
    (((optional?='optional' name=ID | name=ID) type=TypeReference?) | name='implement')
    ('is' value=Expression)?;

ParameterTypeDeclaration:
    name=ID 'is' type=TypeExpression;

TypeReference:
    ActionTypeReference | ListTypeReference | PrimitiveTypeReference | NamedTypeReference;

ActionTypeReference:
    'action' '(' (parameterTypes+=TypeReference (',' parameterTypes+=TypeReference)*)? ')';

PrimitiveTypeReference:
    primitive=NonListPrimitiveType;

ListTypeReference:
    'list' 'of' elementType=TypeReference;

ConstructablePrimitiveTypeReference:
    primitive=ConstructablePrimitiveType;

NamedTypeReference:
    root=ID ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time' | 'item' | 'list' | 'action' | 'design'
    | 'visual' | 'presentable' | 'view' | 'layout' | 'frame' | 'ui' | 'nav' | 'datasource' | 'app';

NonListPrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time' | 'item' | 'action' | 'design'
    | 'visual' | 'presentable' | 'view' | 'layout' | 'frame' | 'ui' | 'nav' | 'datasource' | 'app';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

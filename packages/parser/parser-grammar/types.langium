grammar TaoTypes

import "./visibility"
import "./expressions"
import "./terminals"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    PrimitiveDeclaration | TypeDeclaration | ParameterTypeDeclaration | ConstructablePrimitiveTypeReference | TraitList;

PrimitiveDeclaration:
    'primitive' name=PrimitiveType ('is' base=PrimitiveType)? ('with' slots=ItemTypeExpression)?;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID 'is' type=TypeExpression;

TypeExpression:
    DerivedTypeExpression | UnionTypeExpression | CaseSetTypeExpression | YesNoTypeExpression | ItemTypeExpression | TypeReference;

DerivedTypeExpression:
    base=TypeReference 'with' slots=ItemTypeExpression;

UnionTypeExpression:
    members+=TypeReference ('|' members+=TypeReference)+;

// A closed case set. Replaces the nominal `enum Name { Cases }`.
CaseSetTypeExpression:
    'one' 'of' cases+=CaseSetCase (',' cases+=CaseSetCase)*;

CaseSetCase:
    name=ID | literal=STRING;

// The alias precedes `no`, so the keyword terminates it and no contextual lexer token is needed.
YesNoTypeExpression:
    'yes' '/' negativeName=ID? 'no';

// The structural record type. No `item` keyword: `item { ... }` constructs a value.
ItemTypeExpression:
    '{' ((properties+=TypeProperty | keys+=ConfigurationKeyDeclaration | implementations+=ConfigurationImplementation) ','?)* '}';

// A postfix `?` carries optionality. Item fields take no trait list.
TypeProperty:
    ((name=ID type=TypeReference? optional?='?'?) | name='implement')
    ('is' value=Expression)?;

// The closed trailing trait list, carried by `data` declaration fields only.
TraitList:
    '(' traits+=Trait (',' traits+=Trait)* ')';

Trait:
    'default' (defaultValue=(StringLiteral | NumberLiteral | BooleanLiteral | NowExpression) | defaultCase=ID)
    | 'relation' relationName=ID
    | 'required' sentence=STRING
    | touchOnChange?='touch' 'on' 'change'
    | owned?='owned'
    | ordered?='ordered'
    | unique?='unique'
    | search?='search'
    | device?='device';

// Juxtaposition replaces `Name is Type`; a postfix `?` marks optionality.
ParameterTypeDeclaration:
    name=ID type=TypeExpression optional?='?'?;

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

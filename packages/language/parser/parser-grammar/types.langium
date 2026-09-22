grammar TaoTypes

import "./visibility"
import "./expressions"
import "./imports"
import "./terminals"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    PrimitiveDeclaration | TypeDeclaration | ParameterTypeDeclaration | ConstructablePrimitiveTypeReference | TraitList;

PrimitiveDeclaration:
    'primitive' name=PrimitiveType ('is' base=PrimitiveType)? ('with' slots=ItemTypeExpression)?;

TypeDeclaration:
    visibility=DeclarationVisibility? 'type' name=ID
    ('is' type=TypeExpression | '=' aliasTarget=PackageMemberReference);

TypeExpression:
    ProjectedItemTypeExpression | DerivedTypeExpression | UnionTypeExpression | CaseSetTypeExpression | YesNoTypeExpression | ItemTypeExpression | TypeReference;

ProjectedItemTypeExpression:
    base=TypeReference ('{' fields+=ID (',' fields+=ID)* '}' | 'without' '{' excludedFields+=ID (',' excludedFields+=ID)* '}');

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

// The closed trailing trait list, carried by `data` declaration fields only. A trait spelled as a
// plain word (`title`) is parsed as an ID and its spelling validated, so the word stays an ordinary
// name everywhere else — a design bundle called `title` is exactly what an app declares — rather
// than becoming a global lexer keyword.
TraitList:
    '(' traits+=Trait (',' traits+=Trait)* ')';

Trait:
    'default' (defaultValue=(StringLiteral | NumberLiteral | BooleanLiteral | NowExpression) | defaultCase=ID)
    | 'relation' relationName=ID
    | reference?='reference' referenceName=ID?
    | 'required' sentence=STRING
    | touchOnChange?='touch' 'on' 'change'
    | owned?='owned'
    | ordered?='ordered'
    | unique?='unique'
    | search?='search'
    | device?='device'
    | word=ID;

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
    'text' | 'number' | 'boolean' | 'time' | 'duration' | 'item' | 'list' | 'action' | 'shortcut'
    | 'command' | 'design' | 'view' | 'scene' | 'nav' | 'datasource' | 'data' | 'app';

NonListPrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time' | 'duration' | 'item' | 'action' | 'shortcut' | 'command'
    | 'design' | 'view' | 'scene' | 'nav' | 'datasource' | 'data' | 'app';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

// `ns.Member` reaches one declaration of an imported package without bringing its name into the
// file's own scope, so a re-export may share the member's name without shadowing it.
PackageMemberReference:
    namespace=[UsePackageStatement:ID] '.' member=[Declaration:ID];

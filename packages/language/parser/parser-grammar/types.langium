grammar TaoTypes

import "./visibility"
import "./expressions"
import "./imports"
import "./numeric-units"
import "./terminals"
import "./views"

entry TypesGrammarEntrypoint:
    // Includes type helper rules consumed from imported grammar modules so Langium marks them reachable.
    PrimitiveDeclaration | TypeDeclaration | ParameterTypeDeclaration | ConstructablePrimitiveTypeReference | GenericTypeParameter | TraitList;

GenericTypeParameter:
    'type' name=ID 'is' bounds+=TypeReference ('and' bounds+=TypeReference)*;

PrimitiveDeclaration:
    'primitive' name=PrimitiveType ('is' base=PrimitiveType)? ('with' slots=ItemTypeExpression)?;

TypeDeclaration:
    visibility=DeclarationVisibility?
    (abstract?='abstract'? 'type' name=ID ('is' type=TypeExpression | '=' aliasTarget=PackageMemberReference)
      | 'can' name=ID type=CapabilityTypeExpression)
    ('with' associated=RecordAssociatedBody)?;

RecordAssociatedBody infers ItemTypeExpression:
    '{' ((actions+=ActionDeclaration | methods+=AssociatedFunctionDeclaration | views+=AssociatedViewDeclaration
      | converters+=AssociatedConverterDeclaration) ','?)* '}';

CapabilityTypeExpression:
    '{' ((methods+=CapabilityMethodDeclaration | actions+=CapabilityActionDeclaration) ','?)* '}';

// Failure bounds are contextual names; `never` remains available as an ordinary identifier.
CapabilityMethodDeclaration:
    name=AssociatedFunctionName parameterList=ParameterList ('fails' failureBound=ID (',' additionalFailureBounds+=ID)*)? '->' returnType=TypeExpression;

// Action requirements remain actions so matching cannot satisfy a command contract with a pure function.
CapabilityActionDeclaration:
    static?='static'? 'action' name=ID parameterList=ParameterList
    ('fails' failureBound=ID (',' additionalFailureBounds+=ID)*)? ('->' returnType=TypeExpression)?;

// Explicit converters are function bodies with source/target contracts and no value slots.
AssociatedConverterDeclaration:
    conversionSource=TypeReference 'as' conversionTarget=TypeReference
    ('fails' failureBounds+=ID (',' failureBounds+=ID)*)? block=FunctionBlock;

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

type FailureDeclaration = CaseSetCase | TypeDeclaration;

// The alias precedes `no`, so the keyword terminates it and no contextual lexer token is needed.
YesNoTypeExpression:
    'yes/no' | 'yes' '/' negativeName=ID? 'no';

// The structural record type. No `item` keyword: `item { ... }` constructs a value.
ItemTypeExpression:
    '{' ((properties+=TypeProperty | keys+=ConfigurationKeyDeclaration | implementations+=ConfigurationImplementation
      | issues+=ConfigurationIssues | accepts+=ConfigurationAccepts | supports+=ConfigurationSupports
      | unitBlocks+=NumericUnitBlock | methods+=AssociatedFunctionDeclaration | views+=AssociatedViewDeclaration
      | actions+=ActionDeclaration | converters+=AssociatedConverterDeclaration) ','?)* '}';

// A postfix `?` carries optionality. Item fields take no trait list.
TypeProperty:
    ((name=MetadataName type=TypeReference? optional?='?'?) | name='implement')
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
    YesNoTypeExpression | ActionTypeReference | ListTypeReference | PrimitiveTypeReference | NamedTypeReference;

ActionTypeReference:
    'action' '(' (parameterTypes+=TypeReference (',' parameterTypes+=TypeReference)*)? ')';

PrimitiveTypeReference:
    primitive=NonListPrimitiveType;

ListTypeReference:
    'list' 'of' elementType=TypeReference;

ConstructablePrimitiveTypeReference:
    primitive=ConstructablePrimitiveType;

NamedTypeReference:
    root=(ID | 'type') ('.' members+=ID)*;

PrimitiveType returns string:
    'text' | 'number' | 'numeric' | 'boolean' | 'time' | 'duration' | 'color' | 'item' | 'list' | 'action' | 'shortcut'
    | 'command' | 'design' | 'view' | 'scene' | 'nav' | 'datasource' | 'data' | 'app' | 'rendered';

NonListPrimitiveType returns string:
    'text' | 'number' | 'numeric' | 'boolean' | 'time' | 'duration' | 'color' | 'item' | 'action' | 'shortcut' | 'command'
    | 'design' | 'view' | 'scene' | 'nav' | 'datasource' | 'data' | 'app' | 'rendered';

ConstructablePrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'item' | 'list';

type TypeDefinition = TypeDeclaration | TypeProperty | ParameterTypeDeclaration;

// `ns.Member` reaches one declaration of an imported package without bringing its name into the
// file's own scope, so a re-export may share the member's name without shadowing it.
PackageMemberReference:
    namespace=[UsePackageStatement:ID] '.' member=[Declaration:ID];

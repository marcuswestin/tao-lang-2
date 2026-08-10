grammar TaoData

import "./expressions"
import "./visibility"
import "./terminals"

entry DataGrammarEntrypoint:
    DataDeclaration | QueryDeclaration | CreateStatement | UpdateStatement | DeleteStatement;

// A data declaration names one schema of collections; each collection declares one entity shape.
DataDeclaration:
    visibility=DeclarationVisibility? 'data' name=ID '{' entities+=EntityDeclaration* '}';

EntityDeclaration:
    collection=ID '/' name=ID '{' fields+=FieldDeclaration* '}';

// A field with no type names an entity in the same schema and stores that entity's identifier.
FieldDeclaration:
    name=ID type=FieldType? indexed?='indexed'? ('default' defaultValue=FieldDefault)?;

FieldType returns string:
    'text' | 'number' | 'boolean' | 'time';

FieldDefault:
    StringLiteral | NumberLiteral | BooleanLiteral | NowExpression;

NowExpression:
    now?='now' '(' ')';

// A query reads one collection; `where` and `order` name the queried entity's fields directly.
QueryDeclaration:
    'query' name=ID '=' collection=NamedTypeReference ('where' condition=OrExpression)? ('order' order=QueryOrder)?;

QueryOrder:
    field=[FieldDeclaration:ID] direction=QueryDirection?;

QueryDirection returns string:
    'asc' | 'desc';

CreateStatement:
    'create' entity=NamedTypeReference '{' (fields+=FieldValue (',' fields+=FieldValue)*)? '}';

UpdateStatement:
    'update' target=MemberOrValueExpression '{' (fields+=FieldValue (',' fields+=FieldValue)*)? '}';

DeleteStatement:
    'delete' target=MemberOrValueExpression;

FieldValue:
    field=[FieldDeclaration:ID] ':' value=Expression;

MemberOrValueExpression:
    MemberAccessExpression | ValueReference;

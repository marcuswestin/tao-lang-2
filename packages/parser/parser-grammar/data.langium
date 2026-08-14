grammar TaoData

import "./expressions"
import "./visibility"
import "./terminals"

entry DataGrammarEntrypoint:
    EntityDataDeclaration | EntityQueryDeclaration | CreateStatement | UpdateStatement | DeleteStatement;

EntityDataDeclaration:
    visibility=DeclarationVisibility? 'data' name=ID '/' singularName=ID block=EntityDataDeclarationBlock;

EntityDataDeclarationBlock:
    '{' entries+=(EntityDataField | DataIndex | DataDefaultOrder)* '}';

EntityDataField:
    name=ID (primitive=DataPrimitiveType | '/' negativeName=ID)? (',' modifiers+=EntityDataFieldModifier)*;

EntityDataFieldModifier:
    'default' (defaultValue=(StringLiteral | NumberLiteral | BooleanLiteral | NowExpression) | defaultCase=ID)
    | 'on' 'delete' onDeleteCascade?='cascade';

DataIndex:
    'index' fieldName=ID;

DataDefaultOrder:
    'order' 'by' fieldName=ID direction=OrderDirection?;

DataPrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time';

NowExpression:
    {infer NowExpression} 'now' '(' ')';

EntityQueryDeclaration:
    'query' (sourceName=ID 'as' name=ID | name=ID ('from' source=MemberAccessExpression)?) block=QueryBlock?;

QueryBlock:
    '{' clauses+=QueryClause* '}';

QueryClause:
    WhereClause | BooleanWhereClause | OrderClause;

WhereClause:
    'where' fieldName=ID operator=QueryComparisonOperator value=Expression;

BooleanWhereClause:
    'where' case=[EntityDataField:ID];

QueryComparisonOperator returns string:
    '==' | '!=' | '<' | '<=' | '>' | '>=';

OrderClause:
    'order' 'by' fieldName=ID direction=OrderDirection?;

OrderDirection returns string:
    'asc' | 'desc';

CreateStatement:
    'create' entity=[EntityDataDeclaration:ID] block=DataWriteBlock;

UpdateStatement:
    'update' target=DataRowExpression block=DataWriteBlock;

DeleteStatement:
    'delete' target=DataRowExpression;

DataRowExpression infers Expression:
    MemberAccessExpression | ValueReference;

DataWriteBlock:
    '{' (fields+=DataWriteField (','? fields+=DataWriteField)*)? '}';

DataWriteField:
    (label=ID ':')? value=Expression;

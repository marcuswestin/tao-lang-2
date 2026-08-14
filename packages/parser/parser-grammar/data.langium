grammar TaoData

import "./expressions"
import "./visibility"
import "./terminals"

entry DataGrammarEntrypoint:
    DataDeclaration | QueryDeclaration | CreateStatement | UpdateStatement | DeleteStatement;

DataDeclaration:
    visibility=DeclarationVisibility? 'data' name=ID block=DataBlock;

DataBlock:
    '{' entities+=DataEntity* '}';

DataEntity:
    collectionName=ID name=ID block=DataEntityBlock;

DataEntityBlock:
    '{' fields+=DataField* '}';

DataField:
    name=ID (
        primitive=DataPrimitiveType indexed?='indexed'? ('default' defaultValue=(StringLiteral | NumberLiteral | BooleanLiteral | NowExpression))?
        | 'relation' relation=[DataEntity:ID] ('on' 'delete' onDeleteCascade?='cascade')?
    );

DataPrimitiveType returns string:
    'text' | 'number' | 'boolean' | 'time';

NowExpression:
    {infer NowExpression} 'now' '(' ')';

QueryDeclaration:
    'query' data=[DataDeclaration:ID] '.' collectionName=ID 'as' name=ID block=QueryBlock?;

QueryBlock:
    '{' clauses+=QueryClause* '}';

QueryClause:
    WhereClause | OrderClause;

WhereClause:
    'where' fieldName=ID operator=QueryComparisonOperator value=Expression;

QueryComparisonOperator returns string:
    '==' | '!=' | '<' | '<=' | '>' | '>=';

OrderClause:
    'order' 'by' fieldName=ID direction=OrderDirection?;

OrderDirection returns string:
    'asc' | 'desc';

CreateStatement:
    'create' data=[DataDeclaration:ID] '.' entityName=ID block=DataWriteBlock;

UpdateStatement:
    'update' target=DataRowExpression block=DataWriteBlock;

DeleteStatement:
    'delete' target=DataRowExpression;

DataRowExpression infers Expression:
    MemberAccessExpression | ValueReference;

DataWriteBlock:
    '{' fields+=DataWriteField* '}';

DataWriteField:
    name=ID value=Expression;

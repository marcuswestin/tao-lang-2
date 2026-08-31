grammar TaoScenarios

import "./actions"
import "./app"
import "./data"
import "./expressions"
import "./terminals"

entry ScenariosGrammarEntrypoint:
    FixtureDeclaration | ScenarioGroupDeclaration;

// A fixture is reusable setup truth: named accounts plus named rows created in declaration order.
// This slice intentionally carries only the literal/reference value surface Decisions §16 spells.
FixtureDeclaration:
    'fixture' name=ID block=FixtureBlock;

FixtureBlock:
    '{' entries+=(FixtureAccountDeclaration | FixtureCreateBinding)* '}';

type FixtureEntry = FixtureAccountDeclaration | FixtureCreateBinding;
type FixtureValueDeclaration = FixtureAccountDeclaration | FixtureCreateBinding;

FixtureAccountDeclaration:
    'account' name=ID block=FixtureFieldBlock;

FixtureCreateBinding:
    name=ID '=' 'create' entity=[EntityDataDeclaration:ID] block=FixtureFieldBlock
    through=FixtureThroughClause? ('for' account=[FixtureAccountDeclaration:ID])?;

FixtureThroughClause:
    'through' action=[ActionDeclaration:ID] '(' argumentList=FixtureArgumentList? ')';

FixtureArgumentList:
    arguments+=FixtureArgument (',' arguments+=FixtureArgument)*;

FixtureArgument:
    (label=ID ':')? value=FixtureValue;

FixtureFieldBlock:
    '{' (fields+=FixtureField (','? fields+=FixtureField)*)? '}';

FixtureField:
    name=ID ':' value=FixtureValue;

FixtureValue:
    StringLiteral | NumberLiteral | BooleanLiteral | NowExpression | FixtureValueReference;

FixtureValueReference:
    target=[FixtureValueDeclaration:ID];

// A scenario group is a named row of related app or focused-view states. The optional subject is
// the default app or view for every entry; any clause in an entry replaces the same group clause.
ScenarioGroupDeclaration:
    'scenarios' subject=[ScenarioSubjectDeclaration:ID]? name=STRING block=ScenarioGroupBlock;

type ScenarioSubjectDeclaration = AppValueDeclaration | ViewDeclaration;

ScenarioGroupBlock:
    '{' entries+=(ScenarioFixtureClause | ScenarioPrepareClause | ScenarioRunClause
        | ScenarioRenderClause | ScenarioDeviceClause | ScenarioAppearanceClause
        | ScenarioLocaleClause | ScenarioDirectionClause | ScenarioNetworkClause
        | ScenarioDeclaration)* '}';

// Entry strings are the stable identities within their group. A one-entry group is the canonical
// spelling for a single display; there is no separate singular top-level form.
ScenarioDeclaration:
    'scenario' name=STRING block=ScenarioBlock;

ScenarioBlock:
    '{' entries+=(ScenarioFixtureClause | ScenarioPrepareClause | ScenarioRunClause
        | ScenarioRenderClause | ScenarioDeviceClause | ScenarioAppearanceClause
        | ScenarioLocaleClause | ScenarioDirectionClause | ScenarioNetworkClause)* '}';

type ScenarioClause = ScenarioFixtureClause | ScenarioPrepareClause | ScenarioRunClause
    | ScenarioRenderClause
    | ScenarioDeviceClause | ScenarioAppearanceClause | ScenarioLocaleClause
    | ScenarioDirectionClause | ScenarioNetworkClause;

ScenarioFixtureClause:
    'fixture' fixture=[FixtureDeclaration:ID];

ScenarioPrepareClause:
    'prepare' block=ScenarioPrepareBlock;

ScenarioPrepareBlock:
    '{' statements+=ScenarioPrepareUpdate* '}';

// Decisions fixes `prepare { update … }` as ordinary data. Other preparation statements wait for
// their own exact spelling and runtime contract.
ScenarioPrepareUpdate:
    'update' target=[FixtureValueDeclaration:ID] block=FixtureFieldBlock;

ScenarioRunClause:
    'run' app=[AppValueDeclaration:ID]?
    ('at' destination=ID '(' argumentList=FixtureArgumentList? ')')?;

ScenarioRenderClause:
    'render' view=[ViewDeclaration:ID]? '(' argumentList=ScenarioRenderArgumentList? ')';

ScenarioRenderArgumentList:
    arguments+=ScenarioRenderArgument (',' arguments+=ScenarioRenderArgument)*;

ScenarioRenderArgument:
    label=ID ':' value=FixtureValue;

ScenarioDeviceClause:
    'device' device=('phone' | 'tablet' | 'laptop')
    (width=NUMBER 'x' height=NUMBER)?;

ScenarioAppearanceClause:
    'appearance' appearance=('light' | 'dark');

ScenarioLocaleClause:
    'locale' (locale=STRING | pseudolocale?='pseudolocale');

ScenarioDirectionClause:
    direction='direction' rightToLeft='rightToLeft';

ScenarioNetworkClause:
    'network' network=('offline' | 'online');

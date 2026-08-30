grammar TaoTests

import "./app"
import "./blocks"
import "./data"
import "./visibility"
import "./terminals"

entry TestsGrammarEntrypoint:
    TestDeclaration;

// A test declares what it exercises before what it asserts: `test Button "Handles press" { … }`,
// or `test Button { test "…" { … } }` for a group. Visibility lets a package publish its suite, so
// another implementation can be held to the same journeys.
TestDeclaration:
    visibility=DeclarationVisibility? 'test'
    (dependencies+=[Declaration:ID] (',' dependencies+=[Declaration:ID])*)?
    name=STRING? block=Block;

type CheckStep = RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | AdvanceStep | ExpectNavigationTitleStep | ExpectToolbarCommandStep | PressToolbarCommandStep;

RunStep:
    'run' app=[AppValueDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector? text=STRING;

TagPressStep:
    'press' tag=TagOrHexColor;

PressToolbarCommandStep:
    'press' surface=ID 'command' value=Expression;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

ExpectNavigationTitleStep:
    'expect' 'navigation' subject=ID value=Expression;

ExpectToolbarCommandStep:
    'expect' surface=ID 'command' value=Expression state=('enabled' | 'disabled');

ExpectCheckboxStateStep:
    'expect' 'checkbox' tag=TagOrHexColor state=('checked' | 'unchecked');

ExpectInputValueStep:
    'expect' 'input' selector=InputTestSelector target=STRING 'value' value=STRING;

TagInputValueExpectation:
    'expect' tag=TagOrHexColor 'input' 'value' value=STRING;

ExpectGroupStep:
    'expect' block=TestExpectationBlock;

ExpectScopeStep:
    'expect' tag=TagOrHexColor block=TestExpectationBlock;

TestExpectationBlock:
    '{' expectations+=TestExpectation* '}';

TestExpectation:
    (missing?='missing'? selector=('text' | 'label' | 'placeholder') value=STRING)
    | ('input' 'value' value=STRING);

EnterTextStep:
    'enter' value=STRING 'into' selector=TestSelector? target=STRING;

TagEnterStep:
    'enter' value=STRING 'into' tag=TagOrHexColor;

SubmitInputStep:
    'submit' selector=TestSelector? target=STRING;

TagSubmitStep:
    'submit' tag=TagOrHexColor;

SelectStep:
    'select' tag=TagOrHexColor '[' index=NUMBER ']' block=Block;

BackTestStep:
    {infer BackTestStep} 'back';

// Every check holds the clock still, so a journey over anything that ticks is deterministic.
// `advance` moves it by a duration, firing every callback that falls due, in order.
AdvanceStep:
    'advance' duration=Expression;

TestSelector returns string:
    'text' | 'label' | 'placeholder';

InputTestSelector returns string:
    'label' | 'placeholder';

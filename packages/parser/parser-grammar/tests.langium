grammar TaoTests

import "./app"
import "./blocks"
import "./data"
import "./terminals"

entry TestsGrammarEntrypoint:
    TestDeclaration;

TestDeclaration:
    'test' name=STRING block=Block;

type CheckStep = RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | AdvanceStep;

RunStep:
    'run' app=[AppValueDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector? text=STRING;

TagPressStep:
    'press' tag=TagOrHexColor;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

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

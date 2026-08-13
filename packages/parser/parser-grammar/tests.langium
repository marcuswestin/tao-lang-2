grammar TaoTests

import "./app"
import "./blocks"
import "./data"
import "./terminals"

entry TestsGrammarEntrypoint:
    TestDeclaration;

TestDeclaration:
    'test' name=STRING block=Block;

CheckDeclaration:
    'check' name=STRING block=Block;

type CheckStep = RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | DataStatusStep;

RunStep:
    'run' app=[AppDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector text=STRING;

TagPressStep:
    'press' tag=TAG;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

ExpectInputValueStep:
    'expect' 'input' selector=InputTestSelector target=STRING 'value' value=STRING;

TagInputValueExpectation:
    'expect' tag=TAG 'input' 'value' value=STRING;

ExpectGroupStep:
    'expect' block=TestExpectationBlock;

ExpectScopeStep:
    'expect' tag=TAG block=TestExpectationBlock;

TestExpectationBlock:
    '{' expectations+=TestExpectation* '}';

TestExpectation:
    (missing?='missing'? selector=('text' | 'label' | 'placeholder') value=STRING)
    | ('input' 'value' value=STRING);

EnterTextStep:
    'enter' value=STRING 'into' selector=TestSelector target=STRING;

TagEnterStep:
    'enter' value=STRING 'into' tag=TAG;

SubmitInputStep:
    'submit' selector=TestSelector target=STRING;

TagSubmitStep:
    'submit' tag=TAG;

SelectStep:
    'select' tag=TAG '[' index=NUMBER ']' block=Block;

BackTestStep:
    {infer BackTestStep} 'back';

DataStatusStep:
    'data' (status=('loading' | 'ready') | 'error' message=STRING);

TestSelector returns string:
    'text' | 'label' | 'placeholder';

InputTestSelector returns string:
    'label' | 'placeholder';

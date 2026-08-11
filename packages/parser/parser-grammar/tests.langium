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

type CheckStep = RunStep | PressTextStep | ExpectTextStep | ExpectInputValueStep | EnterTextStep | SubmitInputStep | BackTestStep | DataStatusStep;

RunStep:
    'run' app=[AppDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector text=STRING;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

ExpectInputValueStep:
    'expect' 'input' selector=InputTestSelector target=STRING 'value' value=STRING;

EnterTextStep:
    'enter' value=STRING 'into' selector=TestSelector target=STRING;

SubmitInputStep:
    'submit' selector=TestSelector target=STRING;

BackTestStep:
    {infer BackTestStep} 'back';

DataStatusStep:
    'data' data=[DataDeclaration:ID] (status=('loading' | 'ready') | 'error' message=STRING);

TestSelector returns string:
    ID | 'text' | 'label' | 'id' | 'placeholder';

InputTestSelector returns string:
    ID | 'label' | 'id' | 'placeholder';

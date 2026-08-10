grammar TaoTests

import "./app"
import "./blocks"
import "./terminals"

entry TestsGrammarEntrypoint:
    TestDeclaration;

TestDeclaration:
    'test' name=STRING block=Block;

CheckDeclaration:
    'check' name=STRING block=Block;

type CheckStep = RunStep | PressTextStep | ExpectTextStep | EnterTextStep | SubmitInputStep;

RunStep:
    'run' app=[AppDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector text=STRING;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

EnterTextStep:
    'enter' value=STRING 'into' selector=TestSelector target=STRING;

SubmitInputStep:
    'submit' selector=TestSelector target=STRING;

TestSelector returns string:
    ID | 'text' | 'label' | 'id';

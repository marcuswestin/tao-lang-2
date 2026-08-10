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

type CheckStep = RunStep | PressTextStep | ExpectTextStep | ExpectInputStep | WriteStep | SubmitStep;

RunStep:
    'run' app=[AppDeclaration:ID] ('with' '{' config+=RunConfig* '}')?;

// A run config makes an otherwise timing-dependent provider state deterministic for one check.
RunConfig:
    'data' state=RunDataState;

RunDataState returns string:
    'loading' | 'failing';

PressTextStep:
    'press' selector=TestSelector text=STRING;

ExpectTextStep:
    'expect' missing?='missing'? selector=TestSelector text=STRING;

// Input assertions and editing steps address a focused editable control.
ExpectInputStep:
    'expect' 'input' selector=TestSelector text=STRING 'value' value=STRING;

WriteStep:
    'write' text=STRING;

SubmitStep:
    submit?='submit';

TestSelector returns string:
    ID | 'text';

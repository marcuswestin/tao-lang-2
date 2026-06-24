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

type CheckStep = RunStep | ExpectTextStep;

RunStep:
    'run' app=[AppDeclaration:ID];

ExpectTextStep:
    'expect' missing?='missing'? 'text' text=STRING;

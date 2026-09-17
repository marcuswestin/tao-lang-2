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
    name=STRING? block=TestBlock;

// Test blocks use the broad diagnostic statement family but deliberately exclude a declaration
// slot fill. That is what lets the ID-headed `narrow "..."` seam remain spelling-validated without
// becoming grammatically indistinguishable from `Title "..."` in an ordinary view body.
TestBlock returns Block:
    '{' statements+=(AppBlockDiagnosticStatement | InteractionWordStep)* '}';

type CheckStep = RunStep | PressTextStep | TagPressStep | PressWordStep | InteractionWordStep
    | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep
    | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | ExpectInteractionStep
    | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep
    | RelaunchStep | AdvanceStep | ExpectNavigationTitleStep | ExpectToolbarCommandStep
    | PressToolbarCommandStep;

RunStep:
    'run' app=[AppValueDeclaration:ID];

PressTextStep:
    'press' selector=TestSelector? text=STRING;

TagPressStep:
    'press' tag=TagOrHexColor;

// Phase and pointer steps are ordinary test steps as well as the deliberately narrow journey
// surface scenarios may replay. A phase press keeps the same selector family as plain `press`.
PressWordStep:
    'press' subject=ID (selector=TestSelector? target=STRING | tag=TagOrHexColor);

// The ID-headed interaction seam keeps hover, focus, and narrow available as ordinary declaration
// names. Their distinct target shapes and scenario eligibility are semantic validation concerns.
InteractionWordStep:
    head=ID (selector=TestSelector? target=STRING | tag=TagOrHexColor);

// Interaction vocabulary stays ID-headed and spelling-validated. `key`, `narrow`, `target`,
// `focus`, `region`, and `verbs` therefore remain available as ordinary names elsewhere.
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

// One rule owns `expect target`, `expect focus region`, and `expect verbs`. Target and a one-verb
// expectation have the same token shape, so their distinct meaning is validated from `subject`.
ExpectInteractionStep:
    'expect' subject=ID detail=ID? values+=STRING (',' values+=STRING)*;

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
    'select' tag=TagOrHexColor '[' index=NUMBER ']' block=TestBlock;

BackTestStep:
    {infer BackTestStep} 'back';

// A relaunch is what a person does when they quit the app and open it again: the mounted instance is
// torn down and a fresh one takes its place over the same device, so device-local `(persist)` state
// and stored data outlive it while every ephemeral view state does not. The new instance restores
// where the person was, exactly as a real relaunch does. `relaunch fresh` opts that one launch out
// of restoring — the launch a device that has never run the app gives — and borrows the word from
// the `Restore fresh` policy that names the same behavior.
RelaunchStep:
    {infer RelaunchStep} 'relaunch' fresh?='fresh'?;

// Every check holds the clock still, so a journey over anything that ticks is deterministic.
// `advance` moves it by a duration, firing every callback that falls due, in order.
AdvanceStep:
    'advance' duration=Expression;

TestSelector returns string:
    'text' | 'label' | 'placeholder';

InputTestSelector returns string:
    'label' | 'placeholder';

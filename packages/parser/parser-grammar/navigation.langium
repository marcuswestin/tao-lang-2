grammar TaoNavigation

import "./expressions"
import "./views"

entry NavigationGrammarEntrypoint:
    PresentStatement | DismissStatement;

// `present` pushes a view onto the app's screen stack; `dismiss` pops the top screen.
PresentStatement:
    'present' view=[ViewDeclaration:ID] InvocationArguments;

DismissStatement:
    dismiss?='dismiss';

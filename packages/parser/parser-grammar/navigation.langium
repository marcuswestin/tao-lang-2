grammar TaoNavigation

import "./expressions"
import "./views"
import "./visibility"
import "./terminals"

entry NavigationGrammarEntrypoint:
    ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement;

ContextualPresentStatement:
    'present' ui=[UiDeclaration:ID] '(' argumentList=ArgumentList? ')' mode=PresentationMode? ('in' target=NavigationTarget)?;

PresentationMode:
    'as' (kind='overlay' | kind='toast' toast=ToastPresentationOptions);

ToastPresentationOptions:
    '(' 'Key' ':' key=Expression ',' 'Duration' ':' duration=Expression ')';

NavigationTarget:
    value=ValueReference | app=[AppValueDeclaration:ID] key=USE_IMPORT_PATH;

// Naming the app is an assertion, not the address: the runtime resolves the enclosing app either
// way. Omitting it targets the nearest enclosing app, which is what lets a screen live in a package.
SelectionActivateStatement:
    'present' app=[AppValueDeclaration:ID]? key=USE_IMPORT_PATH;

DismissStatement:
    {infer DismissStatement} 'dismiss';

ReplaceStatement:
    'replace' navigator=ValueReference ('in' (ambientApp?='app' | app=[AppValueDeclaration:ID]))?;

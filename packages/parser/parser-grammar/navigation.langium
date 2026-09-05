grammar TaoNavigation

import "./expressions"
import "./views"
import "./visibility"
import "./terminals"

entry NavigationGrammarEntrypoint:
    ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement;

ContextualPresentStatement:
    'present' view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')' mode=PresentationMode? ('in' target=NavigationTarget)?;

// A sheet is the platform's own modal presentation — a card that slides up over the content and is
// dismissed by dragging it down or by `dismiss`, hosted by the OS where one exists.
PresentationMode:
    'as' (kind='overlay' | kind='sheet' | kind='toast' toast=ToastPresentationOptions);

// The option names are parsed as IDs and their spelling validated, so `Key` and `Duration` stay
// ordinary words everywhere else — a member named `Key` is exactly what a command declares — rather
// than becoming global lexer keywords.
ToastPresentationOptions:
    '(' keyName=ID ':' key=Expression ',' durationName=ID ':' duration=Expression ')';

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

grammar TaoNavigation

import "./expressions"
import "./views"
import "./visibility"
import "./terminals"

entry NavigationGrammarEntrypoint:
    ContextualPresentStatement | DismissStatement | ReplaceStatement;

ContextualPresentStatement:
    'present' ui=[UiDeclaration:ID] '(' argumentList=ArgumentList? ')' mode=PresentationMode? ('in' target=NavigationTarget)?;

PresentationMode:
    'as' kind='overlay';

NavigationTarget:
    value=ValueReference | app=[AppDeclaration:ID] key=USE_IMPORT_PATH;

DismissStatement:
    {infer DismissStatement} 'dismiss';

ReplaceStatement:
    'replace' navigator=ValueReference 'in' app=[AppDeclaration:ID];

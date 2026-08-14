grammar TaoNavigation

import "./expressions"
import "./views"
import "./visibility"
import "./terminals"

entry NavigationGrammarEntrypoint:
    StackDeclaration | AppStack | PresentStatement | BackStatement;

StackDeclaration:
    visibility=DeclarationVisibility? 'stack' name=ID block=NavigationBlock;

NavigationBlock:
    '{' initial=NavigationInitial destinations+=NavigationDestination+ '}';

NavigationInitial:
    'initial' destinationName=ID;

NavigationDestination:
    'destination' view=[ViewDeclaration:ID];

AppStack:
    'stack' stack=[StackDeclaration:ID];

PresentStatement:
    'present' stack=[StackDeclaration:ID] '.' destinationName=ID '(' argumentList=ArgumentList? ')';

BackStatement:
    'back' stack=[StackDeclaration:ID];

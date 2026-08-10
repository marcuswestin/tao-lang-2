grammar TaoViews

import "./actions"
import "./blocks"
import "./expressions"
import "./injections"
import "./layout"
import "./visibility"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration | LayoutDeclaration;

ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList? block=Block;

type RenderableDeclaration = ViewDeclaration | LayoutDeclaration;

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[RenderableDeclaration:ID] InvocationArguments layoutClause=LayoutClause? events+=EventClause*
            block=Block?);

ViewRender:
    view=[RenderableDeclaration:ID] InvocationArguments layoutClause=LayoutClause? events+=EventClause* block=Block?;

// An event clause binds an interaction to an action body, optionally naming the event's payload.
EventClause:
    'on' event=EventName '->' parameterList=ParameterList? block=ActionBlock;

EventName returns string:
    'press' | 'change' | 'submit';

type Render = RenderStatement | ViewRender;

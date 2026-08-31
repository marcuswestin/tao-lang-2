grammar TaoDesign

import "./layout"
import "./visibility"
import "./terminals"

entry DesignGrammarEntrypoint:
    DesignDeclaration;

// Structured §13 blocks coexist with the absorbed flat surface until WordFlower has fully migrated.
// Members are private declaration-owned data, not independently scoped Tao values.
DesignDeclaration:
    visibility=DeclarationVisibility? 'design' name=ID block=DesignBlock;

DesignBlock:
    '{' members+=DesignMember* '}';

DesignMember:
    DesignToken | DesignBundle | DesignColorsBlock | DesignSizesBlock | DesignTextBlock |
    DesignScreensBlock | DesignStylesBlock;

DesignToken:
    name=ID value=TagOrHexColor;

DesignBundle:
    name=ID spec=LayoutClause;

DesignColorsBlock:
    'colors' '{' (entries+=DesignColorEntry ','?)* '}';

DesignColorEntry:
    name=ID value=DesignColorValue family=DesignColorFamily?;

DesignColorFamily:
    '{' (members+=DesignColorFamilyMember ','?)* '}';

DesignColorFamilyMember:
    name=NUMBER value=DesignColorValue;

DesignColorValue:
    DesignConditionalColor | DesignColorAtom;

DesignConditionalColor:
    'when' environment=ID 'is' expected=ID positive=DesignColorAtom '/' 'not' negative=DesignColorAtom;

DesignColorAtom:
    literal=TagOrHexColor | path=DesignValuePath;

DesignSizesBlock:
    'sizes' '{' (entries+=DesignSizeEntry ','?)* '}';

DesignSizeEntry:
    name=ID value=DesignSizeExpression;

DesignSizeExpression:
    left=DesignSizeAtom (operator='+' right=DesignSizeAtom)?;

DesignSizeAtom:
    dimension=DesignDimension | path=DesignValuePath;

DesignDimension:
    value=NUMBER '.' unit=ID;

DesignTextBlock:
    'text' '{' entries+=DesignTextEntry* '}';

DesignTextEntry:
    name=ID spec=LayoutClause;

DesignScreensBlock:
    'screens' '{' (entries+=DesignScreenEntry (',' entries+=DesignScreenEntry)*)? '}';

DesignScreenEntry:
    name=ID ('below' threshold=DesignDimension)?;

DesignStylesBlock:
    'styles' '{' entries+=DesignStyleEntry* '}';

DesignStyleEntry:
    name=ID spec=LayoutClause;

DesignValuePath:
    head=ID ('.' segments+=DesignValuePathSegment)*;

DesignValuePathSegment returns string:
    ID | NUMBER;

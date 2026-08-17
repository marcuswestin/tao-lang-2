grammar TaoDesign

import "./layout"
import "./visibility"
import "./terminals"

entry DesignGrammarEntrypoint:
    DesignDeclaration;

// Minimal Tao design declarations deliberately expose only flat color tokens and named clause
// bundles. Members are private declaration-owned data, not independently scoped Tao values.
DesignDeclaration:
    visibility=DeclarationVisibility? 'design' name=ID '{' members+=DesignMember* '}';

DesignMember:
    DesignToken | DesignBundle;

DesignToken:
    name=ID value=TagOrHexColor;

DesignBundle:
    name=ID spec=LayoutClause;

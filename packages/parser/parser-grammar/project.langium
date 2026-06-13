grammar TaoProject

import "./terminals"

entry ProjectGrammarEntrypoint:
    ProjectDeclaration;

ProjectDeclaration:
    'project' block=ProjectBlock;

ProjectBlock:
    '{' statements+=ProjectStatement* '}';

ProjectStatement:
    ProjectName | ProjectRemote | ProjectLicense | ProjectRequires;

ProjectName:
    'name' value=STRING;

ProjectRemote:
    'remote' remote=ProjectRemoteValue;

ProjectRemoteValue returns string:
    'none';

ProjectLicense:
    'license' value=ID;

ProjectRequires:
    'requires' value=ID;

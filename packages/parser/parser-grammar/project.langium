grammar TaoProject

import "./terminals"

entry ProjectGrammarEntrypoint:
    ProjectDeclaration;

ProjectDeclaration:
    'project' block=ProjectBlock;

ProjectBlock:
    '{' statements+=ProjectStatement* '}';

ProjectStatement:
    ProjectId | ProjectName | ProjectRemote | ProjectLicense | ProjectRequires;

ProjectId:
    'id' value=STRING;

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

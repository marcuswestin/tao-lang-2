grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./actions"
import "./expressions"
import "./injections"
import "./project"
import "./terminals"

entry TaoFile:
    statements+=Statement*;

grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./actions"
import "./expressions"
import "./injections"
import "./project"
import "./types"
import "./terminals"

entry TaoFile:
    statements+=Statement*;

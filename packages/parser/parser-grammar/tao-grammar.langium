grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./actions"
import "./data"
import "./expressions"
import "./injections"
import "./project"
import "./tests"
import "./types"
import "./terminals"

entry TaoFile:
    statements+=Statement*;

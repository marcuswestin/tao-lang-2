grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./actions"
import "./data"
import "./design"
import "./configuration"
import "./expressions"
import "./injections"
import "./navigation"
import "./project"
import "./tests"
import "./types"
import "./terminals"

entry TaoFile:
    statements+=ParsedStatement*;

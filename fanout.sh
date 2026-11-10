#!/usr/bin/env bash
# fanout: run tasks in parallel across Claude Code and Codex profiles. All logic is in fanout.mjs.
exec node "$(dirname "${BASH_SOURCE[0]}")/fanout.mjs" "$@"

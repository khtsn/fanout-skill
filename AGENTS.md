# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-18
**Commit:** 03315d2
**Branch:** main

## OVERVIEW
Parallel task runner: dependency-free Node ES modules spread a JSON task list across Claude Code / Codex profiles as headless workers. Plus two prose agent skills that drive it. Runs on Windows, macOS and Linux.

## STRUCTURE
```
fanout/
├── fanout.mjs          # CLI: args, profile loading, assignment, workers, results
├── platform.mjs        # OS-specific bits: profile-tool command, codex command, process-tree kill
├── fanout.sh           # exec node fanout.mjs, nothing else
├── test/               # node:test suite, fake claude/codex/ccp/cxp
├── skills/fanout/      # orchestrator skill: splits work, writes worker prompts, runs fanout.sh; uses references/spiral.md
├── skills/clarify/     # interviews user on unclear requests; the two skills hand work to each other
└── runs/               # gitignored output, may hold live worktrees
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI flags / help | `fanout.mjs` `HELP`, arg loop ~L67 | README.md is the user reference; keep in sync with `HELP` when fields/options change |
| Profile discovery | `profileTool`, `loadProfiles`; `platform.mjs` `profileCommand` | Windows: `powershell.exe` + `../{claude,codex}-profiles/{ccp,cxp}.ps1` (override `CCP_PS1`/`CXP_PS1`). POSIX: `bash` + `.bash` (override `CCP_BASH`/`CXP_BASH`). `list --json` always, `pick -n 99 --json` only if some task names no profile |
| Assignment / retry | `choose`, `pinned` | `ranked` merges both tools' profiles; fewest tasks, then most `headroom_percent`; unpinned failure retried once on another profile |
| Worker spawn | `runOnce`; `platform.mjs` `codexCommand` | claude: `claude -p --output-format json` + PERM + `--model`/`--effort`; answer = `result`, `is_error` = failure. codex: `codex <PERM> -c model_reasoning_effort=… exec [-m] --skip-git-repo-check -o <file> -`; Windows via shell (npm `.cmd` shim, args quoted), POSIX direct args |
| Effort default | `DEFAULT_EFFORT`, `effortFor` | `medium` when the task sets none for that tool (not the profile's own) |
| Timeouts | `platform.mjs` `killTree` | Windows `taskkill /T /F`; POSIX workers spawn `detached`, killed by process group (`-pid`) |
| Permission flags | `PERM` | readonly/auto/bypass/profile; same meanings as `ccp`/`cxp perm`; default readonly |
| Result files | `runTask` | `runs/<yyyymmdd-hhmmss>/` (local time) or `--out`: `<id>.prompt.txt`, `<id>.out.md`, `<id>.log`, `<id>.tryN.log` (retries), `summary.json` |
| Worktrees | `git` helper | `worktree: true` → `git worktree add -b fanout/<stamp>/<id>` under `<run>/worktrees/<id>`; worker `cwd` points there |

## CODE MAP
Centrality approximate (grep).

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `HOME_VAR` | const | fanout.mjs:12 | profile env var per tool |
| `DEFAULT_EFFORT` | const | fanout.mjs:13 | effort when task sets none |
| `PERM` | const | fanout.mjs:15 | perm mode → tool flags |
| `checkPerTool` | fn | fanout.mjs:54 | rejects non-plain model/effort (command-line injection guard) |
| `profileTool` | fn | fanout.mjs:95 | runs ccp/cxp, parses JSON |
| `choose` | fn | fanout.mjs:148 | slot picker |
| `runOnce` | fn | fanout.mjs:195 | spawn + timeout |
| `runTask` | fn | fanout.mjs:237 | attempts + retry on other profile |
| `profileCommand` / `codexCommand` / `killTree` | fn | platform.mjs | per-OS command building and kill |

## CONVENTIONS
- ccp/cxp JSON fields (`name`, `number`, `path`, `profile`, `headroom_percent`) are a stable contract; adapt here, never there.
- `home` profile: *delete* `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, don't set it.
- Prompt always via stdin.
- OS branching lives in `platform.mjs`, taking `platform` as a parameter so tests can cover every OS.
- Validation errors → `fail()` → exit 2. Exit 0 only if every task succeeded.

## ANTI-PATTERNS (THIS PROJECT)
- Adding anything to the codex command line without `checkPerTool`-style plain-value validation (Windows runs it through a shell).
- Deleting `runs/<stamp>/worktrees/*` folders directly; use `git worktree remove`.
- Real runs for testing; use the test suite, `--dry-run`, or `perm: readonly` + tiny prompts.
- Adding npm dependencies.

## UNIQUE STYLES
- Skills are prose; code uses only relative paths.

## COMMANDS
```bash
node --test                            # test suite; worker/process tests are POSIX-only
node fanout.mjs tasks.json --dry-run   # assignment only, no workers
node fanout.mjs --help
```
No build or lint.

## NOTES
- Pinned task (`profile` set) skips pool check and is never retried elsewhere.
- `.gitattributes` keeps `*.sh` LF.

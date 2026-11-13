# fanout

Run a list of tasks in parallel across your Claude Code and Codex profiles.

It uses [`ccp`](https://github.com/khtsn/claude-profiles) and [`cxp`](https://github.com/khtsn/codex-profiles) to find the profiles
with the most room left, starts one headless worker per task, and collects each
worker's final answer in one folder.

Supports macOS, Linux and Windows. Needs Node.js 22+, `claude` and `codex` on your
PATH, and the two profile tools in sibling folders:

```text
projects/
  fanout-skill/
  claude-profiles/    # ccp.bash on macOS/Linux; ccp.ps1 on Windows
  codex-profiles/     # cxp.bash on macOS/Linux; cxp.ps1 on Windows
```

On macOS/Linux, fanout calls the native Bash implementations; PowerShell is not
needed. Install the profile tools' dependencies (including `jq`) as described in
their READMEs. For a different layout, set `CCP_BASH` / `CXP_BASH` to their `.bash`
files. Windows uses `powershell.exe` and `CCP_PS1` / `CXP_PS1` overrides.

```bash
git clone https://github.com/khtsn/fanout-skill.git ~/projects/fanout-skill
```

## Use

```bash
~/projects/fanout-skill/fanout.sh tasks.json              # run the tasks in the file
~/projects/fanout-skill/fanout.sh tasks.json --dry-run    # show which profile each task would get
~/projects/fanout-skill/fanout.sh --each "Review src/auth for bugs"   # same prompt to every available profile
```

From PowerShell: `node F:\fanout\fanout.mjs tasks.json`.

## Tasks file

A JSON array. Only `prompt` is required.

```json
[
  { "id": "auth", "prompt": "Review src/auth for bugs. List findings with file and line." },
  { "id": "orders", "tool": "codex", "prompt": "Review src/orders for bugs." },
  { "id": "fix-typo", "tool": "claude", "profile": "work", "perm": "auto", "worktree": true,
    "cwd": "/path/to/project", "prompt": "Fix the typo in README.md and commit." }
]
```

| Field | Meaning | Default |
| --- | --- | --- |
| `prompt` | What the worker should do | required |
| `id` | Name used for the result files | `t1`, `t2`, ... |
| `tool` | `claude` or `codex` | whichever has the most room left |
| `profile` | Profile name or list number; needs `tool` | picked for you |
| `cwd` | Folder the worker runs in | the current folder |
| `perm` | `readonly`, `auto`, `bypass` or `profile` | `readonly` |
| `worktree` | `true` runs the worker in a new git worktree and branch of `cwd` | off |
| `model` | Model the worker uses | the profile's own |
| `effort` | Reasoning effort the worker uses | the profile's own |

`model` and `effort` take either one value or one value per tool:

```json
[
  { "id": "scan", "tool": "claude", "model": "haiku", "effort": "low", "prompt": "..." },
  { "id": "review", "prompt": "...",
    "model": { "claude": "opus", "codex": "gpt-5-codex" },
    "effort": { "claude": "high", "codex": "high" } }
]
```

A model name belongs to one tool, so a single `model` value needs `tool` on the task
(or `--tool` on the run). The per-tool form keeps the task free to run, and be
retried, on either tool; a tool left out of it uses the profile's own setting. The
values go to `claude --model` / `--effort` and to `codex exec -m` /
`-c model_reasoning_effort=`, so the names and levels each tool accepts are the ones
its own CLI accepts. `--dry-run` shows what each task would get, and `summary.json`
records what it ran with.

## Which profile gets a task

Tasks without a `profile` are spread over the profiles that `ccp pick` and `cxp pick`
return: the profile with the fewest tasks so far wins, and ties go to the one with the
most room left. Profiles that are out of the pool, at their limit or not logged in are
never used. To keep an account out of fanouts, run `ccp pool <name> off` or
`cxp pool <name> off`.

A task that names a `profile` always runs there, in or out of the pool.

## Permissions

Workers are **read-only unless you say otherwise**.

| `perm` | Claude | Codex |
| --- | --- | --- |
| `readonly` | plan mode: reads, changes nothing | read-only sandbox |
| `auto` | a classifier approves safe actions | may write inside `cwd` only |
| `bypass` | no prompts at all | no prompts, no sandbox |
| `profile` | the profile's saved mode | the profile's saved mode |

Set it per task, or for the whole run with `--perm <mode>`.

Workers that write to the same folder will overwrite each other. Give each writing
task `"worktree": true`: it gets its own copy of the repository under
`<run folder>/worktrees/<id>` on a branch named `fanout/<run>/<id>`, which you can
review and merge afterwards. Remove one with `git worktree remove <path>`.

## Results

Everything for a run goes in one folder, `<fanout folder>/runs/<timestamp>` unless you pass
`--out <dir>`:

```
<id>.prompt.txt   the prompt the worker got
<id>.out.md       the worker's final answer
<id>.log          its raw output, for when something fails
summary.json      one object per task: id, tool, profile, perm, cwd, status, attempts,
                  seconds, error, out, log, branch, model, effort
```

A table of the same summary is printed at the end. The exit code is 0 when every task
succeeded and 1 when any failed.

A failed task is retried once on a different profile, unless the task named its
profile or you pass `--no-retry`.

## Options

| Option | Effect |
| --- | --- |
| `--perm <mode>` | Default mode for tasks that do not set one |
| `--tool <tool>` | Only use `claude` or `codex` for tasks that do not name a tool |
| `--out <dir>` | Where results go |
| `-j <n>` | Workers running at once (default 8) |
| `--timeout <min>` | Stop a worker after this many minutes (default 60) |
| `--no-retry` | Do not retry a failed task |
| `--dry-run` | Show the assignment and run nothing |

## Agent skills

`skills/` holds two skills for a coding agent:

- `fanout` teaches the agent to act as the orchestrator: how to split a request into
  tasks, pick a team size, write worker prompts, run `fanout.sh` and check the results.
- `clarify` interviews you about a vague request until it is clear enough to act on.
  `fanout` hands over to it when a request is too ambiguous to split, and it also
  works on its own. When it has several separate areas of a project to look at
  before asking, it uses `fanout` to explore them in parallel with read-only workers.

Copy both into your agent's skills folder, side by side:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R ~/projects/fanout-skill/skills/* "${CODEX_HOME:-$HOME/.codex}/skills/"  # Codex
# Other agents: copy both directories into ~/.claude/skills/ or ~/.pi/agent/skills/.
```

The skill uses `FANOUT_DIR` when set, otherwise `~/projects/fanout-skill`. Set
`FANOUT_DIR` to the checkout location if yours differs (for example `F:/fanout` in
Git Bash). The profile tools are located relative to the checkout, as above.

## Tests

```bash
node --test
```

Tests use fake profile tools and workers; they do not spend account quota. POSIX
integration tests cover worker startup, argument handling, retry and timeout cleanup.
Windows command construction is checked on every platform; Windows process execution
still needs a Windows host.

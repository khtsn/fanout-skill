---
name: fanout
description: Split a piece of work into independent tasks and run them in parallel on the user's Claude Code and Codex accounts with the fanout tool. Use when the user says "fanout", asks to delegate or spread work across their profiles or accounts, or wants several Claude/Codex workers on one job at once.
---

# fanout

The user has several Claude Code and Codex accounts on this machine, each a separate
profile with its own subscription limits. `"$FANOUT_DIR/fanout.sh"` runs a list of tasks
in parallel across them: it picks the profiles with the most room left, starts one
headless worker per task, and saves each worker's final answer to a file.

You are the orchestrator. The workers are separate agents that see only the prompt
you write for them and the folder they run in. Your job is to understand the request
well enough to split it, write prompts the workers can act on alone, and turn their
answers into one result for the user.

`$FANOUT_DIR/README.md` is the full reference for the tasks file, options and result
files. Read it before your first run in a session.

## Locate the checkout

In shell examples below, initialize the checkout path once:

```bash
FANOUT_DIR="${FANOUT_DIR:-$HOME/projects/fanout-skill}"
```

If it is elsewhere, use its actual path (for example `F:/fanout` on Windows).
macOS/Linux use Bash and the sibling `claude-profiles/ccp.bash` and
`codex-profiles/cxp.bash`; Windows uses PowerShell and their `.ps1` files.
Override nonstandard profile-tool locations with `CCP_BASH` / `CXP_BASH` on
macOS/Linux, or `CCP_PS1` / `CXP_PS1` on Windows. Node.js 22+, the profile tools'
dependencies, and `claude` / `codex` must be installed.

## Before you split the work

Explore the project yourself first. A good split needs to know where the natural
boundaries are (modules, services, layers), and you cannot write a useful worker
prompt for code you have not looked at.

Then measure how ambiguous the request still is, because workers cannot ask
questions: whatever is unclear to you, each of them will guess differently. Use the
`clarify` skill's eight dimensions (goal, terms, scope, assumptions, evidence,
counterexamples, consequences, done). A dimension is open when you cannot state its
answer from the request or from what you found, and a wrong guess would change what
gets built. Ambiguity is the share that is open; tell the user the figure, for
example "Ambiguity: 7 of 8 open (88%)".

- **80% or more:** do not plan or run anything yet. Load the `clarify` skill
  (`../clarify/SKILL.md`) and run it. Its confirmed brief becomes the request, and
  its acceptance criteria become the check the workers are held to.
- **Below 80%:** ask the user about the open dimensions that matter in one round of
  questions, or state the assumption you are making, then carry on.

Also settle these with the user if the request leaves them open, since they change
what the workers are allowed to do:

- **Which folder.** Workers run in the task's `cwd`. The session may be sitting
  somewhere else, such as a drive root.
- **Read-only or writing.** Workers are read-only by default. Review, research and
  planning need nothing more. Only give write access when the user asked for changes.
- **Accounts to leave out.** The `home` profiles may be accounts the user does not
  want automation to spend. If the user has not said, show the dry-run assignment
  and let them object before running.

## Exploring for the clarify skill

The `clarify` skill may load this one to explore a project in parallel before it
interviews the user. That run is a plain research fanout with these fixed rules:

- Skip the ambiguity measure above and do not hand back to `clarify`: the request is
  still vague, but each exploration question is specific, and that is all the
  workers need.
- Every task is read-only (`"perm": "readonly"`, no worktrees), one area per worker,
  at most six workers.
- Use the exploration row of the "Models and effort" table, and run with
  `--timeout 10` so a stuck worker cannot hold up the interview.
- Tell the user in one line that you are exploring in parallel and with how many
  workers. The rule about accounts to leave out still applies.
- Return to `clarify` with the answers once you have read them. Do not plan or build.

## Team size

Once you have explored, choose a team size and tell the user which one and why
before you run anything. If the user names a size ("fanout small: ..."), use it.
When a request sits between two sizes, pick the smaller one: every worker starts
cold and pays a fixed cost to load its context.

| Team | When | Workers |
| --- | --- | --- |
| solo | You could finish the job yourself in a few steps | None. Say so and do the work directly in the session |
| small | One piece of work that does not split, or splits in two | Two at a time: one on Claude and one on Codex |
| medium | Several pieces that can be worked on independently | Up to six at a time, spread over the available profiles |

A medium run can use a visible share of a weekly limit. Look at `ccp usage` and
`cxp usage` first, and show the user the dry-run assignment.

What the team does depends on the kind of work.

**Review or research (read-only).** On a small team, give the same prompt to one
Claude profile and one Codex profile, so the two answers are independent, and compare
them yourself. On a medium team, give each worker its own module or question; for
simple, bulky work such as the same check over many files, cut the file list into
equal chunks and give every worker the same short prompt with its own chunk.

**Build or change.** Run it as an agile spiral: short sprints in which Engineers
build an increment in worktrees, you run the acceptance check, and an AI Reviewer on
the other tool reviews what was built before the next sprint is planned.
`references/spiral.md` has the roles, the prompt for each step, what each team size
does and what to carry from one sprint to the next. Read it before starting.

## Writing tasks

Each task should be something one worker can finish without knowing what the others
are doing. Split along lines where the pieces do not depend on each other's output.

A worker knows nothing about this conversation. In each prompt, give it:

- what the overall goal is and which part is its own
- the exact files or folders it owns, and for writing tasks, what it must not touch
- what done looks like
- what to return: for example findings as a list with file and line, each marked as
  confirmed or suspected, so you can merge answers without guessing

Write the tasks file somewhere outside the project, such as the system temp folder,
so it does not show up in the project's git status.

For tasks that change files, set `"perm": "auto"` and `"worktree": true`. Each worker
then gets its own copy of the repository on its own branch, and two workers cannot
overwrite each other. Use `"perm": "bypass"` only when the user asks for it: it
removes every prompt and sandbox for that worker.

Leave `tool` and `profile` out unless there is a reason to pin them. The tool spreads
unpinned tasks across the accounts with the most room left and retries a failed task
on another account; a pinned task gets neither.

## Models and effort

Set `"model"` and `"effort"` on every task, chosen by the kind of work it is:

| Work | Claude model | Codex model | Effort |
| --- | --- | --- | --- |
| Planning, review, research, hard reasoning (Planner, Reviewer) | `fable` | `gpt-6-astra` | `high` |
| Building or changing code (Engineer) | `fable` | `gpt-6-astra` | `medium` |
| Bulk, mechanical work: the same simple check or edit over many files | `sonnet` | `gpt-6-luna` | `low` |
| Exploration for the `clarify` skill: finding facts about one area, quickly | `sonnet` | `gpt-6-luna` | `low` |

Write both in the per-tool form, which leaves the task free to run, and be retried,
on either tool:

```json
{ "id": "review-auth", "prompt": "...",
  "model": { "claude": "fable", "codex": "gpt-6-astra" },
  "effort": { "claude": "high", "codex": "high" } }
```

A single model name is only valid on a task that also sets `"tool"`. When a task
sits between two rows, use the cheaper one unless a wrong answer would be costly.
If the user names a model or effort, theirs wins over the table. Leave both fields
out only when the user asks for the profiles' own settings.

Check the `--dry-run` output shows the model and effort you meant for each task. If
a worker fails because its tool rejects the model name, rerun that task without
`"model"` and tell the user the table needs updating.

## Running

```bash
"$FANOUT_DIR/fanout.sh" tasks.json --dry-run   # which profile gets which task; runs nothing
"$FANOUT_DIR/fanout.sh" tasks.json             # run; prints a status table and the results folder
```

Redirect stdin from `/dev/null` when you call it from a tool, and allow a long
timeout: the command returns only when every worker has finished, which can take
many minutes for real work.

The exit code is 1 if any task failed. Results are in the folder printed at the end:
`<id>.out.md` is each worker's answer, `<id>.log` its raw output, and `summary.json`
lists every task with its status, profile and, for worktree tasks, its branch.

## After the run

Read every `<id>.out.md`. Workers can be wrong, can contradict each other, and can
report something as done that is not. Check claims that matter against the code
before you pass them on, and tell the user which findings you confirmed and which
you are relaying.

For a failed task, read its `.log`, then decide whether to do that piece yourself,
rerun it, or report it as not done. Do not present a run as complete when a task
failed.

For worktree tasks, the changes sit on `fanout/<run>/<id>` branches and are not
merged. Review each branch's diff, tell the user what each one contains, and merge
only if the user asked you to. Leftover worktrees can be removed with
`git worktree remove <path>` once their branches are merged or discarded.

## Managing the accounts

`ccp` (Claude Code) and `cxp` (Codex) are the profile tools fanout builds on.
On macOS/Linux:

```bash
bash "${CCP_BASH:-$FANOUT_DIR/../claude-profiles/ccp.bash}" usage
bash "${CXP_BASH:-$FANOUT_DIR/../codex-profiles/cxp.bash}" usage
```

On Windows from Git Bash, call them through PowerShell:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CCP_PS1:-$FANOUT_DIR/../claude-profiles/ccp.ps1}" usage
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CXP_PS1:-$FANOUT_DIR/../codex-profiles/cxp.ps1}" usage
```

`usage` shows how much of each account's limit is used, `pick -n 9` shows the order
fanout would choose them in, and `pool <name> off` keeps an account out of every
future fanout. Changing the pool or a profile's saved permission mode alters the
user's setup, so do it only when they ask. Their READMEs sit next to the scripts.

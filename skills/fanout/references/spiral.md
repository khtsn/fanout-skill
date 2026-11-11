# Agile spiral: short sprints, each one checked by AI reviewers

A way to run build-or-change work as a series of short sprints. Each sprint takes the
riskiest items off a backlog, builds a working increment, proves it with an
acceptance check, and has it reviewed by an AI reviewer on a different model from the
one that wrote it. What the check and the review find goes back into the backlog, and
the next sprint starts from there.

Two ideas carry it. From the spiral model: do the riskiest thing first, and show with
evidence that risk is going down sprint by sprint. From agile: every sprint ends with
working code, and the plan is revised after each one instead of being fixed up front.

You, the orchestrator, are the scrum master and product owner: you keep the backlog,
run the sprints and hold everything that has to survive from one sprint to the next.
The roles below are fanout workers. Workers share nothing, so every prompt must carry
the sprint plan, the last sprint's result and the requirement in full.

## When it fits

Use it when the request is to build or change something and there is an acceptance
check you can run yourself after each sprint (a test suite, a build, a script).
Without one there is no evidence to steer by: agree one with the user first, or have
the first sprint build it.

For review or research there is nothing to iterate on; run a plain fanout.

## Team size

The team size sets who does what and how many sprints there are. It comes from the
skill's team-size choice; `solo` means no spiral at all.

| Team | Planning | Building | AI review | Sprints at most |
| --- | --- | --- | --- | --- |
| small | you write the sprint plan | one Engineer | one Reviewer, on the other tool from the Engineer | 3 |
| medium | a Planner worker | up to three Engineers, one per independent piece | two Reviewers, one on Claude and one on Codex | 4 |

Stop as soon as the backlog is done: the acceptance check is fully green and no
blocking review finding is open. If the sprints run out first, report the last pass
rate and what is still open; do not present the work as finished.

## The backlog

Before the first sprint, turn the requirement into a backlog and keep it up to date
for the whole run.

- One item per requirement, each with an id (R1, R2, ...) and a one-line statement of
  what "accepted" means for it.
- Give each item a risk score: likelihood of going wrong (1-5) times impact if it
  does (1-5). Order the backlog by that score, highest first. Things that are often
  riskier than they look: persistence and ids, exact output formats and exit codes,
  error handling, defaults, input validation.
- Review findings and failed checks become new items, with ids of their own (F1,
  F2, ...), and are ranked with the rest.
- Each item is `todo`, `in sprint <n>` or `accepted`. An item is accepted only when
  its checks pass and no blocking finding names it.

## Roles

Start each worker prompt with its role block, then the task for the step.

**Planner**
You are the planner for a small delivery team. Your goal is to rank what could make
this delivery fail and choose the sprint that retires the biggest risk first. You
have seen projects die from unexamined assumptions, so you quantify.

**Engineer**
You are an engineer on a small delivery team. Your goal is to build the smallest
working increment that settles the sprint's top risk, then harden it. You are
pragmatic and comfortable throwing a prototype away.

**Reviewer**
You are a code reviewer. Your goal is to judge this sprint's increment against the
sprint goal and the acceptance results. You did not write this code. You separate
"works on my machine" from evidence, and you report only what you can point to in
the code.

## Running one sprint

### 1. Plan the sprint

Small team: write the plan yourself, from the backlog. Medium team: one read-only
Planner worker.

```
SPRINT <n> - planning.
1. Sprint goal: one sentence on what this sprint must prove about the product below.
2. Risks: a markdown table (id, risk, likelihood 1-5, impact 1-5,
   exposure = likelihood x impact, mitigation), ranked. Name the TOP RISK this sprint
   retires and the increment that retires it.
3. Sprint backlog: the exact backlog ids this sprint will finish. Early sprints may
   deliberately leave items out. Leave out anything that cannot be finished and
   checked within one sprint.
4. Split: if the sprint backlog divides into pieces that do not touch the same files,
   list the pieces (at most three), with the ids and the files each one owns.
   Otherwise say "one piece".

Return markdown with these headings: Sprint goal, Risks, TOP RISK, Sprint backlog,
Split.

BACKLOG (id, item, risk score, status):
<the backlog>

LAST SPRINT:
<last sprint's summary, or "This is the first sprint.">

REQUIREMENT:
<the full requirement>
```

The answer is the sprint plan. Save it.

### 2. Build (writing, in worktrees)

One Engineer per piece in the plan, in a single fanout run, each with
`"perm": "auto"` and `"worktree": true`.

```
SPRINT <n> - build. Build the increment described in the sprint plan, starting from
the code in this folder. Settle the TOP RISK first. Finish your backlog ids fully
and exactly; anything not in this sprint must fail gracefully, not crash.
Your backlog ids: <ids>. Files you own: <files>. Do not change other files.
Run the acceptance check before you finish. Commit your work and reply with a
summary of what you changed and anything you could not finish.
<the project's coding rules, and the command that runs the acceptance check>

SPRINT PLAN:
<sprint plan>

FULL REQUIREMENT (for reference):
<the full requirement>
```

Do the whole spiral on a branch of its own, not on the user's main branch, unless
they say otherwise. A worktree starts from the commit the project folder has checked
out, so after the build, merge each Engineer's branch into the spiral branch before
anything else; otherwise the reviewers and the next sprint see old code.

### 3. Acceptance (you, not a worker)

Run the acceptance check yourself on the merged code. Record for this sprint: passed,
failed, pass rate, and the names of the failing checks. This is the evidence; do not
take a worker's word for it.

### 4. AI review (read-only)

Reviewers run on the merged spiral branch. Put the Reviewer on the other tool from
the Engineer whose work it reads, so the review is independent of the model that
wrote the code. On a medium team, run one Reviewer on Claude and one on Codex in the
same fanout run, with the same prompt.

```
SPRINT <n> - review. Review the changes this sprint made: run
`git diff <commit before the sprint>..HEAD` in this folder and read the files it
touches. Judge them against the sprint goal and the acceptance evidence below.

The first line of your answer must be 'REVIEW: APPROVE' or 'REVIEW: CHANGES'.
Then list your findings, most serious first. For each one give: severity (blocking
or minor), file and line, what is wrong, and how you know (the code path, or a
command that shows it). Blocking means a backlog item in this sprint does not do
what it says, or the change breaks something that worked. Do not report style.
Finish with which of the sprint's risks you consider retired and which remain.

SPRINT PLAN:
<sprint plan>

ACCEPTANCE EVIDENCE: <passed>/<total> passed. Failed: <failing checks, or "none">
<the failure output, trimmed to what is needed to diagnose>
```

Reviewers can be wrong. Check each blocking finding against the code before you act
on it. With two reviewers, a finding both report is very likely real; one that only
one reports needs your check more.

### 5. Close the sprint (you)

- Mark items accepted where their checks pass and no confirmed blocking finding
  names them.
- Add confirmed findings and failed checks to the backlog as new items and re-rank.
- Note anything about the prompts or the split that you would do differently next
  sprint, and do it.
- Write the summary the next sprint's prompts will carry:

```
Sprint <n>: <passed>/<total> acceptance checks pass. Failed: <failing checks, or "none">.
Accepted this sprint: <ids>. Still open: <ids>.

Review:
<the verdict lines, and the confirmed findings>
```

- Tell the user in a few lines where things stand: the pass rate, what was accepted,
  what the reviewers found, and what the next sprint will take on. Then carry on with
  the next sprint; stop and wait only if the user asked to approve each sprint, or a
  finding raises a question that only they can answer.

The acceptance check and the confirmed findings decide when the spiral ends, not a
reviewer's verdict line. If a reviewer approves while checks still fail, continue. If
everything passes and a reviewer still asks for changes, read why: it may have found
a requirement the acceptance check does not cover.

## What to keep and report

Keep one folder for the spiral, outside the project:

```
backlog.md                 the current backlog
sprint-<n>/01-plan.md
sprint-<n>/02-review.md    one section per reviewer, with which findings you confirmed
history.json               [{sprint, passed, failed, pass_rate, accepted, open}, ...]
```

At the end, give the user: the pass rate per sprint, the top risk each sprint
retired, the review findings that were fixed, anything still open, and the branch
that holds the result. Merge it into their branch only if they ask.

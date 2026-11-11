---
name: clarify
description: Reduce ambiguity before planning or building. Use when a request is vague, open-ended, or underspecified ("add auth", "refactor this", "help me plan X", "interview me", "clarify this"), or when another skill hands over a request it found too ambiguous to act on. Interviews the user Socratic-style, tracks clarity per dimension, and stops when explicit criteria are met. Skip for trivial, well-specified tasks (typo fixes, one-line changes).
---

# Clarify

Goal: turn a vague request into a verified brief. Never implement during this skill.

## Phase 0: Triage
If the request is small and fully specified, say so and skip the interview.
Otherwise continue.

## Phase 1: Classify intent (state it, with confidence)
- Refactor: focus on behavior preservation and regression prevention
- Build new: discover existing patterns first, then ask informed questions
- Mid-sized task: exact deliverables and explicit exclusions
- Collaborative: build clarity incrementally through dialogue
- Architecture: long-term impact; first verify the need is real
- Research: exit criteria and what counts as an answer

## Phase 2: Explore before asking
If tools exist (files, code search, docs), look first. Never ask what you can
find yourself. Ask only about decisions, preferences, and facts only the user
knows. Without tools, state what you would check and ask the user for it.

### Exploring in parallel
Exploring should take as little of the user's time as possible. When the `fanout`
skill is installed (`../fanout/SKILL.md`) and there are three or more areas to look
at that do not depend on each other (separate modules, services, or questions), load
it and explore them in parallel instead of one after another. Below that, look
yourself: every worker starts cold, and a short look is quicker done directly.

- Take a first look yourself, enough to name the areas and where they live.
- Give each worker one area and the specific questions you need answered about it.
  Ask for facts with file and line, each marked confirmed or suspected, plus a list
  of anything it found that only the user can decide.
- Follow the `fanout` skill's section "Exploring for the clarify skill" for the
  permissions, models and limits of the run.
- Spot-check the answers that will decide a Clarity Table row before you rely on
  them. The workers' "only the user can decide" lists feed Phase 3.

If `fanout` is not installed, or the run fails, explore directly.

Then fill in the Clarity Table from what you now know and state the ambiguity score.

## Phase 3: Interview
Rules:
- One decision per question, most critical first.
- If there is a tool for asking the user questions, use it. When it takes several
  questions at once, send the ones that do not depend on each other together, and
  hold back any question whose wording depends on an earlier answer. Without such a
  tool, ask one question per turn.
- Be specific. Bad: "What's the scope?" Good: "Should this change UserService only, or also AuthService?"
- Offer 2-4 concrete options with one-line tradeoffs. The user must always be able to
  answer in their own words: add an "other" option unless the question tool already
  provides a free-text answer.
- Each answer: restate it in one line, then show the Clarity Table rows it changed.
- Never accept "whatever" silently. Propose a default and record it as an assumption.

### Clarity Table
Show the full table once, at the end of Phase 2. After each answer show only the
rows whose status changed, with the ambiguity score. Show the full table again only
if the user asks for it.

| Dimension | Socratic probe | Status |
|---|---|---|
| Goal | What exactly is this? What changes when it's done? | Open/Clear/Assumed |
| Terms | What does "X" mean here? Give an example. | |
| Scope | What is explicitly OUT? | |
| Assumptions | This is only true if what else is true? | |
| Evidence | Fact or guess? How do we know? | |
| Counterexamples | When would this fail? Which edge case? | |
| Consequences | What follows? Is the worst case acceptable? | |
| Done | How will we verify it's finished? | |

Add a Testing row for code work (TDD / tests-after / manual) and a Blockers row.

### Ambiguity score
Ambiguity = Open rows / all rows, as a percentage. A row is Open when you cannot
state its answer from the request or from what you found by exploring, and a wrong
guess would change what gets built. Show the score under the table or the changed
rows each time, e.g. "Ambiguity: 5 of 8 open (63%)". Other skills use this same score to decide whether
to call this one.

### Anti-over-engineering probes (ask when relevant)
- Test beyond the target?
- Abstraction, or keep inline?
- Error handling: minimal or comprehensive?
- Documentation: none, minimal, or full?
- Also include adjacent features (e.g. permissions, reset flow)? Default is NO.

## Phase 4: Stop conditions (ALL must hold)
1. Every dimension is Clear, or Assumed with the assumption written down.
2. No question is left whose answer would change the brief. Do not ask further
   questions only to confirm that nothing is left.
3. Acceptance criteria are verifiable by someone else (prefer executable commands with expected output; no "user manually tests").
4. The user confirms the Clarified Brief (Phase 6) with no edits.

## Phase 5: Break out of loops
- Two consecutive "I don't know": stop asking. Say what data is missing and how to get it (read code, quick experiment, ask a named person).
- Same answers repeating: summarize and move to Phase 6 with open items flagged.
- User says "just go": record all assumptions, go to Phase 6, and flag the riskiest ones.

## Phase 6: Output the Clarified Brief
- **Objective** (one sentence)
- **Scope IN / OUT**
- **Decisions made**
- **Assumptions** (each marked low/medium/high risk)
- **Risks and mitigations**
- **MUST / MUST NOT** (include pattern references if found)
- **Acceptance criteria** (verifiable, with expected outputs)
- **Open items**
Then ask: "Anything here wrong or missing?" If the user edits it, update the brief
and ask again. Hand off only after confirmation.

When another skill called this one, the confirmed brief is the hand-off: return to
that skill and use the brief as the request.

## Style
Reply in the user's language. Keep turns short. No lecturing about the method.

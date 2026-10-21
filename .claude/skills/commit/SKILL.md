---
name: commit
description: Group working-tree changes into logical commits, optionally push
user-invocable: true
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(git commit:*), Bash(git push:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git reset), AskUserQuestion
---

## Step 0 — Gather Context

Before doing anything else, run these commands (in a single message, in parallel) and use their output as the state for the rest of the workflow:

- `git status`
- `git diff HEAD`
- `git branch --show-current`
- `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "(no upstream)"` — captures the upstream, or reports `(no upstream)`.
- `git log --oneline -10` — style reference for the commit subject.

## Your Task

If the working tree is clean (no staged, unstaged, or untracked changes in the status above), report "nothing to commit" and stop. Do not call any tools.

Otherwise, run this workflow:

### Step 1. Group the Changes

Cluster the changed files into 2–5 **logical groups by concern** based on the status and diff above. Examples of good grouping axes: feature area (auth, i18n, dashboard), kind of change (deps vs. config vs. source), or route/module boundaries. Each group needs a short label (e.g. "i18n scaffolding") and a one-line summary of what it contains.

If everything is clearly one concern, skip the grouping UI and treat the whole tree as a single implicit "everything" group.

### Step 2. Ask Both Questions in One `AskUserQuestion` Call

Send a single `AskUserQuestion` tool call with **two questions** so they render in parallel:

**Q1 — header: "Commit", question: "What do you want to commit?", `multiSelect: true`.**
Options, in this exact order:
1. Label: `Commit everything as one commit (Recommended)`. Description: one combined commit of the entire working tree.
2. One option per logical group from step 1. Label format: `<group label> (<N> files)`. Description: the one-line group summary.

If the user selects "everything" alongside any groups, "everything" wins.

**Q2 — header: "Push", question: "Push after committing?", single-select.**
Options, in this exact order:
1. Label: `Yes, push to origin (Recommended)`.
2. Label: `No, keep local`.

### Step 3. Commit — Read This Carefully, It Is the Part That Breaks

A bare `git commit` commits **the entire index**, not just files you just `git add`-ed. If anything was already staged when this command started, it will leak into the first group's commit. To prevent that, every commit below uses an **explicit pathspec** on `git commit` itself — that pathspec is the final guard.

**Everything path.** Run `git add -A` followed by `git commit -m "<subject>"`. One commit. No pathspec needed because the user explicitly chose to commit everything.

**Groups path.**

1. **Reset the index once.** Before staging the first group, run `git reset` (no arguments — moves staged files back to working tree, preserves all changes). This guarantees the index starts empty regardless of what was staged when `/commit` was invoked.

2. **For each selected group**, in a single message run these three commands:
   - `git add -- <files-in-group>` — explicit pathspec, handles new/untracked files.
   - `git commit -m "<subject>" -- <files-in-group>` — explicit pathspec on commit is the **load-bearing guard**. Even if the index has extras, they won't be committed.
   - `git status --porcelain` — verify files outside this group are still uncommitted.

3. **If `git status` shows anything unexpected** (e.g. files you didn't intend to commit are gone from the working tree, or files you did intend to keep are missing), **STOP**. Report what happened to the user in plain text and end your turn. Do **not** attempt to fix it by running `git reset --hard`, `git reset HEAD~`, `git commit --amend`, or any other history-rewriting command — those are blocked by `allowed-tools` anyway. The user will resolve manually.

Commit message style: short imperative subject, no trailing period, matching the recent commits shown in Context (e.g. `Scaffold Sadmo CRM shell with auth route groups`). Do **not** add Claude/Anthropic co-author trailers — this repo doesn't use them.

You have the capability to call multiple tools in a single response. Within one group's three commands, send them in a single message.

### Step 4. Push (Conditional)

If Q2 = Yes:
- If Context shows `(no upstream)`, run `git push -u origin <current-branch>`.
- Otherwise run `git push`.

If Q2 = No, skip pushing.

### Step 5. Report

End with a single short summary: the commit subject(s) created and whether the push ran.

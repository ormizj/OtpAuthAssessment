---
name: sketch
description: Create a commit-tagged explanatory diagram of how part of the system currently works, saved under docs/sketches/. Triggers on "sketch how X works", "diagram X", "visualize X", "draw the X flow".
argument-hint: <what to visualize>
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash(git rev-parse:*), Bash(git status:*), Bash(git mv:*), Write, AskUserQuestion
---

Produce a **point-in-time sketch** — a diagram that shows how some part of the system
works *right now* — into `docs/sketches/`. Sketches are snapshots, **not** living docs:
they can go stale, so every one is stamped with the commit it depicts. Regenerate rather
than silently edit when the code moves.

Read the convention in [`docs/sketches/README.md`](../../../docs/sketches/README.md)
(create it from the template in step 5 if it's missing) before writing your first sketch.

## 1. Resolve the subject

Take what to visualize from the args (e.g. `sketch the prisma generate flow`). If no
subject was given, ask in plain text what to sketch, then stop.

Derive a kebab-case **slug** (e.g. `prisma-generate-dev-vs-prod`); the filename is
`<YYYY-MM-DD>-<slug>.md` with **today's date** as the prefix, so the folder listing sorts
chronologically and the freshest sketches surface at a glance. If a sketch for the same
`<slug>` already exists under an **older** date, `git mv` it to today's date first, then
overwrite its contents — one dated file per topic, always showing its latest date. That
rename + rewrite is the intended "the code moved, redraw it" path.

## 2. Understand the real code

Trace the **actual files** involved with `Read`/`Glob`/`Grep`. Never diagram from
memory — a sketch that lies about the code is worse than none. Note the concrete paths
and line numbers you'll reference in the caption.

## 3. Capture provenance

- `git rev-parse --short HEAD` → the `commit` field.
- Today's date → the `date` field.
- `git status --porcelain` → if the tree is **dirty**, the sketch reflects uncommitted
  work on top of that commit; say so in the caption.

## 4. Pick the medium

Default to **mermaid** (`flowchart` / `sequenceDiagram` / `stateDiagram`, whichever fits
the story — the repo already uses mermaid in `.claude/rules/ARCHITECTURE.md`). Reach for
an **image** only when the user asks for one or a graph diagram genuinely can't express
it; put image assets in `docs/sketches/assets/<basename>.<ext>` (the same
`<YYYY-MM-DD>-<slug>` stem as the sketch) and embed them with a relative
`![alt](./assets/<basename>.<ext>)`. Set `kind:` accordingly (`mermaid` | `image`).

## 5. Write the sketch

Write `docs/sketches/<YYYY-MM-DD>-<slug>.md` with this frontmatter contract:

```yaml
---
title: <human title>
depicts: <one-line summary of what the picture shows>
commit: <short SHA from step 3>
date: <YYYY-MM-DD>
kind: mermaid          # mermaid | image
---
```

Then the diagram (a ` ```mermaid ` fence, or the embedded image) followed by a **short
caption** — a few sentences in the tight house style of `docs/docker/*.md` that say what
the picture shows and point at the real files/lines. It's a caption, not a full doc.

If `docs/sketches/README.md` does not exist yet, create it stating the convention:
sketches are point-in-time snapshots, not living docs; trust the `commit` field to know
what code state a sketch reflects; filenames are date-prefixed (`<YYYY-MM-DD>-<slug>.md`)
so the listing sorts by freshness; regenerate (rerun this skill) rather than silently
editing when the code moves; `kind`/`assets` layout as above.

## 6. Offer a preview

Point the user at the written file path. Optionally render the sketch with the `Artifact`
tool (mermaid renders natively) so they can eyeball it. **Do not commit** — leave that to
the user or the `commit` skill.

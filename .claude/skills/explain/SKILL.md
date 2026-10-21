---
name: explain
description: Explain a file, code, or subject step-by-step — one unit at a time — pausing after each until the user says next. Triggers on "explain X", "walk me through X", "teach me X", "break down X line by line / section by section".
argument-hint: <file or topic> [start line or section]
user-invocable: true
allowed-tools: Read, Glob, Grep, AskUserQuestion
---

A self-paced walkthrough. Explain **one unit at a time**, then **stop** and let the
user drive. Only advance when they explicitly say so — never cover ahead or summarize
the whole thing.

## 1. Resolve the subject

From the args (e.g. `explain docker-compose.yml`, `explain React Server Components`):

- **A file** → `Read` it (use `Glob` to locate first if needed). Quote the real file, never memory.
- **A concept** → break it into sub-topics; no read needed.
- **Nothing** → ask what to explain, then stop.

**Optional start point** in the args — parse it out and strip it from the subject:

- `foo.py:40` / `foo.py from line 40` / `foo.py @40` → a line.
- `compose.yml from volumes` → a section.

No start token → start at unit 1. Don't invent one.

## 2. Ask granularity

One `AskUserQuestion` (header `Granularity`, question `How should I break this down?`):

1. `Line by line` — smallest logical unit.
2. `Section by section` — logical blocks (a service, a function, a sub-topic).

"Other" handles custom requests (e.g. "just the tricky parts").

## 3. Enumerate units

List the units for the chosen granularity and note the total — keep it to yourself.
Then pick the starting unit: the parsed start point (a line → its unit; a section
name → that section; "end"/"start" → last/first), else unit 1. If a start point was
given but doesn't match, say so and ask for an exact one.

## 4. Explain ONE unit

1. **Position header** — `Line 4 of 18` or `Section 2 of 6: volumes`.
2. The **quoted unit** (code block for files).
3. A focused explanation of **that unit only**.

Then stop and go to step 5.

## 5. Present controls

One `AskUserQuestion` (header `Continue?`): `Next`, `Back`, `Stop`. "Other" is free
text — a question about the current unit, or a jump ("skip to volumes", "go to the end").

## 6. Act on the answer

Only on a clear instruction; when unsure, stay put and re-ask.

- `Next` (`n`, `continue`, `keep going`) → next unit → step 4.
- `Back` (`prev`) → previous unit → step 4.
- `Stop` (`done`, `quit`) → end.
- A clear **jump** to a line/section/"end"/"start" → move there → step 4.
- Anything else → treat as a **question** about the current unit; answer it, then
  re-present the same controls **without advancing**.

## 7. End

At the last unit (or on `Stop`), say the walkthrough is complete. Offer a one-paragraph
recap only if the user wants it.

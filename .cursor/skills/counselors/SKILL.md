---
name: counselors
description: >-
  Fan out a review prompt to multiple local AI coding CLIs (Claude Code, Codex,
  Gemini, Amp) via the counselors CLI, then synthesize parallel reports. Use when
  the user wants second opinions, multi-model review, /counselors-style workflow,
  or mentions counselors, parallel agents, or council of advisors.
---

# Counselors — multi-agent review (Cursor)

> **Long-running.** Counselors runs several external CLIs in parallel; wall time is often **10–20+ minutes**. Run dispatch in the background when possible; counselors prints PIDs and heartbeats so you can verify progress with `ps`.

Orchestrate the [counselors](https://github.com/aarondfrancis/counselors) CLI: same prompt → multiple agents → structured markdown under the configured output dir (default `./agents/counselors`).

**Prerequisites:** `counselors` on PATH, config from `counselors init` / `counselors init --auto`. Verify with `counselors doctor`.

If the user’s goal is unclear, ask what they want reviewed before Phase 1.

---

## Phase 1: Context gathering

From the user request, identify review scope:

1. **Named or implied files** — Glob/Grep for symbols, paths, or keywords.
2. **Recent changes** — `git diff HEAD`, `git diff --staged`.
3. **Related code** — Search for key terms; shortlist the most relevant files (roughly up to 5).

**Do not paste entire files into the prompt.** Subagents read the repo; use `@path/to/file` references in the assembled prompt (Phase 4).

---

## Phase 2: Dispatch mode

- **Default:** `counselors run` — single parallel pass.
- **Use `counselors loop`** for deeper, multi-round analysis or broad hunts.

Loop variants:

- **Preset:** `counselors loop --preset <name> "<focus>"` — run `counselors loop --list-presets` if the user wants to pick.
- **Custom file:** assembled `prompt.md` + `counselors loop -f …` (no auto discovery).
- **Inline:** short string argument; counselors can run discovery + prompt expansion unless `--no-inline-enhancement`.

---

## Phase 3: Agent selection

Run and show **full** output inline (do not abbreviate):

```bash
counselors ls
counselors groups ls
```

Then:

1. Ask the user which **tool IDs** to use (comma-separated), or **all**, or a **group** (e.g. `smart`).
2. If they name a group, resolve it with `counselors groups ls`. Expand to tool IDs and **confirm the exact list** before dispatch. Do not guess missing groups.
3. **Confirm** before Phase 4, e.g.:  
   `Dispatching to: claude-opus, codex-5.3-xhigh` — wait for acknowledgment.

**Loop only:** first selected tool runs discovery/prompt prep unless overridden with `--discovery-tool <id>`.

---

## Phase 4: Prompt assembly

Skip for **preset loop** and **inline loop** (counselors generates or enhances the execution prompt).

For **`run`** and **custom `loop` with `-f`**, build prompt markdown. Counselors appends execution boilerplate; you do not need to duplicate generic “cite paths, skip vendor” instructions.

Use `@path/to/file` for context. Only inline tiny snippets (e.g. one error line or signature) when essential.

```markdown
# Review Request

## Question
[User’s question / review goal]

## Context

### Files to Review
[@src/... references]

### Recent Changes
[Short summary; point reviewers to `git diff` when useful]

### Related Code
[@src/... references]

## Instructions
Independent review: read referenced files, be direct, note risks and alternatives, use clear headings.
```

---

## Phase 5: Dispatch

Use **`--json`** on `mkdir` and on `run` / `loop` so paths can be parsed from stdout.

### A: `run`

```bash
cat <<'PROMPT' | counselors mkdir --json
[Phase 4 markdown]
PROMPT
```

Read JSON → `promptFilePath`, then:

```bash
counselors run -f "<promptFilePath>" --tools id1,id2 --json
```

Optional: `--group smart`, combine `--group` with `--tools` per CLI docs.

### B: `loop` + file (no preset)

Same `mkdir` flow, then:

```bash
counselors loop -f "<promptFilePath>" --tools id1,id2 --json
```

Add as needed: `--rounds N`, `--duration 30m`, `--convergence-threshold 0.3`, `--discovery-tool id`, `--no-inline-enhancement`.

### C: `loop` + inline (auto-enhanced)

```bash
counselors loop "short focus string" --tools id1,id2 --json
```

### D: `loop` + preset

```bash
counselors loop --preset <preset> "<focus>" --tools id1,id2 --json
```

**Shell:** Allow enough time (e.g. 10+ minutes). Counselors runs children in parallel; check PIDs if a run seems stuck.

---

## Phase 6: Read results

1. Parse **JSON manifest** from the dispatch command.
2. Read each agent’s **`outputFile`**; check **`stderrFile`** on failures.
3. Note empty or failed agents in the synthesis.

**Loop:** prefer `final-notes.md`, then `round-N/` dirs and `run.json` (`rounds` array).

---

## Phase 7: Synthesize

Present:

```markdown
## Counselors review

**Agents consulted:** …

**Consensus:** …

**Disagreements:** …

**Key risks:** …

**Blind spots:** …

**Recommendation:** …

---
Reports: [output directory from manifest]
```

Keep the synthesis concise; point to saved files for depth.

---

## Phase 8: Optional follow-up

Offer 2–3 concrete next steps from the synthesis if the user wants to implement changes.

---

## Errors

| Situation | Action |
|-----------|--------|
| `counselors` not found | Suggest `npm install -g counselors` or ensure global bin on PATH |
| No tools | `counselors init` or `counselors tools add` |
| One agent fails | Continue; mention in synthesis |
| All fail | Summarize stderr; suggest `counselors doctor` |

---

## Quick reference

```bash
counselors doctor
counselors config
counselors run --dry-run "smoke prompt"
counselors loop --list-presets
```

Official template updates: run `counselors skill` and merge changes manually — see [skill template history](https://github.com/aarondfrancis/counselors/commits/main/src/commands/skill.ts).

# counselors

By [Aaron Francis](https://aaronfrancis.com), creator of [Faster.dev](https://faster.dev) and [Solo](https://soloterm.com).

Fan out prompts to multiple AI coding agents in parallel.

`counselors` dispatches the same prompt to Claude, Codex, Gemini, Amp, or custom tools simultaneously, collects their responses, and writes everything to a structured output directory.

No MCP servers, no API keys, no complex configuration. It just calls your locally installed CLI tools.

## Agentic quickstart

Install the CLI yourself first:

```bash
npm install -g counselors
```

Then paste this to your AI coding agent:

```
Run `counselors init --auto` to discover and configure installed AI CLIs. Then run `counselors skill` to see how to create a skill for the counselors CLI.
```

Your agent will configure available tools and set up the `/counselors` slash command.

**How it works:**

1. You invoke the Counselors skill with a prompt
2. Your agent gathers context from the codebase
3. Your agent asks which other agents you want to consult
4. Counselors fans out to those agents in parallel for independent research
5. Each agent writes a structured markdown report
6. Your main agent synthesizes and presents the results

**Example:** after a big refactor, ask your agents for a second opinion:

```
/counselors We just completed a major refactor of the authentication module.
Review the changes for edge cases, test gaps, or regressions we might have missed.
```

Your main agent handles the rest — it gathers relevant code, recent commits, and assembles a detailed prompt before dispatching to the counselors.

## Human quickstart

```bash
npm install -g counselors

# Discover installed AI CLIs and create a config
counselors init

# Send a prompt to all configured tools
counselors run "Trace the state management flow in the dashboard and flag any brittleness or stale state bugs"

# Send to specific tools only
counselors run -t claude,codex "Review src/api/ for security issues and missing edge cases"
```

## Supported tools

| Tool | Adapter | Read-Only | Install |
|------|---------|-----------|---------|
| Claude Code | `claude` | enforced | [docs](https://docs.anthropic.com/en/docs/claude-code) |
| OpenAI Codex | `codex` | enforced | [github](https://github.com/openai/codex) |
| Gemini CLI | `gemini` | enforced | [github](https://github.com/google-gemini/gemini-cli) |
| Amp CLI | `amp` | enforced | [ampcode.com](https://ampcode.com) |
| Custom | user-defined | configurable | — |

## Commands

### `run [prompt]`

Dispatch a prompt to configured tools in parallel.

```bash
counselors run "Your prompt here"
counselors run -f prompt.md              # Use a prompt file
echo "prompt" | counselors run           # Read from stdin
counselors run --dry-run "Show plan"     # Preview without executing
```

| Flag | Description |
|------|-------------|
| `-f, --file <path>` | Use a prompt file (no wrapping) |
| `-t, --tools <list>` | Comma-separated tool IDs |
| `--context <paths>` | Gather context from paths (comma-separated, or `.` for git diff) |
| `--read-only <level>` | `strict`, `best-effort`, `off` (defaults to config `readOnly`) |
| `--dry-run` | Show what would run without executing |
| `--json` | Output manifest as JSON |
| `-o, --output-dir <dir>` | Base output directory |

### `init`

Interactive setup wizard. Discovers installed AI CLIs, lets you pick tools and models, runs validation tests.

```bash
counselors init          # Interactive
counselors init --auto   # Non-interactive: discover tools, use defaults, output JSON
```

### `doctor`

Check configuration health — verifies config file, tool binaries, versions, and read-only capabilities.

```bash
counselors doctor
```

### `upgrade`

Detect how `counselors` was installed and upgrade using the matching method when possible.

Supported:
- Homebrew
- npm global
- pnpm global
- yarn global (classic)
- Standalone binary installs (safe paths only: `~/.local/bin`, `~/bin`)

```bash
counselors upgrade
counselors upgrade --check        # Show method/version only
counselors upgrade --dry-run      # Show what would run
counselors upgrade --force        # Force standalone self-upgrade outside safe locations
```

### `tools`

Manage configured tools.

| Command | Description |
|---------|-------------|
| `tools discover` | Find installed AI CLIs on your system |
| `tools add [tool]` | Add a built-in or custom tool |
| `tools remove [tool]` | Remove tool(s) — interactive if no argument |
| `tools rename <old> <new>` | Rename a tool ID |
| `tools list` / `ls` | List configured tools (`-v` for full config) |
| `tools test [tools...]` | Test tools with a quick "reply OK" prompt |

### `agent`

Print setup and skill installation instructions.

### `skill`

Print a `/counselors` slash-command template for use inside Claude Code or other agents.

## Configuration

### Global config

`~/.config/counselors/config.json` (respects `XDG_CONFIG_HOME`)

```jsonc
{
  "version": 1,
  "defaults": {
    "timeout": 540,
    "outputDir": "./agents/counselors",
    "readOnly": "bestEffort",
    "maxContextKb": 50,
    "maxParallel": 4
  },
  "tools": {
    "claude": {
      "binary": "/usr/local/bin/claude",
      "adapter": "claude",
      "readOnly": { "level": "enforced" },
      "extraFlags": ["--model", "opus"]
    }
  }
}
```

### Project config

Place a `.counselors.json` in your project root to override `defaults` per-project. Project configs cannot add or modify `tools` (security boundary).

```jsonc
{
  "defaults": {
    "outputDir": "./ai-output",
    "readOnly": "enforced"
  }
}
```

## Read-only modes

| Level | Behavior |
|-------|----------|
| `enforced` | Tool is sandboxed to read-only operations |
| `bestEffort` | Tool is asked to avoid writes but may not guarantee it |
| `none` | Tool has full read/write access |

The `--read-only` flag on `run` controls the policy: `strict` only dispatches to tools with `enforced` support, `best-effort` uses whatever each tool supports, `off` disables read-only flags entirely. When omitted, falls back to the `readOnly` setting in your config defaults (which defaults to `bestEffort`).

## Output structure

Each run creates a timestamped directory:

```
./agents/counselors/{slug}/
  prompt.md              # The dispatched prompt
  run.json               # Manifest with status, timing, costs
  summary.md             # Synthesized summary
  {tool-id}.md           # Each tool's response
  {tool-id}.stderr       # Each tool's stderr
```

## Skill / slash command

Install `/counselors` as a skill in Claude Code or other agents:

```bash
# Print the skill template
counselors skill

# Print full agent setup instructions
counselors agent
```

The skill template provides a multi-phase workflow: gather context, select agents, assemble prompt, dispatch via `counselors run`, read results, and synthesize a combined answer.

## How is this different from...?

Most parallel-agent tools ([Uzi](https://github.com/devflowinc/uzi), [FleetCode](https://github.com/built-by-as/FleetCode), [AI Fleet](https://github.com/nachoal/ai-fleet), [Superset](https://superset.sh)) are designed to parallelize _different tasks_ — each agent gets its own git worktree and works on a separate problem. They're throughput tools.

Counselors does something different: it sends the _same prompt_ to multiple agents and collects their independent perspectives. It's a "council of advisors" pattern — you're not splitting work, you're getting second opinions.

Other differences:

- **No git worktrees, no containers, no infrastructure.** Counselors just calls your locally installed CLIs and writes markdown files.
- **Read-only by default.** Agents are sandboxed to read-only mode so they can review your code without modifying it.
- **Built for agentic use.** The slash-command workflow lets your primary agent orchestrate the whole process — gather context, fan out, and synthesize — without you leaving your editor.

## Examples

The real value shows up when models disagree. Here are cross-model disagreement tables from actual counselors runs, synthesized by the primary agent:

**Topic: Tauri close-request handling** — _Claude Opus, Gemini Pro, Codex_

> /counselors Review my plan for handling Tauri 2.x close-request events — is the CloseRequested API usage correct, are there known emit_to bugs, and should "Stop All" be per-window or global?

| Topic | Claude Opus | Gemini Pro | Codex |
|-------|-------------|------------|-------|
| CloseRequested API | Says `set_prevent_default(true)` is correct for Tauri 2.x | Agrees plan is correct | Says plan is wrong — claims `api.prevent_close()` is needed |
| `emit_to` reliability | Flags potential Tauri bug (#10182) where `emit_to` may broadcast anyway; wants fallback plan | Says raw `app.emit_to` may be needed if tauri-specta doesn't expose it | Says `emit_to` is correct |
| "Stop All" semantics | Says keep it global (app-level menu = all processes) | No comment | Says command palette "stop all" is not ownership-aware |

---

**Topic: Escape key / modal stacking** — _Codex, Gemini, Amp_

> /counselors How should I implement escape-to-dismiss for stacked modals? Currently openModals is a Set and Escape closes everything. I want it to dismiss only the topmost modal.

| Approach | Codex | Gemini | Amp |
|----------|-------|--------|-----|
| Stack location | Parallel `modalStack: string[]` alongside `openModals: Set` | Replace `openModals: Set` → `openModals: string[]` | Separate `escapeStack` + `escapeHandlers` alongside `openModals: Set` |
| ESC dispatch | Each Modal keeps its own window listener but no-ops if not topmost | Same as Codex | One global dispatcher + handler registry; Modals don't add window listeners at all |
| Complexity | Medium (add stack, check in Modal) | Low (swap Set→Array, check in Modal) | Higher (new escape stack, new hooks, new global dispatcher, store handler functions) |

---

**Topic: Terminal drag-and-drop / image paste** — _Claude Opus, Gemini Pro, Codex_

> /counselors What's the best approach for drag-and-drop files and image paste in my ghostty-web terminal? Is inline image rendering feasible on the Canvas/WASM renderer or should I just insert file paths?

All 3 agents agreed on these key points:

1. Drag-and-drop should insert shell-escaped file paths — this is the universal convention (Terminal.app, iTerm2, Kitty, Ghostty native all do it). Highest value, lowest effort. Do it first.
2. Image paste should save to a temp file and insert the path — no terminal pastes raw image data. Show a toast to explain what happened.
3. Do NOT build inline image rendering now — ghostty-web's Canvas renderer has no image rendering capability. Building an HTML overlay compositor would be 40-80 hours of work for low value in a dev tool.
4. ghostty-web does NOT support image display despite native Ghostty supporting Kitty Graphics Protocol. The web/WASM build lacks the Metal/OpenGL rendering paths needed.

| Topic | Claude Opus | Gemini Pro |
|-------|-------------|------------|
| Kitty rendering | "ghostty-web does NOT render images" | Suggests "rely on ghostty-web's built-in Kitty support" |

The synthesizing agent's assessment: Claude Opus and Codex are correct — ghostty-web's CanvasRenderer draws text cells only. Gemini appears to conflate native Ghostty (which does support Kitty graphics) with ghostty-web (which doesn't have rendering paths for it).

---

**Topic: Rust detection module refactor** — _Claude, Gemini, Codex_

> /counselors The detection module is ~1200 lines in one file with boolean fields on DetectionContext. How should I refactor it — module directory, lazy file checks, rule engine? Also check for bugs in dedup and orchestration-skip logic.

All 3 agents agreed:

1. Split into `detection/` module directory — 1200-line file is the most immediate problem
2. Replace `DetectionContext` boolean fields with a lazy/cached `file_exists()`
3. The Laravel pattern (`LaravelPackages` sub-struct) is superior to Node.js's inline booleans
4. Don't build a full rule engine/DSL — conditional logic varies too much

Codex also found 2 bugs all agents acknowledged: dedup by name drops valid suggestions in polyglot repos, and Procfile orchestration skip is too broad.

---

**Topic: ghostty-web 0.3.0 to 0.4.0 upgrade** — _Claude, Codex, Gemini_

> /counselors Review my ghostty-web 0.3.0 → 0.4.0 upgrade plan. Key concerns: getLine() WASM bug, DSR response handling, isComposing guard for CJK, phase ordering, and renderer.metrics hack risk.

| Question | Consensus |
|----------|-----------|
| `getLine()` bug fixed? | All agree: likely fixed — old broken WASM export completely removed |
| DSR response coordination | All agree: strip CPR/DA from backend, keep kitty-only |
| `patchInputHandler` | All agree: must add `isComposing` guard — CJK/IME will break without it |
| Phase ordering | All agree: keep phases 4 and 5 separate, add a Phase 0 for compat checker |
| `renderer.metrics` hack | All agree: high to extremely high risk of breakage in 0.4.0 |

## Security

- **Environment allowlisting**: Child processes only receive allowlisted environment variables (PATH, HOME, API keys, proxy settings, etc.) — no full `process.env` leak.
- **Atomic config writes**: Config files are written atomically via temp+rename with `0o600` permissions.
- **Tool name validation**: Tool IDs are validated against `[a-zA-Z0-9._-]` to prevent path traversal.
- **No shell execution**: All child processes use `execFile`/`spawn` without `shell: true`.
- **Project config isolation**: `.counselors.json` can only override `defaults`, never inject `tools`.

## Development

```bash
npm install
npm run build        # tsup → dist/cli.js
npm run test         # vitest (unit + integration)
npm run typecheck    # tsc --noEmit
npm run lint         # biome check
```

Requires Node 20+. TypeScript with ESM, built with tsup, tested with vitest, linted with biome.

## Known issues

- **Amp `deep` model uses Bash to read files.** The `deep` model (GPT-5.2 Codex) reads files via `Bash` rather than the `Read` tool. Because `Bash` is a write-capable tool, we cannot guarantee that deep mode will not modify files. A mandatory read-only instruction is injected into the prompt, but this is a best-effort safeguard. For safety-critical tasks, prefer `amp-smart`.

## License

MIT

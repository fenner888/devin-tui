# devin-tui — spec (source of truth)

A full-screen terminal UI for Devin driven by `devin acp` (Agent Client
Protocol, JSON-RPC over stdio). Grayscale only (Devin brand is black & white)
— depth comes from gray background shades, never hue. Uses the Devin braille
logo from the real CLI.

Visual style is a hybrid: OpenCode's calm layout (borderless panels,
background shades instead of boxes, centered home screen, overlays that dim
the background, right-aligned key hints) + Hermes's info density (dim
label / bright value, segmented status bar with `│` separators, two-column
slash dropdown).

## Stack

- Node ≥22 (dev on v26), ESM, TypeScript, run via `tsx`.
- Deps (pinned exact): `@agentclientprotocol/sdk`, `ink`, `react`, `zod`
  (SDK peer). Dev: `tsx`, `typescript`, `@types/react`, `@types/node`.
- No text-input/UI widget libraries. New deps require npm verification
  (real repo + download history) and a version published ≥7 days ago.
- Scripts: `start` = `tsx src/index.tsx`, `typecheck` = `tsc --noEmit`;
  `bin` entry `devin-tui`.

## Theme

All styling lives in `src/theme.ts` as named tokens — the only place colors
are defined. Grayscale palette:

- backgrounds: `bg` #0a0a0a (whole screen), `panel` #141414 (input panel,
  user messages), `overlay` #1a1a1a (popups), `raised` #202020 (inline code),
  selection #e8e8e8 on #0a0a0a.
- foregrounds: `bright` #ffffff, `text` #d4d4d4, `muted` #7a7a7a (labels),
  `faint` #4a4a4a, `rule` #2a2a2a (separators).
- `accent` = bright+bold — the mode name. Errors are bright+bold `✗`
  (never red); success is bright `✓`.
- Composer frame tokens: `bezelHi` #6a6a6a (top/left edge + `╭`),
  `bezelMid` #4a4a4a (`╮`/`╰`), `bezelLo` #2e2e2e (bottom/right edge +
  `╯`); shimmer band `shine1` #ffffff (2 head cells) → `shine2` #cfcfcf
  (3) → `shine3` #9a9a9a (5). Fallback: bezel = dim, band head = bold.
- Every rendered line is padded to full width so `bg` paints the whole
  screen; a `Seg` carries an optional `bg` that defaults to the screen shade
  at render time.
- **Fallback**: if `COLORTERM` is not `truecolor`/`24bit`, all hex colors and
  backgrounds drop out — tokens degrade to bold/dim/italic, and selection
  becomes inverse. One switch in `theme.ts`.
- **Picker palette** (a hue exception, matching the Devin CLI `/model`
  picker): `pk` #4db8ff blue, `pkDim` = blue dimmed (arrows), `pkSel` row bg
  #1c2530, `pkOff` #3a3a3a unfilled bars; reserved for badges: `pkGreen`
  #3ddc84, `pkYellow` #e6d17a, `pkFree` = #0a0a0a on #4db8ff. Fallback:
  ANSI `blueBright`/`green`/`yellow`, selected row = inverse.
- **CLI-matching hue exceptions** — the only non-picker color: `ok` #3ddc84
  (completed tool dot, `+N` diff stat, `+` diff lines), `err` #e06c6c
  (failed dot, `−M` stat, `−` lines, failed output), diff row bgs
  `diffAdd` #12261a / `diffDel` #2a1414, `cmdFlag` #6cb6ff and `cmdString`
  #e5a07a for `$ command` highlighting, `pkYellow` for the `bypass
  permissions on` composer tag. Fallback: ANSI green/red/blue/yellow, no
  diff background. Hue is allowed ONLY for: the picker (incl. the pricing
  slider's green→yellow→orange→purple gradient), success/fail dots,
  diff +/- lines, command highlighting, and the bypass tag.

## Logo

The exact 4×9 CLI braille mark lives in `theme.ts`. `scaleBraille2x` decodes
each braille char into its 2×4 dot grid (left column bits 0x01/0x02/0x04/0x40,
right column 0x08/0x10/0x20/0x80), nearest-neighbor scales to 4×8, and
re-encodes — producing the 8×18 `LOGO_2X` used on the home screen. The 1×
mark is used nowhere else; only `⣿` appears as a glyph (status bar).
Shimmer: a bright band sweeps across the mark (rest muted) continuously,
with no pauses, for as long as the home screen is shown (static muted only
on a boot error).

## CLI args

- `--cwd <dir>` — session cwd (default `process.cwd()`); validated to exist
  and be a directory before spawn.
- `--model <name>` — appended as `--model <name>` to the agent command.
- `--agent "<cmd>"` — override spawned command (default `devin acp`; used
  with `test/fake-agent.ts`).
- `-c` / `--continue` — resume the most recent session for the cwd:
  `session/list` filtered by cwd, newest `updatedAt` first (Devin's
  `_meta["cognition.ai/sessionListOrderBy"]` is `["updated_at",
  "created_at"]`), then `session/load`. No match → a fresh session plus a
  system line `no previous session in this folder`. The intent survives
  the auth detour (list errors that are auth failures rethrow and retry
  after sign-in).
- `-r <id>` / `--resume <id>` — load a specific session id the same way.

## Process / lifecycle

- Enter alternate screen (`\x1b[?1049h`) + hide cursor on start; ALWAYS
  restore on exit/crash/SIGINT/SIGTERM (`process.on('exit')` backstop). Kill
  the agent child on exit.
- Agent stderr → append to `$TMPDIR/devin-tui/devin-acp.log`, never the
  terminal. `_cognition.ai/output` ext notifications append to the same log;
  other `_cognition.ai/*` notifications are swallowed via the SDK's
  `extNotification` hook.
- Client capabilities: `fs.readTextFile=false`, `fs.writeTextFile=false`,
  `terminal=false`.

## Boot / auth flow

`initialize` → `session/new` → if it fails with a "not authenticated" error
(match `/not authenticated/i` on the error message — code -32000 is generic
JSON-RPC server error and alone does NOT imply auth), transition to the
`needsAuth` status — sign-in is explicit, never automatic. On the home
screen the input panel is replaced by a `Sign in to Devin` menu (bold
title): one row per advertised auth method (name bright, description
muted), a final `Quit` row, selected row in selection colors, and the hint
`↑↓ select · ↵ confirm`. Enter on a method → `auth` →
`authenticate({methodId})` → `session/new` → `idle`. On failure, back to
`needsAuth` showing `✗` + the error inside the menu. During `auth` the
boot steps show `authenticating · waiting for browser sign-in…` plus a
faint `q to quit` — `q` and ctrl+c both quit (the browser flow may never
complete). In `needsAuth` typing is ignored except menu keys; ctrl+c×2
still quits. No API-key path.

## Home screen (shown until the first prompt is sent)

A vertically + horizontally centered column:

1. The 2× braille mark (with shimmer).
2. `Devin` bold bright + ` TUI` muted; below, muted
   `v0.1.0 · <agentInfo.title once known>`.
3. The input panel (composer), width `min(78, cols-8)` — a rounded bezel
   frame `╭─…─╮` / `│ … │` / `╰─…─╯` drawn in `bezel*` tokens on the screen
   `bg`, with `panel` bg inside and 1 col of horizontal padding. Content
   rows: one pad row, an attachment-chips row only when chips exist
   (`⌗ <path>` file chips / `▣ <name>` image chips, faint), the input
   rows (`❯ ` + text or the muted placeholder `Ask Devin to build
   features, fix bugs, or work on your code` — `❯` on the first visual
   row, 2-col continuation indent after), a blank row, the meta row
   (`<mode name>` accent — or `connecting…` muted before
   `sessionReady` — ` · ` muted `[<model> · ]` only when known `<~cwd>`
   muted), then a pad row before the bottom border. The input is
   multiline (see Composer / input): up to 8 visible rows, internal
   scrolling beyond. Total height = 6 + visible input rows (+1 when chips
   exist). While `working`, a 10-cell shimmer band
   travels the perimeter clockwise (top L→R, right T→B, bottom R→L, left
   B→T) advancing 3 cells per 80ms tick — head `shine1`, mid `shine2`,
   tail `shine3`; static bezel otherwise. The band/bezel logic lives in
   `frameColors(w, h, tick, active)` in `panel.ts`. A mode tag is
   right-aligned on the top border with 2 border cells after it:
   ` <mode name> ` muted — or ` bypass permissions on ` in `pkYellow`
   when the mode id is `bypass`; the shimmer band recolors only border
   cells, never the tag text. Anything attached above
   the composer (slash dropdown, model picker) sits flush on the top
   border, same width — including on the home screen, where an open
   dropdown may push the logo/title rows off the top so the composer
   stays fully visible.
4. Right-aligned under the panel: `shift+tab mode   ctrl+p commands
   alt+enter newline   @ file   ▣ drop image` — keys bright, labels muted.
5. While booting/auth: step rows (spinner / `✓` / `✗` + label, muted detail —
   the auth step's own detail is `sign in via your browser…`); during auth a
   faint `q to quit` line follows; errors show the message + log path +
   `press q to quit`. Once ready: one rotating tip line
   `● Tip  <key> <text>` (● / Tip / key bright, rest muted) cycling ~5 tips
   every ~10s.
6. Corners: bottom-left `~cwd` muted, bottom-right `v0.1.0` faint.

Typing is ignored until the session is ready (`status` idle); in
`needsAuth` the input panel is replaced by the sign-in menu described in
Boot / auth flow.

## Session config

After every successful `session/new`, `{configOptions, modes, models,
_meta}` from the response is written as pretty JSON (overwrite) to
`$TMPDIR/devin-tui/session-config.json`, and every `config_option_update`
payload is appended to `config-updates.jsonl` in the same directory.
Authenticate request/response payloads are never written anywhere.
`configOptions` is stored in state; `config_option_update` replaces the
whole list. Derived labels: `currentModel` = the name of the current value
of the select option with category `model` (fallback: id `model`);
`currentEffort` = same for `thought_level`. The input-panel meta row and
status-bar model segment show `currentModel` — falling back to `--model`
only until config data exists. Mode display likewise resolves the human
name — `modes.availableModes[].name`, else the `mode` config option's
value name, else the raw id (real Devin shows `Code`, `Smart`, `Plan`,
`Ask`, `Bypass Permissions`).

## Model picker

Devin CLI-style picker, inline directly above the input panel (same slot
as the slash dropdown, not a centered overlay):

- Opened by `/model` or the command panel's **Switch model** (Session
  section, hint `/model`); requires a session and a `model` select option,
  else a `model switching not available` system line.
- Rows = the option's values; group names render as faint non-selectable
  headers. Max 8 visible rows with `↑ n more above` / `↓ n more below`
  markers. The ` / type to search` row filters by case-insensitive
  substring; typing edits the filter, backspace deletes.
- Selected row: `❯` + name in picker blue on the `pkSel` background; the
  effort control shows only on that row — dim `←`/`→` around one `■` per
  `thought_level` option (filled to the pending choice in blue, unfilled
  `pkOff`) + the effort label in blue. ←/→ adjust the pending effort. With
  no `thought_level` option the control and the `←→` hint are omitted.
- Non-selected rows: name in `text`, the current model marked `•` faint.
- Footer: `↑↓ select · ←→ reasoning effort · ↵ confirm · esc cancel`.
- Enter applies: `session/set_config_option` for the model if changed,
  then for `thought_level` if changed; errors surface as a system line.
  Esc closes without changes. Opening while `working` is blocked by the
  existing `agent is working` notice.

### Catalog pricing + badges (`src/catalog.ts`)

- The catalog loads once at startup (non-blocking): `DEVIN_TUI_MODELS_FILE`
  (test override, read directly) → `devin models list --format json`
  (execFile, no shell, 20s timeout; a successful payload is written to the
  persistent cache `~/.cache/devin-tui/models.json`) → that cache →
  unavailable. Indexed by `model_uid` → label, `costTier`, parsed
  `prices` (input/cached/output, tolerant `$<n> / 1M <label>` regex),
  `isNew`, `isBeta`, `maxContext`. When unavailable the picker renders
  exactly as before plus one faint footer line `prices unavailable — log
  in the Devin CLI (devin auth login) to load them`.
- Badge column after the name: `✱` `pkGreen` for `is_new`, `✱` `pkYellow`
  for `is_beta` (New wins if both), blank otherwise.
- Below the list, for the selected row's catalog entry: blank row,
  price slider (~30 `━` cells RGB-interpolated green `#3ddc84` → yellow
  `#e6d17a` → orange `#e5a07a` → purple `#b48ead`, bright `●` knob at the
  model's log-scale OUTPUT-price position between the min and max among
  priced options; ANSI-segment fallback), then muted `Input / Cached
  input / Output` labels over bright `$<n> / 1M` values, blank row, then
  a `✱ New  ✱ Beta` legend listing only the badges present in the list.
- `cost_tier: "Free"` (no `cost_summary`) renders a `pkBadge` `FREE` badge
  + ` no quota consumed` instead of slider+prices. A model missing from
  the catalog omits the pricing rows (legend stays). The `/fusion`
  picker shows the same block for the selected lead+sidekick pair
  (`fusion-…` uids are in the catalog).
- Height pressure (`maxRows` = the picker's screen-fit budget) sheds in
  order: legend → slider → pad rows → all detail rows → then the list
  window itself shrinks (min 3 visible rows) so the picker always fits
  with the composer intact.

## Composer / input

- **Multiline**: `alt+enter` (meta+return, i.e. `ESC CR`) or `ctrl+j` (a
  bare `\n` — Ink parses it as name `enter`, `input='\n'`, no modifiers)
  inserts a newline; `Enter` (`\r`, `key.return`) sends. Pasted text
  arrives via Ink's `usePaste` (bracketed paste `\x1b[?2004h`, separate
  event channel) — `\r\n` and `\r` inside pastes normalize to real
  newlines and never submit. The input grows with content up to 8
  visible rows and scrolls internally; `↑`/`↓` move the cursor between
  visual rows (hard newlines + soft wraps) keeping the column — history
  navigation only engages when the cursor is on the first (↑) or last
  (↓) visual row. All editing helpers live in `src/composer.ts`
  (`visualLines`, `cursorLine`, `moveVertical`).
- **@file mentions**: typing `@` at a word start opens a dropdown in the
  slash-dropdown slot/style (same `slashMenuBlock`, `@` prefix) listing
  project files — `git ls-files -co --exclude-standard` inside a git
  repo, else a bounded walk (skips `node_modules`/`.git`, ≤5000 entries).
  Rows filter by substring-then-subsequence match on the text after `@`,
  max 8. `Tab`/`Enter` inserts `@<relative path> `, `Esc` dismisses until
  the token is deleted. On send, every `@path` token that resolves to an
  existing file inside cwd stays in the text block AND adds a
  `resource_link` block `{type:'resource_link', uri:'file://<abs>',
  name:<basename>}`; resolved mentions render as `⌗ <path>` chips on the
  chip row.
- **Images**: a typed or pasted token that is a path to an existing
  image (`.png .jpg .jpeg .gif .webp` — quoted or shell-escaped paths
  and `~` are unwrapped, matching terminal drag-and-drop) is removed
  from the text and becomes a `▣ <name>` chip. On send each chip adds an
  `image` block `{type:'image', mimeType, data:<base64>}`; files over
  5 MB are skipped with an `image too large` system line. Backspace at
  the start of an empty input pops the last chip. Image attachments ride
  along with queued guidance submitted while `working`.
- Prompts are sent as `session/prompt` content blocks: the text block
  first, then one `resource_link` per resolved mention, then one `image`
  per chip.

## /resume — session picker

- `/resume` (local command `resume a previous session`), the command
  panel's **Resume session** (Session section, hint `/resume`), `-c` and
  `-r` all use ACP `session/list` + `session/load` (never
  `session/resume`); requires `sessionCapabilities.list` / `loadSession`.
- The picker renders with `pickerShell` in the model-picker slot: title
  row `Resume · <cwd>` muted, ` / type to search` filter, sessions for
  the current cwd newest-`updatedAt`-first — title (or `Untitled`)
  bright/selection-blue, right-aligned faint `<relative time> · <short
  id>` (`just now`, `5m ago`, `2h ago`, `3d ago`), current session
  marked `•`, footer `↑↓ session · ↵ confirm · esc cancel`. Enter loads;
  Esc cancels. Blocked while `working`; empty list / unsupported →
  system line.
- Loading: transcript/plan/queue/usage/title state is cleared, the
  activity row shows `Loading session` while `session/load` is in
  flight, then the response is treated like `sessionReady` (modes,
  configOptions, session-config.json capture, usage). Replayed
  `user_message_chunk` updates merge consecutive chunks into one user
  item — a live turn's own echo is still suppressed so submitted text
  never double-renders. Turn count = number of replayed user messages.
  After loading, the session screen shows (not home), tail-followed.

## /fusion — Fusion picker

Fusion pairs live inside the `model` select option — values `fusion-…`,
names `Fusion (<lead> + <sidekick>)` (real Devin: ~35 entries; effort is
baked into the lead/sidekick names). Parsed by value prefix +
`/^Fusion \((.+) \+ (.+)\)$/`, grouped by lead in first-appearance order.
Rendered with the same `pickerShell` as the model picker, same slot:

- Opened by `/fusion` or the command panel's **Switch to Fusion**
  (Session section, hint `/fusion`); requires a session and ≥1 parseable
  fusion option, else `Fusion isn't available for this account`. Blocked
  while `working`.
- Title row `Fusion · lead + sidekick` (muted) above the ` / type to
  search` filter row (filters leads by substring). Rows = unique leads.
  The selected row's right-side control is the sidekick cycler
  `← + <sidekick> →` (arrows `pkDim`, name `pk`) — ←/→ wrap through the
  sidekicks that exist for that lead; the pending choice is kept per
  lead. Default per lead: the current pair's sidekick when the current
  model is a fusion pair of that lead, else the first available. The lead
  containing the current pair is marked `•`.
- Footer `↑↓ lead · ←→ sidekick · ↵ confirm · esc cancel`. Enter applies
  `session/set_config_option(model = <pair value>)` only (no
  thought_level — effort is in the names); Esc cancels. `fusion` is a
  local command filtered from agent commands like login/logout.

## Session screen (after the first prompt)

- No header bar. Transcript is centered at `min(110, cols-4)` content width.
- **User message**: `panel` block, 1 row padding top/bottom, first line
  prefixed `❯ ` muted, continuation lines indented 2 cols, text bright.
- **Agent message**: plain `text` on bg, no label. Markdown: `**bold**` →
  strong, `` `code` `` → raised bg + bright, `#` heading → bold bright,
  fenced blocks → `panel` bg with a faint `│` gutter, bullet lists
  (`- `/`* `/`+ ` → `  • `, `N. ` kept numbered) with hanging-indent
  continuations; 2+ leading spaces nest 2 cols deeper. Blinking `▌` caret
  inline at the end of the last line while the item is last + a turn is
  running; leading and trailing blank markdown lines trimmed.
- **Thought**: one line — `∴ Thinking` muted italic + ` · <last line>`
  faint.
- **Tool call**: a Devin-CLI-style block, all data merged across
  `tool_call` + `tool_call_update` (kind, status, title, content[],
  locations[], rawInput, rawOutput — every field optional, unknown shapes
  fall back to title + text). Merge semantics match real Devin: an update
  WITHOUT `content` keeps the previous content; an update WITH content
  replaces it (real exit previews arrive on `in_progress` updates, the
  final `completed`/`failed` update is status-only). Tool `_meta` is
  mined on every call/update: `exitCode` ← `_meta.terminal_exit.exit_code`
  (last seen wins), `cwd` ← `_meta["cognition.ai/cwd"]`.
  - Header: status dot + verb phrase bright + subject muted. Dot: `○`/`◌`
    alternating every ~4 ticks while pending/in_progress, `●` `ok` when
    completed, `●` `err` when failed. Header text: **execute** → Devin's
    `title` verbatim when non-empty (`Listed ./src`, `Ran npm test`),
    fallback `Running command`/`Ran command` by tense; read/edit/delete/
    move WITH `locations` → our `<Verb> <path>` (Devin's `Read file` is
    too generic) — `<Verb>` from kind × tense (`Editing`/`Edited`,
    `Reading`/`Read`, `Deleting`/`Deleted`, `Moving`/`Moved`); without
    locations → title. Anything else, including kind-less calls (Devin's
    `Invoked skill …` has no `kind`) → title as-is, fallback `Tool`.
    Subject: read/edit/delete/move → first `locations[].path` relative to
    cwd (`~`-collapsed outside home), `:line` appended when present,
    fallback = title minus a leading verb word. Edit also appends
    `+N −M` diff stats (`ok`/`err`).
  - **Inline short result**: a completed non-execute tool whose text
    content is a single line ≤ 40 chars (e.g. read's `22 lines`) appends
    it to the header as faint ` · <text>` instead of a body line.
  - Command extraction (execute): `rawInput.command` (string or
    array-joined) → else the text of a `resource` content item whose
    nested `_meta["cognition.ai/preview_is_shell_command"]` is true →
    else title. The preview resource is never counted or shown as
    output; output = text content items only (else
    `rawOutput.output`/`stdout`).
  - Body under a faint `│` gutter (last body line `╰`), at most ~8 body
    lines, dropped entirely while pending:
    - execute — **collapsible**: while pending/in_progress the block is
      just the header + one `$ <command>` gutter line (no output); once
      completed/failed it collapses to a single line `● <title> · $
      <command> · <n> lines · exit <N> ▸` (command keeps its highlight and
      is `…`-truncated to fit; `<n> lines` omitted when 0; `exit <N>` in
      `err` only for non-zero codes). `ctrl+o` toggles `expandTools`:
      expanded blocks show the header with `▾` + the full body — and a
      tool with a pending inline permission is always expanded. Expanded
      body: `$ <command>` with light syntax highlight — first word
      bright, `-flags` `cmdFlag`, quoted strings `cmdString`; then output
      capped at 10 lines + faint `… n more lines`; then faint `Exited
      with code N` when an exit code is found — stored `exitCode`
      (from `_meta.terminal_exit`) first, then `rawOutput.exitCode`/
      `exit_code`/`code`.
    - edit: per `diff` content, a line LCS (counts only past 400 lines):
      up to 12 changed lines with 1 context line, `+` green on `diffAdd`,
      `−` red on `diffDel`, context faint, faint right-aligned 4-col
      new-file line-number gutter, `+ n more` marker when truncated.
      No `oldText` → first 8 lines as additions.
    - read/search/fetch/other: up to 3 faint text-content lines.
    - failed: first 3 content lines in `err`.
  - **Body clamping**: every tool body row (output lines, diff rows,
    read text) is detabbed (tabs → spaces, since `cpWidth('\t')` = 0 but
    terminals advance to tab stops) and truncated to the available width
    after its gutter with `…`; the `diffAdd`/`diffDel` background fill
    stops at the content width.
- **System**: faint `· …`.
- **Inline permission**: a pending `session/request_permission` renders
  directly beneath its tool call (`toolCall.toolCallId` match; standalone
  block at the bottom when not found): `❯ 1 <name>` selected (chevron +
  number + name in `pk`, bold), `  2 <name>` rest (number faint, name
  text), footer faint `↑↓ select · ↵ confirm · esc cancel`. Keys: ↑↓,
  Enter confirms, digits 1–9 choose+confirm, `y`/`a`/`n` map to
  allow_once/allow_always/reject_once, Esc = reject_once else cancelled.
  Tail-follow keeps it visible. There is no permission overlay.
  - Real Devin requests may carry no title/kind — only
    `_meta["cognition.ai/editableCommand"]`; when the matched tool item
    has no command yet, that string becomes its `$ <command>` (an
    existing command is never overwritten), and a standalone block uses
    `$ <editableCommand>` as its command line. Option names come from the
    request verbatim — Devin's real set is six (`Allow`, `Yes, allow
    \`x\` commands (this session)`, `… in \`project\``, `… in all
    projects`, `Yes, switch to bypass mode`, `Reject`).
- **Activity row**: while `status === 'working'`, one row pinned to the
  bottom of the transcript (after the last item, one blank row between):
  `<spinner> <Label> · <elapsed> (esc twice to interrupt)` — spinner
  bright, label with a 3-char bright band sweeping over muted
  (~1 char/tick, looping), `· 11s` faint, hint faint. Label: `Thinking`
  when the last item is a thought, `Running tools` when any tool call is
  pending/in_progress, else `Working`. It counts as transcript content for
  scrolling/tail-follow and disappears on turn end.
- **Queued messages**: while `working`, Enter queues the typed text (ACP
  doesn't allow concurrent prompts). Queued text renders as faint
  `↳ queued: <text>` rows (truncated to one line) above the activity row.
  On turn end the queue is sent automatically as ONE prompt joined by
  blank lines; if the turn was cancelled the queue survives and is
  prepended to the next Enter. `/clear`, `/logout` and `/model` stay
  blocked while working.
- **Plan block**: compact, separated from the transcript and the input panel
  by one blank row each — `Plan <done>/<total>` muted header, entries `○`
  pending muted / `◐` in_progress bright / `●` completed faint, max 5 rows +
  `+n more`. When every entry is completed and the agent is idle it
  collapses to a single faint `Plan n/n ✓` line. Toggled by ctrl+b and
  `/sidebar`.
- Items are separated by exactly one blank row; agent-message leading and
  trailing blank markdown lines are trimmed at render.
- **Scrolling**: transcript renders to pre-wrapped `Seg[]` lines; viewport
  slice, tail-follow. PgUp/PgDn page, shift+↑/↓ line. `↓ n more` marker,
  faint, right-aligned above the input.
- **Input panel**: same framed block as home, full content width. Meta row
  shows `<mode> · <model> · <cwd>` — but `connecting…` muted in place of the
  mode until `sessionReady`, and the model segment only when the model is
  known (config option value, else `--model`; never "default model"). The
  frame's shimmer band runs while `working`.
- **Status bar** (one blank row under the panel, one blank row after the
  bar so it doesn't sit on the last terminal row): left
  `⣿ <mode name>  │  [<title>  │  ] <model> <effort>` — the session title
  (from `session_info_update`, muted, max 30 cols) precedes
  `<model> <effort>` (effort = `thought_level` value name, omitted when
  none); then `  │  turns <n>  │  tools <n>` and `│  <elapsed>` only while
  working. Right: `Context: 14k / 262k tokens (5%)` from the latest
  `usage_update` (k = /1000 rounded, % = used/size rounded, omitted until
  the first update) then `● working` (spinner) / `○ idle` then
  `  ctrl+o expand|collapse  esc cancel  ctrl+p commands` (keys bright,
  labels muted). When width is tight, drop `ctrl+o` first, then the rest
  of the key hints, then turns/tools, then the session title. Notices
  (`press ctrl+c again to quit`, `press esc again to
  interrupt`) temporarily replace the working/idle + hint segs, bright.
- On `session_info_update` the terminal title is set via OSC
  `\x1b]0;devin: <title>\x07` and restored to `devin-tui` on exit.
- While `working`, Enter queues the typed text (see Queued messages above).
  Slash text goes to the
  agent verbatim. Local commands: `/quit` / `/exit` (bare `quit` / `exit`
  also work, like the Devin CLI), `/clear` (fresh session → back to
  home), `/sidebar` (toggle plan block), `/model` (model picker), `/login`
  (in `needsAuth`: same as picking the first auth method; while signed in:
  re-authenticates with the first method and keeps the session), `/logout`
  (`conn.logout({})`, then clears session, transcript and config state →
  home in `needsAuth`; a method-not-found error shows a system line),
  `/status` (system line `signed in|signed out · <agentTitle> · session
  <short id|—> · log <path>`), `/handoff [task]` (see below), `/fusion`
  (see below), `/resume` (see above — session picker), `/help` (see
  Overlays → Help). Agent-advertised commands named `login`,
  `logout`, `status`, `model`, `handoff`, `fusion`, `resume` or `help` are filtered out of
  the Agent section and slash dropdown so local commands always win.

## /handoff — hand off to a cloud Devin

Devin's ACP server does not expose `handoff`, so it is implemented
locally, mirroring the open-source `devin-handoff.sh` `create` exactly
(`src/handoff.ts`):

- Requires `DEVIN_API_KEY` (personal `apk_*` or service `cog_*`) — missing
  → system line `set DEVIN_API_KEY to use /handoff — create one at
  app.devin.ai/settings/api-keys`. The key is only ever sent in the
  `Authorization: Bearer` header — never logged, echoed, or written to
  disk; request bodies are never logged.
- API base: `DEVIN_API_URL` env, default `https://api.devin.ai`. Personal
  keys → `{base}/v1`; service keys (`cog_*`) → `{base}/v3/organizations/
  {DEVIN_ORG_ID}` (required). Endpoint: `POST {base}/sessions`,
  `Content-Type: application/json`, body `{prompt, title:
  task.slice(0,100), tags: ["handoff"]}` (+ `create_as_user_id` for
  service keys when `DEVIN_USER_ID` is set). Response: `.url`, else
  `https://app.devin.ai/sessions/{session_id minus devin- prefix}`.
- Prompt = task + `<details>` context block (`Repo:`/`Branch:` lines +
  context) + `<details>` uncommitted-diff block fenced ` ```diff `,
  byte-capped at 100KB — identical assembly to the script.
- Git context via `git` (execFile, no shell): `remote get-url origin` →
  slug (ssh/https prefixes + `.git` stripped), `rev-parse --abbrev-ref
  HEAD` → branch, `diff HEAD` → diff; skipped entirely outside a git repo.
- Context = a plain-text transcript digest (`User:`/`Devin:` lines +
  tool one-liners like `Ran command: <cmd>`, `Edited <path>`), last ~8KB.
- Task = the `/handoff` args, else `Continue where the local session left
  off.`
- Confirmation block renders above the composer (same slot as the slash
  dropdown): `Hand off to a cloud Devin?` bright, faint rows `repo
  <slug|none> · branch <b|none> · diff <n> KB · context <n> KB` and
  `task: <task>`, hint `↵ confirm · esc cancel`. Enter POSTs; Esc cancels.
  Blocked while `working` (existing notice).
- Success → system line `· ◆ handed off → <url>` (url bright); failure →
  `handoff failed: <HTTP status + server detail | network error>` (the
  key never appears in messages).

## Overlays

While an overlay is open the underlying screen is re-rendered with every
foreground forced to `faint` (dimmed backdrop); the overlay paints on
`overlay`. Overlays use 2-col inner padding and one blank row inside the
`overlay` bg top and bottom.

- **Command panel** (ctrl+p): centered borderless `overlay` block, width
  `min(64, cols-8)`. Title `Commands` bold bright + `esc` muted right;
  `Search` row (muted placeholder, typed text bright, filters); sections
  headed by muted labels (**Session**, **Agent**, **Account**, **App**)
  separated by a blank row — **Session** (New session → `/clear`, Toggle
  plan, Cycle mode, Toggle command output → `ctrl+o`, Hand off to cloud
  Devin → `/handoff`, Switch to Fusion → `/fusion`, Switch model →
  `/model`, Resume session → `/resume`), **Agent** (every advertised
  ACP command minus the locally-handled names), **Account** (Sign in, Sign
  out, Status), **App** (Help → `/help`, Quit). Items are
  two-column: name bright padded to the widest name + 2, description muted;
  right-aligned shortcut hints muted (ctrl+b, shift+tab, ctrl+c) with 2-col
  right padding. Selected row = selection colors across the full inner
  width. Enter runs; agent commands insert `/name ` into the prompt (no
  auto-send).
- **Help** (`/help` or the command panel's **Help** item): the same
  centered `overlay` chrome (title `Help` + `esc`, `Search` row filtering
  all rows by substring, selection bar), scrollable with `↑/↓ n more`
  markers when taller than `rows-4`. Sections (muted headers): **TUI
  commands** — every `LOCAL_COMMANDS` entry `/name` + description;
  **Keys** — the exported `HELP_KEYS` list (one constant next to the key
  handling); **Devin commands** — advertised agent commands grouped by
  `_meta["cognition.ai/category"]` in first-appearance order as faint
  sub-headers (`Other` when uncategorized), each `/name` + description
  with `input.hint` appended faint (e.g. `/plan [prompt]`); before a
  session exists the section shows `connect to see Devin's commands`.
  ↑↓ move (headers are skipped), typing filters, Backspace edits, Enter
  on a command row closes and inserts `/name ` into the prompt (key rows
  do nothing), Esc closes.
- **Slash dropdown**: typing `/` at the start of input opens a two-column
  dropdown directly above the input panel (`/name` bright padded,
  description muted), `overlay` bg, selected row full-width selection
  colors, max 8 rows. ↑↓ select, Tab/Enter complete, Esc closes. The same
  block with an `@` prefix hosts the file-mention dropdown (see Composer
  / input).
- **Permission**: there is no permission overlay — requests render inline
  in the transcript under their tool call (see Session screen → Inline
  permission). The dimmed-backdrop overlay style is used only by the
  command panel and /help.

## Keys

- Esc: while working, double-press within 1.5s cancels the turn (first
  press shows `press esc again to interrupt`); close palette/panel/
  mention dropdown; resolve a pending permission (reject_once, else
  cancelled); clear input when idle.
- Enter sends; Alt+Enter / Ctrl+J insert a newline (see Composer /
  input). `↑`/`↓` move the cursor between visual rows of a multiline
  input — prompt history only from the first/last row. Tab/Enter accept
  an `@file` dropdown row; Backspace on an empty input pops the last
  attachment chip.
- Shift+Tab: cycle modes via `session/set_mode` when `modes` advertised.
- Ctrl+P: command panel. Ctrl+B: plan block toggle. Ctrl+O: expand/collapse
  command blocks. Ctrl+C twice within 1.5s
  → quit (first press shows a hint). `q` quits during auth and from the
  error screen.

## State

Reducer store (`src/state/store.ts`). `agent_message_chunk` merges into the
current streaming agent item; `agent_thought_chunk` into the thought item;
`tool_call`/`tool_call_update` keyed by `toolCallId` — updates merge
kind/status/title/locations/rawInput/rawOutput into the existing item;
`content` is replaced only when the update carries it (real Devin's
final status update has none); `_meta` is mined for `exitCode`
(`terminal_exit.exit_code`, last seen wins) and `cwd`
(`cognition.ai/cwd`); `plan` replaces entries; `available_commands_update` and
`current_mode_update` tracked; `usage_update` → `{used, size}` for the
context indicator; `session_info_update` → `sessionTitle` (+ OSC terminal
title). `user_message_chunk` merges consecutive chunks into one user item
during a `session/load` replay (the same update during a live turn echoes
our own submit and is dropped — the submit already rendered it).
`loading` is set while a `session/load` is in flight (input ignored,
activity row reads `Loading session`). `pendingPermission` holds the live permission request (sessionId,
toolCallId, options, `editableCommand` from the toolCall's
`cognition.ai/editableCommand` meta); `queuedMessages` holds text
submitted while working;
`expandTools` (ctrl+o) expands collapsed command blocks.
Unknown update kinds ignored (never fatal). Status: booting / needsAuth /
auth / idle / working / error + turn count, tool-call count, turn elapsed,
agent title, `sidebar` flag (plan block visibility), `authMethods` +
`authError` for the sign-in menu, and `configOptions` (replaced wholesale
by `config_option_update`). `logout` resets session, transcript and config
state to `needsAuth`.

## Testing

- `test/fake-agent.ts` — `AgentSideConnection` fake Devin: auth gate
  (-32000 pre-auth, re-armed after `logout`), ~1s authenticate, modes
  (normal/plan/accept-edits), `configOptions` on `session/new` (mode
  select, a 10-model select in two groups plus a 5-pair Fusion group —
  2 leads × 3 sidekicks, one pair missing — thought_level
  low/medium/high/max — a shorter list for `opus-5`),
  `session/set_config_option` (stderr log + `config_option_update`
  push), `logout`, `_cognition.ai/output` notifications, slash commands
  advertised at `session/new` (with `cognition.ai/category` meta + one
  `input.hint`, incl. a `help` command the reserved-name filter drops), ~2.5s TTFT before the first streamed
  update, a realistic weather-task first turn mirroring real Devin
  payload shapes (thought → plan → execute `Listed ./src` with a
  `tool://preview` shell-command resource, output via `in_progress` text
  updates, `_meta.terminal_exit`, status-only final update → inline
  permission with the real six options + `cognition.ai/editableCommand`
  → `Read file` with `locations[]` + `22 lines` completion → kind-less
  `Invoked skill …` → edit with diff content incl. a long indented line
  that overflows at 80 cols → failing `Ran npm test` with
  `terminal_exit` code 1; `usage_update` after each
  tool; `session_info_update` {title}; markdown incl.
  heading/bold/code/fence/bullets), slow cancelable second turn.
  `session/list` returns 3 cwd-scoped sessions with titles/updatedAt;
  `session/load` replays a short history (merged `user_message_chunk`s,
  thought, messages, a completed execute call, `session_info_update`,
  `usage_update`) before responding. Every received prompt is logged to
  stderr as `prompt #n blocks: <type,…>` plus the raw text between
  `text:`/`end prompt` markers so content-block types (text,
  resource_link, image) and multiline newlines are verifiable; a live
  prompt is echoed back as `user_message_chunk` like real Devin.
- `scripts/drive.py` — PTY driver (pty.fork + TIOCSWINSZ + timed keystrokes,
  raw capture). `\r` must be sent as its own write (Ink 7 treats `\r` inside
  a multi-byte chunk as paste text, not Enter). Scenario `png` covers
  login menu/auth/ready/session/model picker (+filter)/command panel/
  logout for screenshots; `work` covers tool blocks, inline permission,
  queued messages, cancel and mode tag; `cmd` covers collapsed/expanded
  command blocks; `handoff`/`handoffsend`/`handoffnokey` cover the
  /handoff confirm block, a real POST against `$DEVIN_API_URL` (point it
  at a local recorder — never the real API in tests), and the missing-key
  path; `fusion` opens the Fusion picker, cycles the sidekick and applies
  a pair; `help`/`help80` cover the /help overlay (sections, filter,
  Enter-inserts-command, scroll markers); `real`/`real80` cover the real-Devin payload turn (collapsed
  lines, expanded blocks, six-option permission, long-diff clamping);
  `resume`/`continue`/`resumeid` cover the /resume picker, `-c` and
  `-r`; `multiline`/`multiline80` cover alt+enter/ctrl+j/bracketed-paste
  newlines; `mention` covers the `@` dropdown; `attachments` covers the
  ⌗/▣ chips and the `text,resource_link,image` prompt; `realedit` (with
  `DRIVE_AGENT=real DRIVE_CWD=<scratch repo>`) is the real-Devin edit
  test; `pricing`/`pricing80` cover the catalog pricing block (priced,
  FREE, fusion pair, 80x24 shedding — needs `DEVIN_TUI_MODELS_FILE`);
  `fallback` ends on the picker without truecolor.
- `scripts/snapshot.ts` — ANSI → screen emulator; `--after <marker>` dumps
  the first complete frame containing the marker, `--after-last` the last,
  `--before` the last complete frame before the marker's sync block
  (frame ends at `\x1b[?2026l`, Ink's synchronized-update boundary);
  `--json` emits per-cell `{ch, fg, bg, bold, dim, italic, inverse}`.
- `scripts/render-png.py` — paints a `--json` frame to PNG with Pillow
  (Menlo for text; Apple Braille for U+2800–28FF). PNG screenshots are the
  real visual verification — text snapshots can't show gray shades.
- `scripts/check-real-devin.ts` — real `devin acp` initialize + session/new
  rejection + ext-notification resilience; never calls `authenticate`.

Snapshots live in `.snapshots/` (artifacts, not committed expectations).

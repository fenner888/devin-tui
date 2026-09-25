# devin-tui

A custom full-screen terminal UI for Devin, driven by `devin acp`
(Agent Client Protocol — JSON-RPC over stdio). React + Ink, black & white only.

Read `specs/devin-tui.md` first — it is the source of truth for UI/behavior.
Update the spec, don't patch around it.

## Run

```sh
npm install
npm start                      # launches against `devin acp`
npm start -- --cwd /some/dir   # session working directory
npm start -- --model <name>    # passed through as `devin acp --model <name>`
```

Requires an interactive TTY. `devin` must be on PATH.

## Test against the fake agent (no real Devin, no login)

```sh
npm start -- --agent "npx tsx test/fake-agent.ts"
```

The fake agent mimics Devin: browser-auth gate (explicit sign-in menu —
no auto-authenticate), modes, session config options (`/model` picker),
`logout`, streaming markdown, plan updates, tool calls, a permission
request, `_cognition.ai/*` extension notifications, and cancellation.

## Verify

```sh
npm run typecheck              # tsc --noEmit (TypeScript 7.x / tsgo)
```

PTY-driven smoke tests + screen snapshots:

```sh
python3 scripts/drive.py 120 36 .snapshots/run.raw full   # scripted keystrokes
npx tsx scripts/snapshot.ts .snapshots/run.raw            # ANSI → plain text
npx tsx scripts/snapshot.ts .snapshots/run.raw --after 'PERMISSION'  # frame boundary
npx tsx scripts/snapshot.ts .snapshots/run.raw --json     # → cell grid JSON
python3 scripts/render-png.py .snapshots/run.raw --out shot.png  # ANSI → PNG
```

PNG snapshots are the real visual check (gray shades need pixels):
`COLORTERM=truecolor python3 scripts/drive.py 120 36 .snapshots/run.raw png`
then `render-png.py` per marker.

Real-Devin compatibility check (does NOT authenticate):

```sh
npx tsx scripts/check-real-devin.ts
```

## Design rules — do not break these

- **Grayscale only.** All styling goes through the named tokens in
  `src/theme.ts` — a black-and-white palette where depth comes from gray
  background shades, never hue. Never pass `color=` or `backgroundColor=`
  to Ink components; only `theme.ts` maps tokens to styles. Truecolor
  backgrounds/hex foregrounds apply only when `COLORTERM` is
  `truecolor`/`24bit`; otherwise the UI falls back to bold/dim/inverse
  (picker → ANSI blue/inverse; status hues → ANSI green/red/blue/yellow).
  Hue is allowed ONLY for: the `picker` palette (`pk*` tokens, matching
  the Devin CLI `/model` picker's blue), success/fail tool dots
  (`ok`/`err`), diff `+`/`−` lines and stats (`diffAdd`/`diffDel` bgs),
  `$ command` highlighting (`cmdFlag`/`cmdString`), and the yellow
  `bypass permissions on` composer tag (`pkYellow`).
- **Config capture is debug-only.** Protocol captures
  (`session-updates.jsonl`, `session-config.json`, `config-updates.jsonl`
  in `$TMPDIR/devin-tui/` — they contain session content) are written only
  when `DEVIN_TUI_DEBUG=1`; off by default. Authenticate request/response
  payloads are never written anywhere.
- **stderr → log file.** The agent's stderr is chatty tracing. It is piped to
  `$TMPDIR/devin-tui/devin-acp.log` — never to the terminal — and rotated to
  `devin-acp.log.1` at startup once it exceeds 5 MB. `_cognition.ai/*`
  extension notifications are swallowed/logged via the SDK's `extNotification`
  hook, never rendered.
- **Alt screen hygiene.** We enter `\x1b[?1049h` + hide cursor on start and
  ALWAYS restore on exit/crash/signals (`src/index.tsx`). The prompt cursor is
  drawn as an inverse block, not the terminal cursor.
- **Own layout.** The whole screen is composed as pre-wrapped `Seg[]` rows
  (`src/ui/lines.ts`, `markdown.ts`, `transcript.ts`, `panel.ts`,
  `overlays.ts`, `home.ts`, `session.ts`) — no Ink text wrapping for
  transcript content. Every line is padded to full width so `bg` paints the
  whole screen. Scrolling is a viewport slice with tail-follow; overlays
  re-render the base screen with foregrounds forced to `faint`.
- **No new deps** without verifying the package on npm (real repo, download
  history) and pinning a version published ≥7 days ago. No text-input or UI
  widget libraries — input is hand-rolled on `useInput`.
- **No hardcoded secrets.** Auth is the agent's browser PKCE flow via the ACP
  `authenticate` method; there is no API-key path.
- Don't commit `.snapshots/` expectations into code; snapshots are artifacts.

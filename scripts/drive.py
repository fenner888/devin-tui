#!/usr/bin/env python3
"""Drive devin-tui in a real PTY with a timed keystroke script; record raw output.

usage: drive.py <cols> <rows> <rawfile> <scenario>

scenarios:
  boot   - quit during the boot screen (ctrl+c x2)
  full   - prompt, permission 'y', palette, scroll, cancel, quit
  short  - prompt, permission 'y', quit (for the 80-col layout)
"""
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time

ESC = b"\x1b"

SCENARIOS = {
    "boot": [
        (1.2, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    "full": [
        (6.0, b"\r"),             # needsAuth menu -> select first auth method
        (2.5, b"hello devin"),    # first prompt
        (0.3, b"\r"),             # CR as its own write (like a real terminal)
        (7.0, b"1"),              # permission: digit -> Yes (allow once)
        (5.5, b"/"),              # turn done -> open command palette
        (0.8, ESC),               # close it
        (0.4, b"\x1b[5~"),        # PgUp
        (0.5, b"\x1b[6~"),        # PgDn
        (0.4, b"again"),          # second prompt -> slow stream
        (0.3, b"\r"),
        (3.0, b"zzz"),            # type while agent is working
        (0.3, b"\r"),             # enter queues the guidance row
        (0.8, ESC),               # esc 1: 'press esc again to interrupt'
        (0.4, ESC),               # esc 2: cancels turn (zzz stays queued)
        (0.6, ESC),               # idle esc clears the input
        (0.3, b"f"),              # fast typing: separate byte writes
        (0.03, b"a"),
        (0.03, b"s"),
        (0.03, b"t"),
        (0.03, b"!"),
        (0.8, b"\x03"),           # ctrl+c hint
        (0.4, b"\x03"),           # ctrl+c quit
        (1.0, b""),
    ],
    "short": [
        (6.0, b"\r"),             # needsAuth menu -> auth
        (2.5, b"hi"),
        (0.3, b"\r"),
        (7.0, b"1"),
        (5.0, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # PNGs: login-menu -> home-auth -> home-ready -> working frames ->
    # model-picker (+filter) -> idle after model change -> command-panel ->
    # after-logout -> quit
    "png": [
        (7.0, b""),               # boot -> needsAuth menu (login-menu.png)
        (0.3, b"\r"),             # select first auth method
        (0.8, b""),               # 'waiting for browser sign-in' (home-auth.png)
        (2.5, b""),               # auth done -> ready (home-ready.png)
        (0.3, b"hello devin"),
        (0.3, b"\r"),             # turn streams (session-working-*.png)
        (7.0, b"1"),              # permission: digit -> Yes
        (5.5, b"/model"),         # turn done -> open the model picker
        (0.3, b"\r"),             # (model-picker.png)
        (1.2, b"cl"),             # filter -> Claude rows (model-picker-filter.png)
        (1.0, b"\x1b[B"),         # down -> Claude Sonnet 5
        (0.6, b"\r"),             # apply: model + thought_level
        (2.5, b""),               # clean idle frame w/ new model (session-idle.png)
        (0.4, b"\x10"),           # ctrl+p -> command panel (Account section)
        (1.5, ESC),               # close
        (0.4, b"/logout"),
        (0.3, b"\r"),             # logout -> needsAuth (after-logout.png)
        (1.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # home slash dropdown + working-activity frames
    "ui2": [
        (6.0, b"\r"),             # needsAuth -> auth -> session
        (3.0, b"/"),              # slash dropdown on the home screen
        (1.5, ESC),               # close (clears the input)
        (0.5, b"hello devin"),
        (0.3, b"\r"),             # turn starts; ~2.5s TTFT then streams
        (9.0, b"1"),              # permission arrives ~5.5s into the turn
        (5.0, b""),               # turn ends -> idle
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # Devin-CLI work view: running tool, inline permission, queued
    # guidance, done state, bypass tag, queued auto-send
    "work": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"what is the weather"),
        (0.3, b"\r"),             # submit; ~2.5s TTFT (work-*.png frames)
        (2.0, b"make it so"),     # guide text while working
        (0.3, b"\r"),             # -> queued row (work-queued.png)
        (4.0, b""),               # permission opens ~5.5s in (work-permission.png)
        (0.3, b"1"),              # digit -> Yes (allow once)
        (5.5, b""),               # turn ends; queued msg auto-sends (slow turn)
        (1.5, ESC),               # esc 1: 'press esc again to interrupt'
        (0.5, ESC),               # esc 2: cancel -> idle (work-done.png)
        (1.5, b""),
        (0.4, b"\x1b[Z"),         # shift+tab -> plan
        (0.4, b"\x1b[Z"),         # -> accept-edits
        (0.4, b"\x1b[Z"),         # -> bypass (work-bypass.png)
        (1.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # 80x24 work view
    "work80": [
        (6.0, b"\r"),
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),
        (5.0, b""),               # idle (work-80x24.png)
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # collapsible command blocks: permission -> done (collapsed) -> ctrl+o
    "cmd": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"what is the weather"),
        (0.3, b"\r"),
        (9.0, b"1"),              # permission -> Yes (cmd-permission.png)
        (5.5, b""),               # turn ends -> collapsed lines (cmd-collapsed.png)
        (0.4, b"\x0f"),           # ctrl+o -> expand (cmd-expanded.png)
        (1.5, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /handoff confirm block (needs DEVIN_API_KEY in env; Esc cancels —
    # never hits the API)
    "handoff": [
        (6.0, b"\r"),
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),
        (5.5, b"/handoff fix the flaky test"),
        (0.3, b"\r"),             # -> confirm block (handoff-confirm.png)
        (2.5, ESC),               # cancel without sending
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /handoff Enter-confirmed against $DEVIN_API_URL (local test server)
    "handoffsend": [
        (6.0, b"\r"),
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),
        (5.5, b"/handoff fix the flaky test"),
        (0.3, b"\r"),             # confirm block
        (2.0, b"\r"),             # confirm -> POST -> 'handed off ->' line
        (2.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /handoff without DEVIN_API_KEY -> system line (handoff-nokey.png)
    "handoffnokey": [
        (6.0, b"\r"),
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),
        (5.5, b"/handoff"),
        (0.3, b"\r"),
        (1.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # HOME-screen system lines: /status then /handoff add a README —
    # env-driven: no DEVIN_API_KEY -> PAT line; DEVIN_API_KEY=cog_* and
    # no DEVIN_ORG_ID -> the ORG_ID line. Any item switches home ->
    # session view (handoff-home.png)
    "homehandoff": [
        (6.0, b"\r"),
        (2.0, b""),               # home frame (no items)
        (0.6, b"/status"),
        (0.3, b"\r"),             # system line -> session view
        (1.5, b"/handoff add a README"),
        (0.3, b"\r"),             # env-dependent system line
        (2.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # git-branch display (DRIVE_CWD=<dir>): home corner + status bar
    # `⣿ <cwd> (<branch>)`; background `git checkout -b other` mid-run
    # (from the driver shell) so the bar refreshes after turn 2 ends.
    # branch-bar.png / branch-other.png
    "branchbar": [
        (6.0, b"\r"),
        (2.0, b""),               # home corner shows (<branch>)
        (0.6, b"hi"),
        (0.3, b"\r"),
        (7.0, b"1"),              # permission -> allow once
        (8.0, b""),               # turn 1 ends -> bar shows (<branch>)
        (1.0, b"again"),
        (0.3, b"\r"),
        (7.0, b"1"),              # permission 2
        (9.0, b""),               # turn 2 ends -> bar shows (other)
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # real-Devin payload shapes: permission (real-permission.png) ->
    # collapsed done lines (real-collapsed.png) -> ctrl+o expanded
    # (real-expanded.png)
    "real": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"check the workspace"),
        (0.3, b"\r"),
        (9.0, b"1"),              # permission -> 1 Allow (real-permission.png)
        (8.0, b""),               # turn ends -> collapsed lines
        (0.3, b"\x02"),           # ctrl+b -> hide plan, taller transcript
        (0.8, b""),               #   (real-collapsed.png — tail shows all)
        (0.4, b"\x0f"),           # ctrl+o -> expand
        (0.3, b"\x1b[1;2A"),      # shift+up x6 -> ls expanded .. npm exit
        (0.15, b"\x1b[1;2A"),     #   in one view (real-expanded.png)
        (0.15, b"\x1b[1;2A"),
        (0.15, b"\x1b[1;2A"),
        (0.15, b"\x1b[1;2A"),
        (0.15, b"\x1b[1;2A"),
        (0.8, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # 80x24: the long diff line must truncate, not wrap (diff-80x24.png)
    "real80": [
        (6.0, b"\r"),
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),
        (8.0, b""),               # idle; collapsed tail visible
        (0.3, b"\x1b[1;2A"),      # shift+up to bring the diff into view
        (0.15, b"\x1b[1;2A"),
        (0.15, b"\x1b[1;2A"),
        (0.15, b"\x1b[1;2A"),
        (0.8, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /help overlay: open (help.png) -> filter 'mod' (help-filter.png) -> esc
    "help": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/help"),
        (0.3, b"\r"),             # overlay open
        (2.5, b"mod"),            # filter rows by 'mod'
        (1.5, b"\r"),             # Enter -> inserts '/model ' into prompt
        (1.5, ESC),               # clear the prompt
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # 80x24: the overlay scrolls with up/down markers (help-80x24.png)
    "help80": [
        (6.0, b"\r"),
        (2.5, b"/help"),
        (0.3, b"\r"),
        (2.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # model picker open on the session screen at 80x24 (picker-80.png)
    "picker80": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),              # permission -> Allow
        (6.0, b"/model"),
        (0.3, b"\r"),             # picker open
        (2.0, b""),
        (0.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /fusion picker: open -> cycle sidekick -> apply
    "fusion": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/fusion"),
        (0.3, b"\r"),             # picker open (fusion-picker.png)
        (1.5, b"\x1b[C"),         # -> next sidekick (fusion-picker-sidekick.png)
        (1.5, b"\r"),             # apply -> set_config_option
        (2.5, b""),               # meta shows the Fusion pair (fusion-applied.png)
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # /resume picker on the session screen -> Enter loads the newest session
    "resume": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"hi"),
        (0.3, b"\r"),
        (9.0, b"1"),              # permission -> Allow
        (6.0, b"/resume"),
        (0.3, b"\r"),             # picker open (resume-picker.png)
        (2.5, b"\r"),             # load newest session
        (4.0, b""),               # replay lands (resume-loaded.png)
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # launched with -c: after auth the newest session for the cwd loads
    # automatically (continue-flag.png)
    "continue": [
        (6.0, b"\r"),             # needsAuth -> auth -> resume proceeds
        (7.0, b""),               # replay done -> session screen
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # launched with -r fake-session-middle: loads that id after auth
    "resumeid": [
        (6.0, b"\r"),
        (7.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # multiline composer: alt+enter + ctrl+j + a bracketed paste -> 4-line
    # input (multiline.png), then send (fake log proves intact newlines)
    "multiline": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"first line"),
        (0.3, b"\x1b\r"),         # alt+enter -> newline
        (0.3, b"second line"),
        (0.3, b"\n"),             # ctrl+j -> newline
        (0.3, b"\x1b[200~third pasted\nfourth pasted\x1b[201~"),  # paste
        (2.5, b""),               # snapshot: 4 input rows, grown frame
        (0.3, b"\r"),             # send
        (9.0, b"1"),              # permission -> Allow
        (6.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # @file mention dropdown: '@theme' filters -> Tab accepts -> @src/theme.ts
    "mention": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"check @theme"),
        (2.5, b""),               # dropdown open (mention-dropdown.png)
        (0.4, b"\t"),             # Tab -> '@src/theme.ts '
        (1.5, b""),               # chip row visible
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # chips: @file + a pasted image path, then send -> text,resource_link,image
    "attachments": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"look at @theme"),
        (1.5, b"\t"),             # accept -> @src/theme.ts chip
        (0.5, b" and this "),
        (0.5, b"\x1b[200~/tmp/devin-tui-test.png\x1b[201~"),  # image paste
        (2.0, b""),               # attachments.png: ⌗ + ▣ chips
        (0.3, b"\r"),             # send -> fake log: text,resource_link,image
        (9.0, b"1"),              # permission -> Allow
        (6.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # multiline at 80x24 (multiline-80.png)
    "multiline80": [
        (6.0, b"\r"),
        (2.5, b"line one"),
        (0.3, b"\x1b\r"),
        (0.3, b"line two"),
        (0.3, b"\n"),
        (0.3, b"line three"),
        (2.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # real Devin edit test in /tmp/devin-tui-edit-test (DRIVE_AGENT=real,
    # DRIVE_CWD=/tmp/devin-tui-edit-test): bypass via shift+tab, edit
    # prompt, wait for the turn (real-edit.png)
    "realedit": [
        (8.0, b""),               # straight in (persisted auth) or menu
        (2.0, b"\x1b[Z"),         # shift+tab x4 -> bypass
        (0.4, b"\x1b[Z"),
        (0.4, b"\x1b[Z"),
        (0.4, b"\x1b[Z"),
        (1.5, b"In hello.ts rename the function greet to greetUser, update its call site, and add a one-line comment above it. Don't run anything else."),
        (0.3, b"\r"),
        (75.0, b""),              # wait for the turn to finish
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # catalog pricing: /model + filter 'op' -> priced row (pricing-picker.png)
    # -> filter 'swe' -> FREE row (pricing-free.png) -> /fusion pair
    # pricing (pricing-fusion.png). Needs DEVIN_TUI_MODELS_FILE=fixture.
    "pricing": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/model"),
        (0.3, b"\r"),             # picker open
        (0.8, b"op"),             # filter -> Claude Opus 5 (priced, High)
        (2.5, b""),
        (0.3, b"\x7f"),           # clear filter
        (0.15, b"\x7f"),
        (0.5, b"swe"),            # -> SWE-2 (Free)
        (2.5, b""),
        (0.4, ESC),               # close picker
        (0.6, b"/fusion"),
        (0.3, b"\r"),             # fusion picker -> pair pricing
        (2.5, b""),
        (0.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # pricing at 80x24 — detail rows shed to fit (pricing-80.png)
    "pricing80": [
        (6.0, b"\r"),
        (2.5, b"/model"),
        (0.3, b"\r"),
        (0.8, b"op"),
        (2.5, b""),
        (0.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # effort bars: run with DEVIN_TUI_FAKE_EFFORTS=medium,high,max for a
    # 3-value thought_level (current max). Home picker: Max → ← High →
    # ← Medium → → High, then filter text 'sw' + ← proves arrows still
    # move effort; then /resume -> session screen, /model + ← there too.
    # PNGs: effort-max.png / effort-high.png / effort-medium.png
    "effort": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/model"),
        (0.3, b"\r"),             # picker opens (effort Max, 3/3 bars)
        (1.2, b""),               # effort-max frame
        (0.2, b"\x1b[D"),         # <- -> High (2/3)
        (1.0, b""),               # effort-high frame
        (0.2, b"\x1b[D"),         # <- -> Medium (1/3)
        (1.0, b""),               # effort-medium frame
        (0.2, b"\x1b[C"),         # -> -> High
        (0.6, b"sw"),             # filter text present
        (0.2, b"\x1b[D"),         # arrows still adjust effort -> Medium
        (0.8, b""),
        (0.5, ESC),               # close picker
        (0.6, b"/resume"),
        (0.3, b"\r"),             # session picker
        (1.0, b"\r"),             # load newest -> session screen
        (4.0, b""),               # replay finishes
        (0.6, b"/model"),
        (0.3, b"\r"),             # picker on the session screen
        (0.5, b"\x1b[D"),         # <- works here too
        (0.8, b""),
        (0.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # per-model reasoning levels (DEVIN_TUI_MODELS_FILE=fixture):
    # open -> per-row bars/names with different counts (levels-open.png)
    # -> filter 'opus' + -> XHigh on the Fable-like row (levels-xhigh.png)
    # -> Enter applies model=opus-5 THEN thought_level=xhigh (log order)
    # -> GPT-6 Sol row -> None (catalog has it, ACP list doesn't) ->
    #    Enter resolves nearest -> thought_level=low (levels-none.png)
    # -> Gemini 4 (Adaptive-like) row has no control (levels-adaptive.png)
    # -> Enter sends model only, no thought_level
    "levels": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/model"),
        (0.3, b"\r"),             # picker open, sel = SWE-2 (current)
        (1.5, b""),               # levels-open frame
        (0.5, b"opus"),           # filter -> Claude Opus 5 first
        (0.6, b"\x1b[C"),         # -> XHigh (4/5 bars)
        (1.0, b""),               # levels-xhigh frame
        (0.3, b"\r"),             # apply: model=opus-5, thought_level=xhigh
        (2.0, b""),
        (0.5, b"/model"),
        (0.3, b"\r"),             # reopen (current = Claude Opus 5)
        (0.5, b"sol"),            # filter -> GPT-6 Sol first
        (0.4, b"\x1b[D"),         # Medium -> Low
        (0.2, b"\x1b[D"),         # Low -> None
        (0.8, b""),               # levels-none frame
        (0.3, b"\r"),             # apply: model=gpt-6-sol, nearest -> low
        (2.0, b""),
        (0.5, b"/model"),
        (0.3, b"\r"),
        (0.5, b"gemini"),         # Adaptive-like row — no control
        (0.8, b""),               # levels-adaptive frame
        (0.3, b"\r"),             # apply: model=gemini-4, no thought_level
        (2.0, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # per-row levels at 80x24 — list/detail shedding keeps everything in
    # bounds with the composer intact (levels-80.png)
    "levels80": [
        (6.0, b"\r"),
        (2.5, b"/model"),
        (0.3, b"\r"),
        (2.5, b""),               # levels-80 frame
        (0.5, ESC),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # README screenshot: a completed turn (tool calls + diff + permission),
    # idle status bar — run with DRIVE_CWD=/tmp/demo-project so no personal
    # paths appear (docs/screenshot.png)
    "shot": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"clean up index.js"),
        (0.3, b"\r"),
        (9.0, b"1"),              # permission -> Yes
        (9.0, b""),               # turn finishes -> idle frame
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # update notice: DEVIN_TUI_FORCE_UPDATE_CHECK=1 + DEVIN_TUI_UPDATE_URL
    # -> a local server serving {"version":"0.3.0"}; home corner +
    # session status bar show the notice (update-home.png/update-bar.png)
    "update": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (3.0, b""),               # home corner: update notice
        (0.5, b"hi"),
        (0.3, b"\r"),             # prompt -> session view
        (9.0, b"1"),              # permission -> Yes
        (7.0, b""),               # idle: status bar notice
        (0.5, b"/status"),
        (0.3, b"\r"),             # /status line w/ update
        (1.5, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # spend tracking: /model -> Claude Opus 5 (High cost tier) -> one turn
    # -> status bar shows the priced spend seg before Context; /status
    # prints the spend line (+extra dims line when FAKE_EXTRA_DIMS=1)
    "spend": [
        (6.0, b"\r"),             # needsAuth -> auth -> ready
        (2.5, b"/model"),
        (0.3, b"\r"),             # picker open
        (0.5, b"opus"),           # filter -> Claude Opus 5
        (0.3, b"\r"),             # apply model=opus-5 + effort
        (2.0, b""),
        (0.5, b"hi"),
        (0.3, b"\r"),             # prompt -> session view
        (9.0, b"1"),              # permission -> Yes
        (7.0, b""),               # turn_stats arrived -> spend seg
        (0.5, b"/status"),
        (0.3, b"\r"),             # spend line in /status
        (1.5, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # -c resume: the load replays turn_stats for both prior turns -> the
    # spend seg + /status reflect the resumed session's totals
    "spendresume": [
        (6.0, b"\r"),             # needsAuth -> auth -> resume proceeds
        (7.0, b""),               # replay done -> spend in the bar
        (0.5, b"/status"),
        (0.3, b"\r"),
        (1.5, b""),
        (0.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
    # no-truecolor run ending on the model picker (inverse + ANSI fallback)
    "fallback": [
        (6.0, b"\r"),             # needsAuth menu -> auth
        (2.5, b"/model"),
        (0.3, b"\r"),             # picker open
        (1.5, b"\x03"),
        (0.4, b"\x03"),
        (1.0, b""),
    ],
}


# extra CLI args per scenario (e.g. -c for --continue)
SCENARIO_ARGS = {
    "continue": ["-c"],
    "spendresume": ["-c"],
    "resumeid": ["-r", "fake-session-middle"],
}


def main() -> int:
    cols, rows, rawfile, scenario = (
        int(sys.argv[1]),
        int(sys.argv[2]),
        sys.argv[3],
        sys.argv[4],
    )
    events = SCENARIOS[scenario]

    # DRIVE_AGENT=real -> default `devin acp`; DRIVE_CWD -> --cwd <dir>
    agent = os.environ.get("DRIVE_AGENT", "npx tsx test/fake-agent.ts")
    argv = ["npx", "tsx", "src/index.tsx"]
    if agent != "real":
        argv += ["--agent", agent]
    if os.environ.get("DRIVE_CWD"):
        argv += ["--cwd", os.environ["DRIVE_CWD"]]
    argv += SCENARIO_ARGS.get(scenario, [])

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        os.execvp("npx", argv)
        os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    out = open(rawfile, "wb")
    deadline = time.time() + 90
    alive = True
    for delay, keys in events:
        end = time.time() + delay
        while time.time() < end and alive:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    alive = False
                    break
                if not data:
                    alive = False
                    break
                out.write(data)
        if not alive:
            break
        if keys:
            try:
                os.write(fd, keys)
            except OSError:
                alive = False
                break
    # drain until child exits or deadline
    while alive and time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            out.write(data)
        else:
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                # child gone; drain remaining
                try:
                    while True:
                        data = os.read(fd, 65536)
                        if not data:
                            break
                        out.write(data)
                except OSError:
                    pass
                break
    out.close()
    try:
        os.kill(pid, 15)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass
    return 0


sys.exit(main())

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


def main() -> int:
    cols, rows, rawfile, scenario = (
        int(sys.argv[1]),
        int(sys.argv[2]),
        sys.argv[3],
        sys.argv[4],
    )
    events = SCENARIOS[scenario]

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        os.execvp(
            "npx",
            ["npx", "tsx", "src/index.tsx", "--agent", "npx tsx test/fake-agent.ts"],
        )
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

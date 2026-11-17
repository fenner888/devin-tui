# Findings — synthetic mock ACP assessment

Reference: toolbox `security-baseline/7-ai.md` (2026 labels). All repros use
`npm run eval`; see timestamped runs for observed bytes and assertions.

## Current status: E01–E06 Fixed

E04 lifecycle regression: when turn completion or session reset removes the
permission from reducer state, App now cancels and clears its pending resolver.
`permission-turn-end-lifecycle` lets a request remain pending through end_turn,
then verifies the following turn renders a fresh permission, waits for input,
and resolves only after Escape selects rejection.

All six findings are fixed by commit `4d03f48` on the stacked fixes branch.
The table records baseline status; post-fix run
`2026-11-17T20-21-16-619Z` passes 21/21 cases against that source tree.
That run's HEAD field predates the fix commit because the source was tested
before committing; its working-tree caveat is explicit in EVIDENCE.md.
Typecheck passes and all 44 unit tests pass. The blueprint PTY smoke and PNG
render completed; `/home/ubuntu/permission-eval.png` visually shows kind-first
permissions and the bypass warning. `/tmp/shot.png` shows the sign-in smoke.

E01/E02: shared C0/C1 replacement at Line and title sinks, validated links.
E03: authoritative option kinds precede labels. E04: concurrent requests are
cancelled while preserving the first resolver. E05: owner-only directory,
log and debug capture permissions. E06: realpath containment for mentions.
The no-auto-approval assertion was corrected to allow automatic *cancellation*
of excess requests, while still forbidding selection before a keypress.

| ID | Severity | Finding / repro | Status | OWASP LLM 2026 | AI RMF | AI 600-1 risk | SP 800-218A |
|---|---|---|---|---|---|---|---|
| E01 | High | Agent session title can terminate OSC 0 and emit OSC 52 clipboard control; `terminal-title-injection` | Open | LLM10:2026 output handling; LLM01:2026 prompt injection | MEASURE 2.7; MANAGE 1.3 | Information Security | PW.1; PW.8; RV.1 |
| E02 | Medium | BEL survives text rendering and can ring terminal; `terminal-text-bell` | Open | LLM10:2026 output handling | MEASURE 2.7; MANAGE 1.3 | Information Security | PW.7; PW.8 |
| E03 | Medium | Permission labels omit authoritative option kind, so reject option named Allow is misleading; `permission-kind-fidelity` | Open | LLM01:2026 prompt injection; LLM03:2026 agency/tool scope | MEASURE 2.7; MANAGE 1.3 | Human-AI Configuration; Information Security | PW.1; PW.8 |
| E04 | Medium | A second permission overwrites the first resolver, leaving the first unanswered; `permission-overlap-settled` | Open | LLM03:2026 agency/tool scope; LLM10:2026 output handling | MEASURE 2.7; MANAGE 1.3 | Information Security | PW.7; PW.8; RV.1 |
| E05 | Medium | Agent stderr log created with world/group-readable default permissions under common umask; `log-private` | Open | LLM02:2026 disclosure; LLM08:2026 hidden context | MAP 4.3; MANAGE 1.3 | Data Privacy; Information Security | PW.1; PW.8 |
| E06 | Medium | Lexical mention scope permits symlink escaping cwd; `mention-symlink` (resource URI, not direct client file read) | Open | LLM02:2026 disclosure; LLM03:2026 agency/tool scope | MAP 4.3; MANAGE 1.3 | Data Privacy; Information Security | PW.1; PW.8 |

## Controls observed / limitations

No permission is approved before input in the mock run. Escape selects the
reject-once option (a `selected` outcome is not necessarily an approval).
Agent-driven bypass is prominently labeled; it is not a grant of client tools.
Filesystem read/write and terminal capabilities are disabled. Extension,
metadata and stderr canaries do not reach the terminal, and protocol captures
are absent with debug disabled. Handoff includes explicitly supplied diff and
context by design; the client does not classify sensitive content. Truncation
is hard truncation without an ellipsis (observed quality limitation, not a
new security defect). See README for coverage boundaries.

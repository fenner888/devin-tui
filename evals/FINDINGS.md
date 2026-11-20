# Findings — synthetic mock ACP assessment

Reference: toolbox `security-baseline/7-ai.md` (2026 labels). All repros use
`npm run eval`; see timestamped runs for observed bytes and assertions.

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

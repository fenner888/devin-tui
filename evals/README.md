# Mock ACP security and rendering evals

Run `npm run eval` (Node >=22, Python 3, installed project dependencies).
The command exits nonzero on a failed assertion and writes timestamped JSON,
escaped Markdown evidence, synthetic mock events and actual PTY bytes under
`evals/runs/`. Run from the repository root. No login, real Devin, cloud API,
production/user/VA data or network is used. Environment variables, HOME,
config and temporary logs are isolated; fixtures contain only named canaries.
Do not replace these fixtures with real transcripts or credentials.

The SDK hostile agent exercises the real App through a PTY, including concurrent
permissions, mismatched labels/kinds, mode changes, hidden metadata, stderr,
streamed text and OSC 52 title injection. Renderer checks separately exercise
CSI/OSC/C1/BEL and hostile links. Local filesystem checks use synthetic traversal
and symlink targets. Other checks cover capability advertisement, markdown,
wide characters, long wrapping, empty output, hard truncation and handoff payloads.

Scope: these are deterministic client-boundary checks, not model jailbreak or
accuracy certification. The mock cannot attest to a real agent's bypass policy.
Mode updates are agent-reported state, not client-side filesystem authorization;
the client advertises no filesystem or terminal tools. Handoff intentionally
includes diff/context after confirmation; review for secrets before confirming.
Authentication capture exclusion and debug-on captures are code-reviewed but not
dynamically covered here. No guarantee is made about arbitrary malformed ACP,
OS-level clipboard integrations, every tool/plan variant, or screenshot quality.
PTY controls are checked by attacker-specific signatures, not by banning all
ESC bytes (the legitimate UI necessarily emits terminal controls).

Mappings in FINDINGS.md follow `fenner888/toolbox/security-baseline/7-ai.md`'s
2026 taxonomy, not the differently numbered OWASP 2025 taxonomy. NIST mappings
are engineering crosswalks, not compliance certification. MCP is not deployed
by this harness; CIS MCP benchmark is not applicable.

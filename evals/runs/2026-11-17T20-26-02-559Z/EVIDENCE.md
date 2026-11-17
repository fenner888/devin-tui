# Mock ACP eval evidence

UTC: 2026-11-17T20-26-02-559Z
Commit under test (working tree may include suite/fixes): ee5f7af9ec0010b5d41df878e2ab2007e83981f6
Environment: {"node":"v24.21.0","os":"linux 6.8.0-1060-aws"}
Command: `npm run eval`

Only synthetic fixtures; no production, VA, real agent, network or credentials. PTY and JSONL artifacts are synthetic. Controls below report observed behavior, not model safety guarantees.

## PASS permission-turn-end-lifecycle

```json
"[{\"capabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false,\"auth\":{\"terminal\":false}}},{\"lifecyclePrompt\":1},{\"lifecycleTurnEnded\":true},{\"lifecyclePermission\":1,\"outcome\":{\"outcome\":\"cancelled\"}},{\"lifecyclePrompt\":2},{\"lifecycleWaiting\":true},{\"lifecyclePermission\":2,\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}]"
```

## PASS harness-reachable

```json
"{\"capabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false,\"auth\":{\"terminal\":false}}}\n{\"prompt\":true}\n{\"permission\":\"second\",\"outcome\":{\"outcome\":\"cancelled\"}}\n{\"waiting\":true}\n{\"permission\":\"first\",\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}\n"
```

## PASS terminal-title-injection

```json
"no attacker clipboard sequence in PTY"
```

## PASS terminal-text-osc52

```json
"\"before ]52;c;RVZBTA== after\""
```

## PASS terminal-text-csi

```json
"\"before [2Jafter\""
```

## PASS terminal-text-c1

```json
"\"before 2Jafter\""
```

## PASS terminal-text-bell

```json
"\"before after\""
```

## PASS terminal-link-injection

```json
"\"link\""
```

## PASS permission-kind-fidelity

```json
"\" ❯ 1 [reject_once] Allow spoof [2Jxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx↑↓ select · ↵ confirm · esc cancel                                              \""
```

## PASS permission-no-auto-approval

```json
"[{\"permission\":\"second\",\"outcome\":{\"outcome\":\"cancelled\"}},{\"permission\":\"first\",\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}]"
```

## PASS permission-overlap-settled

```json
"[{\"permission\":\"second\",\"outcome\":{\"outcome\":\"cancelled\"}},{\"permission\":\"first\",\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}]"
```

## PASS bypass-visible

```json
"agent-driven mode change visibly labeled in actual PTY (not a local authorization grant)"
```

## PASS hidden-context

```json
"extension, metadata and stderr canaries absent from PTY"
```

## PASS debug-off

```json
"[\"devin-acp.log\"]"
```

## PASS log-private

```json
"600"
```

## PASS least-agency

```json
"{\"capabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false,\"auth\":{\"terminal\":false}}}"
```

## PASS mention-traversal

```json
"assertions satisfied"
```

## PASS mention-symlink

```json
"assertions satisfied"
```

## PASS handoff-explicit-content

```json
"handoff deliberately includes supplied context and diff; user confirmation remains required"
```

## PASS quality-markdown-wrap

```json
"11 rows bounded to 40 cells"
```

## PASS quality-empty

```json
"assertions satisfied"
```

## PASS quality-truncation

```json
"hard truncation without marker: xxxxxxxxxxxxxxxxxxxx"
```

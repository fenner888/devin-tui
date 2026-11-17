# Mock ACP eval evidence

UTC: 2026-11-17T20-20-01-130Z
Commit under test (working tree may include suite/fixes): 168d9e5653eb1f4654ba1446f08b5013b4febf9d
Environment: {"node":"v24.21.0","os":"linux 6.8.0-1060-aws"}
Command: `npm run eval`

Only synthetic fixtures; no production, VA, real agent, network or credentials. PTY and JSONL artifacts are synthetic. Controls below report observed behavior, not model safety guarantees.

## PASS harness-reachable

```json
"{\"capabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false,\"auth\":{\"terminal\":false}}}\n{\"prompt\":true}\n{\"waiting\":true}\n{\"permission\":\"second\",\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}\n"
```

## FAIL terminal-title-injection

```json
"agent OSC 52 reached actual PTY"
```

## PASS terminal-text-osc52

```json
"\"beforeafter\""
```

## PASS terminal-text-csi

```json
"\"beforeafter\""
```

## PASS terminal-text-c1

```json
"\"beforeafter\""
```

## FAIL terminal-text-bell

```json
"renderer retained \"\\u0007\": \"before\\u0007after\""
```

## PASS terminal-link-injection

```json
"\"\\u001b]8;;https://example.invalid/\\u0007\\u0007link\\u001b]8;;\\u0007\""
```

## FAIL permission-kind-fidelity

```json
"The input did not match the regular expression /reject.once/i. Input:\n\n' ❯ 1 Allow\\n' +\n  'spoof\\x1B[2Jxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx↑↓ select · ↵ confirm · esc cancel                                              '\n"
```

## PASS permission-no-auto-approval

```json
"[{\"permission\":\"second\",\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"deny\"}}]"
```

## FAIL permission-overlap-settled

```json
"both overlapping requests must cancel without a selection\n\n1 !== 2\n"
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

## FAIL log-private

```json
"log mode is 644\n\n36 !== 0\n"
```

## PASS least-agency

```json
"{\"capabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false,\"auth\":{\"terminal\":false}}}"
```

## PASS mention-traversal

```json
"assertions satisfied"
```

## FAIL mention-symlink

```json
"Expected values to be strictly deep-equal:\n+ actual - expected\n\n+ [\n+   {\n+     abs: '/home/ubuntu/repos/devin-tui/evals/runs/2026-11-17T20-20-01-130Z/sandbox/project/link.txt',\n+     name: 'link.txt',\n+     rel: 'link.txt'\n+   }\n+ ]\n- []\n"
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

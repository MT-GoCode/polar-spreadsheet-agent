# The mog binary — pin this

Binary in use: sha256 `a5a3269871187fc9` (first 16). `out/controls.json` is TRACKED IN GIT
and records this sha; `e2e/verdict.py` REFUSES to run against a control measured with a
different binary -- the noise floor is binary-specific, and a floor measured on a noisier
build silently forgives real agent damage when reused with a cleaner one. Because the
control is tracked, a fresh clone grades immediately; it does not need to re-measure.

Validated on this binary from a clean clone: 30/30 unit tests, controls measured with every
golden scoring 100%, and 15/15 known-correct solutions passing `npm run e2e`. Roughly 10%
faster than the previous build on the formula-heavy workbooks (task_03 158s -> 148s,
task_04 69s -> 60s); identical map output.

Built on mac-work, includes a second agent's cycle-detection optimisation (task_04's 19,024
formula writes each triggered a whole-graph cycle scan). That change is sound by shape: the
fast path only PROVES a negative (`certify_acyclic_edit`), anything inconclusive falls
through to the original `would_create_cycle` unmodified, the preflight is bounded to
`min(graph_size/8, 32_768)`, and it ships an adversarial test for the case it could break
(an intermediate in-batch cycle that a later edit resolves). Parity patches verified intact
on it: CF `type="expression"` + dxf, and no `val="0"` for strike/b/i.

Upstream: `fundamental-research-labs/mog`
Commit:   3abffd7 Support XLSX exports on filesystems without rename (#400)
Patch:    `~/code/mog-appsscript-parity.patch` (on each Mac, and `git diff` in the checkout)
Built:    2026-09-24 — arm64, on mac-work, `cargo build -p mog --release --locked`
Source:   `~/code/mog/target-native/release/mog` on mac-work (~34 MB)
Install:  copy that file to `gas-offline/.mog/bin/mog` on each machine. Do NOT rebuild --
          a rebuild produces a different sha and invalidates the tracked control.

**There is no mog on the VM.** All bench runs happen on a Mac.

## The patch — two, and one build fix

Reapply with `git apply ~/code/mog-appsscript-parity.patch` on a fresh clone.

### Build fix (required, or upstream will not compile on macOS)
`compute/officejs/src/fatal_signal.rs` calls `libc::__errno_location()`, which is
glibc-only. Replaced with `std::io::Error::last_os_error().raw_os_error()`. Without this,
`cargo build` fails with E0425 on any Mac. This is a recent upstream regression — older
commits (e.g. `fa48399`) build fine.

### Patch 1 — conditional formatting, FOUR halves. Ship all four or none.
The engine and the xlsx writer already supported expression rules; only the Office.js
entry point was missing.

| half | file | effect |
|---|---|---|
| 1a | `conditional.rs` `default_rule` | `"Custom"` → `{"type":"expression"}` — rule serializes as `<cfRule type="expression">` |
| 1b | `conditional.rs` `apply_property` | `custom.format.*` → the rule carries a **dxf** |
| 1c | `conditional.js` | `"custom"` in the accessor list — write path reachable |
| 1d | `conditional.rs` `load()` | exposes `formula`/`value1`/`value2`/`text`/`operator` — read-back |

**1a without 1b is the trap**: the rule exists but has no style, and task_14's
`binary_toggle` reads the dxf font colour. A binary with only 1a silently fails task_14.

**1d must pass values through raw (`.clone()`), not `.as_str().unwrap_or("")`.** The shim
decides "is this a formula rule?" by `formula != null` (`shim/42-sheet-rest.js:21`), so an
empty string misclassifies every CellValue rule as `CUSTOM_FORMULA`. And `value2` must be
present: the shim loads it, and an unknown property makes mog's whole `load` throw, which
the shim catches per-rule — silently dropping every rule.

### Patch 2 — drop explicit `val="0"` for `strike`, `b`, `i`
`file-io/xlsx/parser/src/domain/styles/write/fonts.rs`. Google never writes these; mog did,
producing **219 false preservation violations** on cells the agent merely touched.

## Do NOT reapply
- **Arithmetic empty-string→0** (`operators.rs`) — destabilized task_15's chart
  serialization. The divergence stays documented as a known false red.
- **bgColor on solid fills** (`fills.rs`) — unnecessary; the online grader's
  `reconcile()` discards those violations.

## Verified on this build
```
CF custom:    count=1  criteria=CUSTOM_FORMULA  args=["=$A1>3"]
CF cellValue: count=1  criteria=NUMBER_GREATER_THAN  args=[3]
xml:          <cfRule type="expression" priority="1" dxfId="0"><formula>=$A1&gt;3
              <dxfs count="1"><dxf><font><color rgb="FF000000"/></font></dxf></dxfs>
val="0" on strike/b/i:  none
```

## Known gaps, not patched
- `load()` reports `type: "PresetCriteria"` for an expression rule — the engine's serde
  name does not match the match arms. Harmless: the shim keys off `formula`, not `type`.
  Pre-existing upstream, not introduced by the patch.
- Read-back does not expose the rule's **style**, so `getFontColor()` on a rule read from
  the file returns null. The write path is correct and that is what the grader reads.
  Only bites if an agent reads a rule, edits it, and writes it back.

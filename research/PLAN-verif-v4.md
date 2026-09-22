# Verification layer — empirically-grounded minimal redesign (v4)

Grounded in a cell-by-cell probe of ALL 16 non-perfect seeds in `offline-runs/`
(work.xlsx = pristine, submission.xlsx = model output, grade.json = golden diff,
response.json = declared plan/assertions).

## What the failure data actually says

Mechanical categorization of every failed cell (blank vs anchored-formula vs hardcode-literal):

| bucket | meaning | seeds | deterministically catchable? |
|---|---|---|---|
| FORMULA | anchored formula, wrong math | t05,t08,t12,t13,t15 (+parts of t10) — the majority | **NO** (anchored-but-wrong = self-consistency can't catch, per tearsheet) |
| BLANK | output cell left empty | t04 s2 (116), t10 s3 (11), blank parts of t10 s1/s2, t12 | **YES** |
| LITERAL | fabricated hardcode, self-asserted | **ZERO across all 16 seeds** | n/a |

### Consequences
1. **Zero LITERAL failures** → the provenance/anchor-walk gate, `equals_ref` cross-tie
   primitive, boolean-formula assertion DSL, and scratch-eval mechanism would catch
   **none** of our failures. DROP them. (A wrong mental model also self-confirms any
   cross-tie it writes, so "force an independent assertion" is empirically empty here.)
2. **FORMULA failures dominate and are semantic** (wrong source row, ambiguous metric,
   missing bridge term, wrong driver). No verification language catches an anchored-but-
   wrong value. These are adversary + prompt + reasoning problems, NOT verification.
3. **BLANK failures are the one deterministically-addressable class.**
4. t04 s2 proof: the 116 blanks are row 56, a real output row. The map's blank-block scan
   MISSED it (anchor hardcode in D56/E56 split the region) and the adversary reinforced
   "keep 56 blank." So coverage keyed on model targets OR the map misses it. The only
   robust signal: row 56 is a blank row sandwiched inside a fully-filled rectangle.

## The plan

### The one real deterministic win — Omitted-cell-in-region check
- Reconstruct rectangular data regions from **fill structure** (contiguous rows/cols with
  shared structure), independent of the model's declared targets AND of the map's
  blank-block heuristic (both proven unreliable).
- Flag an **interior sandwiched blank**: a blank cell whose same-column neighbors above
  AND below are filled, or same-row neighbors left AND right are filled, within a region.
- Anomaly-aware to spare legitimate staggered/triangular blanks (e.g. D&A depreciation
  waterfall E12:E21, which the model correctly asserts blank): a staircase blank is filled
  on only ONE side → not sandwiched → not flagged.
- Catches t04 s2 (row 56), t10 s3 (col C), blank parts of t10 s1/s2.
- On flag → FAIL → replan. Target-independent, so the model can't dodge by excluding the
  region from its targets.
- Subsumes V2b holes (generalizes it beyond declared targets).

### Keep (cheap, orthogonal, already present)
V1 footprint, V2 kinds, V5/V5b errors (global scan), V6 structure.

### Add (cheap insurance, few lines, no recalc, no deps)
- **Volatile-function ban (transitive)**: NOW/TODAY/RAND/RANDBETWEEN/RANDARRAY/OFFSET/
  INDIRECT/INFO/CELL — nondeterminism breaks exact-value grading. Static scan of written
  formulas + propagate to dependents.
- **Evaluated-type uniformity within a region**: a formula cell evaluating to ""/text where
  its region-mates are numeric → 0-vs-blank convention outlier. Catches t10 s2 diagonal
  (`=IF(..,"","")` → "" where 0 expected).

### Explicitly DROP / do not build
- Provenance/anchor-walk gate (0 failures).
- `equals_ref` primitive, boolean-formula assertion DSL, scratch-eval, "independent
  assertion hard gate" (0 anchored-wrong failures caught; pure complexity).
- HyperFormula / fast-formula-parser / ExceLint-engine dependencies — the two heuristics
  above run over grids we already read; no new engine needed.

### Honest contract
The verification layer proves STRUCTURE + COVERAGE + DETERMINISM — not semantic
correctness. Self-confirming `equals`-own-output must stop being treated as a correctness
proof (it inflates the model's confidence to submit); semantic correctness is owned by the
adversary + prompt + reasoning.

### Complexity scaling
Both new checks are O(cells) over data already read at verify time; no recalc, no deps.
Trivial task → few regions → near-zero work.

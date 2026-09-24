# Blind independent-checker pilot — do not promote

## Decision

Keep this experimental checker outside the production harness. It found four correct discrepancies across three failed submissions, but also produced three false contradictions across two passing controls. There is no demonstrated repair or benchmark score gain. No production code, graders, goldens, or task prompts were changed for this pilot.

## Design

Six fresh GPT-5.4 medium checker runs used the original workbook, its task text and map, and automatically selected changed-cell locations. They could read original cells through existing read-only tools and propose up to twelve formula witnesses. They did not receive the writer's formulas, values, rationale, transcript, or grader answers. Changed-cell locations were derived from the submitted workbook, so this is independent derivation with candidate-location guidance, not a completely candidate-blind sample.

Each sealed check set was evaluated against one previously failed submission and one previously passing control. Evaluation used disposable Mog sessions on mac-personal, native formula calculation, dependency checks, and verified restoration. Graders were consulted only after the checks were sealed, to assess detections. Candidate files remained unchanged. The source harness was frozen at 1515d70cb0ad95fb0334c3dc8dc29f5dd6a98276; blanket per-turn reminders were absent.

## Results

Counts are matches / mismatches / untrusted checks. A match is agreement with the checker hypothesis, not proof of correctness. An untrusted check contributes no verdict.

| Task | Failed submission | Passing control | Interpretation |
|---|---:|---:|---|
| 01 | 8 / 2 / 2 | 10 / 0 / 2 | Correctly detected debt and equity rollforward errors. |
| 07 | 9 / 1 / 2 | 4 / 0 / 8 | Correctly detected the wrong first interpolation value; passing-control coverage is limited. |
| 08 | 10 / 0 / 2 | 8 / 2 / 2 | Accepted the wrong source and contradicted two correct control values. |
| 10 | 6 / 1 / 5 | 7 / 0 / 5 | Correctly detected one positive addition that should be negative. |
| 13 | 7 / 0 / 4 | 6 / 1 / 4 | Accepted the wrong discount sign and contradicted the correct control sign. |
| 14 | 5 / 0 / 7 | 5 / 0 / 7 | Relevant valuation-ratio checks were untrusted; no demonstrated detection. |

All six derivations sealed. All twelve evaluations completed without runner errors and reported restoration success. Derivation cost: **$3.0137**. No repair attempts or full sweep were run as part of this pilot.

### Useful discrepancies

- Task 01, `Model-Build!H124`: 30.3256742893 → checker 32.8403742893, agreeing with the grader.
- Task 01, `Model-Build!H130`: 26.88705532140419 → checker 24.37235532140419, agreeing with the grader.
- Task 07, `Meta Drivers!G19`: 0.02124355096957837 → checker 0.014, agreeing with the grader.
- Task 10, `D&A Schedule!C12`: +435.11693511534565 → checker −435.11693511534565, agreeing with the grader.

These are sampled witnesses, not complete family repairs. Changing signs or source inputs requires checking dependent calculations; repairing these cells alone has not been shown to produce a pass.

### False contradictions

- Task 08, `Metric Matrix!V9`: passing 933.87570427138; checker 917.9590307383729. The checker selected offer price instead of last trading price.
- Task 08, `Metric Matrix!D14`: passing 0.1024390858335308; checker 0.10823109578102216. Its denominator reused the same wrong source definition.
- Task 13, `Valuation Output!I7`: passing +0.2821910000000001; checker −0.2821910000000001. The fresh context repeated the writer's sign mistake.

### Coverage and evaluator limits

The evaluator rejects direct or transitive self-dependency, unresolved references, cycles, excessive dependency depth, unsupported dynamic/volatile formulas, and nonnumeric results. Some existing workbook dependency paths triggered these limits. Task 14's relevant failed ratios were therefore not numerically adjudicated. Four task 13 checks contained malformed quoted range syntax and produced formula errors; they were not repaired after seeing the outcomes. Differences in candidate formulas also caused differing trusted coverage between failed and passing submissions.

This is a selected six-pair diagnostic pilot, not a random benchmark sample. It cannot estimate total score uplift or regression rates.

## Possible separate experiment

A narrower checker could restrict enforcement to explicit task requirements: literal values/text, explicitly required signs, specified interpolation endpoints/timing, and formula-versus-literal requirements. Each assertion would need an exact task quotation plus inspected target/header mapping. Inferred financial definitions and source selection would remain advisory. This policy must be defined independently of these grader outcomes and tested on failed and passing controls before promotion. It has not been implemented or shown to improve the score.

Do not select only the grader-approved witnesses from this pilot and ship them as a general checker. In particular, the task 01 rollforward involves inferred modeling choices beyond a simple explicit-sign rule.

## Artifacts and reproduction

- `results/comparison.json`: all twelve evaluated results and post-sealing grader comparisons.
- `results/cases-private.json`: evaluation-only failed/passing run mapping.
- `results/case_NNN.json`: original-workbook derivation specifications.
- `results/case_NNN/`: exact source snapshot, model inputs, events, sealed checks, manifests, and both evaluations.
- `prototype/IndependentCheck.gs`: experimental shared-language derivation kernel.
- `prototype/IndependentWitness.gs`: experimental native-formula evaluator.
- `prototype/test-independent-check.mjs`: nineteen mock checks passed on mac-personal during the pilot.
- `prototype/test-witnesses.mjs`: twenty native Mog checks passed on mac-personal during the pilot.
- `prototype/*.mjs` / `*.py`: development-only preparation, launch, and comparison drivers.
- `SHA256SUMS`: content hashes for this archive, excluding this digest file.

Drivers retain the original absolute Mac paths and temporary prototype location; these document the executed experiment, not a portable production command. Original and candidate XLSX files remain in the existing frozen sweep/run archives identified by the specifications. Restoring those paths (or adjusting a copied driver) is required to reproduce. Launching derivation makes paid API calls; comparison uses already sealed checks and makes no model calls. Do not run Mog, builds, or benchmarks on the Linux host. Temporary session directories and the stale launch PID are excluded. No credentials are included.

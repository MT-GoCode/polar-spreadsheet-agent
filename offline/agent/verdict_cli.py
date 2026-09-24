#!/usr/bin/env python3
"""grade.json -> {pass, failures, discounted}. Thin CLI over e2e.verdict.classify."""
import sys, json, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT.parent))
from e2e.verdict import classify

grade, task, submission = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
wrote = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
initial = sys.argv[5] if len(sys.argv) > 5 else None
failures, discounted = classify(json.loads(grade.read_text()), task,
                                wrote_sheets=wrote, submission=submission, initial=initial)
print(json.dumps({"pass": not failures, "failures": failures, "discounted": discounted}))

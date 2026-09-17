"""Grade native Sheets exports against native preservation baselines and original answers."""
import argparse
import json
from pathlib import Path
import hashlib
from .workbook import load_workbook, get_cell, expand
from .scoring import grade, values_match


def load_spec(tid):
    root = Path(__file__).resolve().parents[1] / 'benchmarks'
    spec = json.loads((root / 'grading_specs' / f'{tid}.json').read_text())
    if spec['schema_version'] != 1 or spec['task_id'] != tid:
        raise ValueError('Invalid grading specification')
    source = root / 'tasks' / tid
    for name, expected in spec['sources'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'{tid}/{name} does not match the assessment specification')
    return spec, source


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--task', required=True)
    p.add_argument('--initial', required=True)
    p.add_argument('--golden', required=True)
    p.add_argument('--submission', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--execution', help='Worker result JSON proving remote completion and stable value observations')
    p.add_argument('--native-initial')
    p.add_argument('--native-final')
    args = p.parse_args()
    spec, source = load_spec(args.task)
    initial = load_workbook(args.initial)
    native_golden = load_workbook(args.golden)
    original_golden = load_workbook(source / 'golden.xlsx')
    actual = load_workbook(args.submission)
    execution = json.loads(Path(args.execution).read_text()) if args.execution else None
    trusted = bool(execution and execution.get('engine') == 'google-apps-script'
                   and execution.get('status') == 'completed' and execution.get('taskId') == args.task
                   and execution.get('calculation', {}).get('stableSamples', 0) >= 3)
    if args.execution and not trusted:
        raise ValueError('Worker result does not establish completed Google execution and stable calculations')
    if trusted and execution.get('outputValues') is not None:
        for book, key in [(initial, 'initialValues'), (native_golden, 'goldenValues'), (actual, 'outputValues')]:
            observed = execution.get(key, {})
            for sheet, address in expand(spec['outputs']):
                if address not in observed.get(sheet, {}):
                    raise ValueError(f'Missing native value observation for {sheet}!{address}')
                cell = book['sheets'][sheet]['cells'].setdefault(address, {'formula': None, 'error': None})
                cell['value'] = observed[sheet][address]
                formulas = execution.get(key.replace('Values', 'Formulas'))
                if formulas is not None:
                    if address not in formulas.get(sheet, {}):
                        raise ValueError(f'Missing native formula observation for {sheet}!{address}')
                    cell['formula'] = formulas[sheet][address]
                # Excel exports can classify a Sheets error as a cached text value.
                # Actual errors are separately detected by mismatch against the golden value.
                if cell.get('error') and cell['value'] != cell['error']:
                    cell['error'] = None
    conversion = []
    for sheet, address in sorted(expand(spec['outputs'])):
        expected, imported = get_cell(original_golden, sheet, address), get_cell(native_golden, sheet, address)
        if imported.get('error') != expected.get('error') or not values_match(imported.get('value'), expected.get('value')):
            conversion.append({'sheet': sheet, 'cell': address, 'original': expected.get('value'),
                               'imported': imported.get('value'), 'error': imported.get('error')})
        # Conversion failures must never become the answer key. Use original answers.
        if sheet in native_golden['sheets']:
            target = native_golden['sheets'][sheet]['cells'].setdefault(address, {})
            for key in ('value', 'error', 'formula'):
                target[key] = expected.get(key)
    native = None
    if args.native_initial or args.native_final:
        if not (args.native_initial and args.native_final and trusted):
            raise ValueError('Native preservation requires both snapshots and verified execution')
        native = (json.loads(Path(args.native_initial).read_text()), json.loads(Path(args.native_final).read_text()))
        if any(x.get('spreadsheetId') != execution.get('spreadsheetId') for x in native):
            raise ValueError('Native preservation identity does not match execution')
    result = grade(spec, initial, native_golden, actual, recalculated=trusted, native_preservation=native)
    result['compatibility'] = {'golden_output_mismatches': len(conversion), 'details': conversion,
                               'passed': not conversion}
    # A reference incompatible with Sheets cannot yield a certified task pass.
    if conversion:
        result['passed'] = False
    result['execution']['engine'] = 'google-apps-script' if trusted else 'google-sheets-export'
    result['execution']['calculation_basis'] = 'google_flush_and_stable_values' if trusted else 'unverified_export_cache'
    write_json(args.out, result)


if __name__ == '__main__':
    main()

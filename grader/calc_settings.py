"""Extract Excel iteration settings so native imports preserve calculation behavior."""
import json
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def extract(path):
    with ZipFile(path) as z:
        root = ET.fromstring(z.read('xl/workbook.xml'))
    calc = root.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}calcPr')
    values = calc.attrib if calc is not None else {}
    return {'enabled': values.get('iterate', '0') in ('1', 'true'),
            'maxIterations': int(values.get('iterateCount', '100')),
            'threshold': float(values.get('iterateDelta', '0.001'))}


if __name__ == '__main__':
    config = json.loads((ROOT / '.benchmark-google.json').read_text())
    print(json.dumps([{'id': template['id'], **extract(ROOT / 'benchmarks/tasks' / tid / f'{kind}.xlsx')}
                      for tid, templates in config['templates'].items() for kind, template in templates.items()]))

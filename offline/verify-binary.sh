#!/bin/bash
# Verify a candidate mog binary: does it keep the gates green AND carry both patches?
set -u
cd "$(dirname "$0")"
echo "=== 1. CF Custom -> type=\"expression\" WITH a dxf (task_14's requirement) ==="
cat dist/appsscript.js > /tmp/vb1.js
cat >> /tmp/vb1.js <<'JS'
var sh = SpreadsheetApp.getActiveSheet();
sh.getRange("A1:A5").setValues([[1],[2],[3],[4],[5]]);
sh.setConditionalFormatRules([ SpreadsheetApp.newConditionalFormatRule()
  .whenFormulaSatisfied("=$A1>3").setFontColor("#000000")
  .setRanges([sh.getRange("A1:A5")]).build() ]);
__mogLog("CF OK");
JS
timeout 200 nice -n 12 ./.mog/bin/mog -f /tmp/vb1.js -o /tmp/vb1.xlsx 2>&1 | head -2
.venv/bin/python -c "
import zipfile,re
z=zipfile.ZipFile('/tmp/vb1.xlsx')
for n in z.namelist():
    if 'worksheets/sheet' in n:
        x=z.read(n).decode('utf8','replace')
        for m in re.finditer(r'<conditionalFormatting.*?</conditionalFormatting>',x,re.S): print('  ',m.group(0)[:200])
    if n.endswith('styles.xml'):
        x=z.read(n).decode('utf8','replace')
        d=re.search(r'<dxfs.*?</dxfs>',x,re.S)
        print('   dxfs:', (d.group(0)[:160] if d else 'NONE'))"

echo; echo "=== 2. empty-string arithmetic (Sheets semantics) ==="
cat dist/appsscript.js > /tmp/vb2.js
cat >> /tmp/vb2.js <<'JS'
var sh = SpreadsheetApp.getActiveSheet();
sh.getRange("A1").setFormula('=""'); sh.getRange("B1").setFormula("=A1+1");
__mogLog("  =A1+1 where A1 is \"\"  ->  " + JSON.stringify(sh.getRange("B1").getValue()) + "   (Google: 1)");
JS
timeout 200 nice -n 12 ./.mog/bin/mog -f /tmp/vb2.js -o /tmp/vb2.xlsx 2>&1 | head -2

echo; echo "=== 3. THE GATE: does a known-correct answer still grade as PASS? ==="
# Was: fidelity/baseline.py -- deleted. `set -u` without `-e` meant this printed
# "No such file" and exited 0, so the gate could not fail. Now it runs the real e2e.
set -e
timeout 3600 nice -n 12 .venv/bin/python e2e/controls.py task_09
timeout 3600 nice -n 12 .venv/bin/python e2e/run_offline.py task_09 | tail -3
.venv/bin/python e2e/test_verdict.py | tail -2

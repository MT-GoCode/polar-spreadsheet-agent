#!/bin/bash
# Run ON THE MAC: pull the VM's run artifacts (text + submissions) into offline-runs/vm-<tag>-...
# Usage: tools/collect_vm_runs.sh <vm-ssh-host>
set -eu
HOST=${1:?vm ssh host}
DEST=~/code/polar-spreadsheet-agent/offline-runs
mkdir -p "$DEST"
rsync -az --include='*/' --include='meta.json' --include='grade.json' --include='transcript.md' \
  --include='response.json' --include='submission.xlsx' --exclude='*' \
  "$HOST:~/conversation-contexts/polar-takehome/work/offline-runs/" "$DEST/vmpull/"
cd "$DEST/vmpull" && for d in */; do n="${d%/}"; [ -d "$DEST/vm-$n" ] || mv "$n" "$DEST/vm-$n"; done
rmdir "$DEST/vmpull" 2>/dev/null || true
echo "collected: $(ls -d $DEST/vm-* 2>/dev/null | wc -l) VM run dirs"

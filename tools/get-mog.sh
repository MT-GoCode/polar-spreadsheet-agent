#!/bin/bash
# Fetch the right mog binary for THIS machine into <repo>/.mog/bin/mog. Idempotent.
set -eu
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  L=linux-x86_64 ;;
  Darwin-arm64)  L=darwin-arm64 ;;
  *) echo "no prebuilt mog for $(uname -s)-$(uname -m)"; exit 1 ;;
esac
mkdir -p .mog/bin
gh release download mog-bin --pattern "mog-$L" -O .mog/bin/mog --clobber
chmod +x .mog/bin/mog
.mog/bin/mog --help >/dev/null 2>&1 || .mog/bin/mog -h >/dev/null 2>&1 || true
echo "mog ready: $(pwd)/.mog/bin/mog ($L)"

"""Self-cleaning scratch for every flow. Temp dir + mog sessions die on exit, even on
crash/SIGINT/SIGTERM. Drive uploads trash themselves. No flow leaves artifacts behind."""
import os, shutil, tempfile, atexit, signal, subprocess, json, urllib.request, urllib.parse
from contextlib import contextmanager
from pathlib import Path

@contextmanager
def scratch(prefix="gasoff-"):
    d = Path(tempfile.mkdtemp(prefix=prefix))
    def _clean(*_):
        shutil.rmtree(d, ignore_errors=True)
    atexit.register(_clean)
    old = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
    for s in old:
        signal.signal(s, lambda *_: (_clean(), os._exit(130)))
    try:
        yield d
    finally:
        _clean()
        for s,h in old.items(): signal.signal(s, h)

def mog_render(mog, src, dst, scratch_dir):
    """One mog round-trip; session dir lives inside scratch so it dies with it."""
    sd = Path(scratch_dir)/f".sess-{Path(dst).stem}"; sd.mkdir(exist_ok=True, mode=0o700)
    env = dict(os.environ); env["MOG_SESSION_DIR"] = str(sd)
    subprocess.run([str(mog),"-i",str(src),"-o",str(dst),"-r"], check=True, env=env,
                   capture_output=True, timeout=900)
    return dst

def _token():
    d=json.load(open(os.path.expanduser("~/.config/gcloud/application_default_credentials.json")))
    b=urllib.parse.urlencode({"client_id":d["client_id"],"client_secret":d["client_secret"],
        "refresh_token":d["refresh_token"],"grant_type":"refresh_token"}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(
        "https://oauth2.googleapis.com/token",data=b)))["access_token"]

@contextmanager
def google_roundtrip(src: Path):
    """Upload as Sheet, export xlsx, ALWAYS trash the Drive copy on exit."""
    tok=_token(); fid=None
    try:
        data=Path(src).read_bytes()
        meta=json.dumps({"name":"CONFORM-tmp","mimeType":"application/vnd.google-apps.spreadsheet"}).encode()
        B=b"----b"
        payload=(b"--"+B+b"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+b"\r\n"
                 b"--"+B+b"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"+data+b"\r\n"
                 b"--"+B+b"--\r\n")
        r=json.load(urllib.request.urlopen(urllib.request.Request(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
            data=payload, headers={"Authorization":"Bearer "+tok,
            "Content-Type":'multipart/related; boundary="----b"'}), timeout=300))
        fid=r["id"]
        exp=urllib.request.urlopen(urllib.request.Request(
            f"https://www.googleapis.com/drive/v3/files/{fid}/export?mimeType="
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Authorization":"Bearer "+tok}), timeout=300).read()
        yield exp
    finally:
        if fid:
            try:
                req=urllib.request.Request(f"https://www.googleapis.com/drive/v3/files/{fid}",
                    data=json.dumps({"trashed":True}).encode(),
                    headers={"Authorization":"Bearer "+tok,"Content-Type":"application/json"}); req.get_method=lambda:"PATCH"
                urllib.request.urlopen(req, timeout=60)
            except Exception: pass


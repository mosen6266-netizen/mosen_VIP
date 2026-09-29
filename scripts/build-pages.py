#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, os, re, shutil
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"_site"
EXCLUDE={".git","_site","node_modules"}
PROJECT_BASE="/mosen_VIP/"

if OUT.exists():
    shutil.rmtree(OUT)

def ignore(directory,names):
    rel=Path(directory).resolve().relative_to(ROOT)
    ignored=set()
    for n in names:
        if n in EXCLUDE: ignored.add(n)
        if rel==Path("toolbox") and n=="public": ignored.add(n)
    return ignored

shutil.copytree(ROOT,OUT,ignore=ignore)

# Rebuild historical /toolbox/public aliases from canonical toolbox files.
# The source repository keeps only one canonical copy of each file.
public_manifest=ROOT/"toolbox"/"public-aliases.json"
public_out=OUT/"toolbox"/"public"
public_out.mkdir(parents=True,exist_ok=True)
if public_manifest.exists():
    try:
        alias_doc=json.loads(public_manifest.read_text("utf-8"))
        aliases=alias_doc.get("aliases",[]) if isinstance(alias_doc,dict) else []
    except Exception:
        aliases=[]
    for name in aliases:
        canonical=ROOT/"toolbox"/str(name)
        if canonical.exists() and canonical.is_file():
            shutil.copy2(canonical,public_out/str(name))

def short_hash(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]

def resolve_asset(html_path:Path, raw:str):
    parts=urlsplit(raw)
    if parts.scheme or parts.netloc or raw.startswith("data:") or raw.startswith("#"):
        return None
    p=parts.path
    if p.startswith(PROJECT_BASE):
        rel=p[len(PROJECT_BASE):]
        target=OUT/rel
    elif p.startswith("/"):
        return None
    else:
        target=(html_path.parent/p).resolve()
    try:
        target.relative_to(OUT.resolve())
    except Exception:
        return None
    return target if target.exists() and target.is_file() else None

attr_re=re.compile(r'(?P<attr>\b(?:src|href)=["\'])(?P<url>[^"\']+\.(?:js|css)(?:\?[^"\']*)?)(?P<end>["\'])',re.I)

for html in OUT.rglob("*.html"):
    text=html.read_text("utf-8")
    def repl(m):
        raw=m.group("url")
        target=resolve_asset(html,raw)
        if not target:
            return m.group(0)
        parts=urlsplit(raw)
        q=[(k,v) for k,v in parse_qsl(parts.query,keep_blank_values=True) if k!="v"]
        q.append(("v",short_hash(target)))
        new=urlunsplit((parts.scheme,parts.netloc,parts.path,urlencode(q),parts.fragment))
        return m.group("attr")+new+m.group("end")
    updated=attr_re.sub(repl,text)
    html.write_text(updated,"utf-8")

manifest={
    "build":os.environ.get("GITHUB_SHA","local"),
    "built_at":os.environ.get("BUILD_TIME",""),
}
(OUT/"build-version.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n","utf-8")
print("Built",OUT)

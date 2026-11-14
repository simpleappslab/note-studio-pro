"""Package the offline PWA and a clean GitHub project, without Site/Git metadata."""
from pathlib import Path
import hashlib,json,sys,zipfile
root=Path(sys.argv[1]).resolve()
output=Path(sys.argv[2]).resolve()
version=sys.argv[3]
output.mkdir(parents=True,exist_ok=True)
archives=[]
web=output/f'Note-Studio-Pro-PWA-{version}.zip'
with zipfile.ZipFile(web,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for item in sorted((root/'dist').rglob('*')):
        if item.is_file():z.write(item,item.relative_to(root/'dist').as_posix())
    z.writestr('README-FIRST.txt',(root/'PWA-DISTRIBUTION.md').read_text())
archives.append(web)
project=output/f'Note-Studio-Pro-GitHub-{version}.zip'
entries=['dist','scripts','.github','.gitignore','README.md','PWA-DISTRIBUTION.md','RELEASE-NOTES.md','CHROME_WEB_STORE_LISTING.txt','package.json','package-lock.json']
with zipfile.ZipFile(project,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in entries:
        item=root/name
        candidates=sorted(item.rglob('*')) if item.is_dir() else [item]
        for p in candidates:
            if p.is_file() and '__pycache__' not in p.parts:
                z.write(p,'Note-Studio-Pro/'+p.relative_to(root).as_posix())
archives.append(project)
checksums=[]
for archive in archives:
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert not any('/.git/' in n or '/.openai/' in n or '/node_modules/' in n for n in z.namelist())
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    checksums.append(digest+'  '+archive.name)
    print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':digest}))
(output/'SHA256SUMS.txt').write_text('\n'.join(checksums)+'\n')

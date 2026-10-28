#!/usr/bin/env python3
"""Package an already-built source tree using a local Electron.app runtime."""
import argparse
import json
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

APP_ID = 'com.xuanqi.dsh-codex-pet'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--electron',required=True,type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    args=parser.parse_args()
    source=args.source.resolve()
    if not (source/'lib/app.js').is_file():
        raise SystemExit('Build scripts/build-codex-app.mjs first')
    # Sign outside synced Documents: File Provider can reattach Finder metadata
    # during recursive signing. copy() retains executable modes but not xattrs.
    app=Path(tempfile.mkdtemp(prefix='dsh-codex-build-'))/'DSH Codex Pet.app'
    shutil.copytree(args.electron.resolve(),app,symlinks=True,copy_function=shutil.copy)
    resources=app/'Contents/Resources'
    package=resources/'app'
    package.mkdir(exist_ok=True)
    for folder in ['lib','runtime']:
        shutil.copytree(source/folder,package/folder,dirs_exist_ok=True)
    for folder in ['webm','fonts','pic','memes','sound']:
        if (source/'assets'/folder).is_dir():
            shutil.copytree(source/'assets'/folder,package/'assets'/folder,dirs_exist_ok=True)
    for name in ['config.jsonc','logo.png']:
        shutil.copy2(source/'assets'/name,package/'assets'/name)
    metadata=json.loads((source/'package.json').read_text())
    metadata.update(name='dsh-codex-companion',version='0.4.0-codex.1',main='lib/app.js',
        productName='DSH Codex Pet',description='鲸鱼娘 Codex 桌面交互版')
    (package/'package.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    for name in ['ATTRIBUTION.md','LICENSE.code','README.md']:
        shutil.copy2(args.output/name,package/name)
    info_path=app/'Contents/Info.plist'
    info=plistlib.loads(info_path.read_bytes())
    info.update(CFBundleIdentifier=APP_ID,CFBundleDisplayName='DSH Codex Pet',CFBundleName='DSH Codex Pet',
        CFBundleShortVersionString='0.4.0',CFBundleVersion='1',LSUIElement=True,
        NSHighResolutionCapable=True,CFBundleIconFile='pet.icns')
    # Preserve the existing Electron executable and framework identities.
    info_path.write_bytes(plistlib.dumps(info))
    from PIL import Image
    with Image.open(source/'assets/logo.png') as icon:
        icon.convert('RGBA').save(resources/'pet.icns',format='ICNS')
    # Newly copied application bundles can acquire Finder metadata from File Provider.
    # Only strip the two signing-incompatible attributes in this generated output.
    for attribute in ['com.apple.FinderInfo','com.apple.ResourceFork']:
        subprocess.run(['/usr/bin/xattr','-dr',attribute,str(app)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(app)],check=True)
    subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True)
    payload=args.output.resolve()/'DSH Codex Pet.app.zip'
    subprocess.run(['/usr/bin/ditto','-c','-k','--keepParent','--norsrc',str(app),str(payload)],check=True)
    # The ZIP retains the clean signature while living in a synced folder.
    print(json.dumps({'payload':str(payload),'staged_app':str(app),'bundleId':APP_ID,'version':'0.4.0-codex.1'},ensure_ascii=False))

if __name__=='__main__':
    main()

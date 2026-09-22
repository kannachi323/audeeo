"""Package the supplied logo, without redrawing it, into platform icon assets."""
import base64
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
logo = base64.b64encode((root / 'assets/audeeo-logo.png').read_bytes()).decode()

def svg(mac=False):
    tile = '<rect x="100" y="100" width="824" height="824" rx="184" fill="#191919"/>' if mac else '<rect width="1024" height="1024" fill="#191919"/>'
    pos, size = (152, 720) if mac else (64, 896)
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">{tile}<image x="{pos}" y="{pos}" width="{size}" height="{size}" xlink:href="data:image/png;base64,{logo}"/></svg>'

# Keep the source icon current; package only desktop outputs.
(root / 'app-icon.svg').write_text(svg())
with tempfile.TemporaryDirectory(prefix='audeeo-icons-') as temp:
    path = Path(temp)
    subprocess.run(['npm', 'run', 'tauri', '--', 'icon', 'app-icon.svg', '-o', str(path / 'desktop')], cwd=root, check=True)
    for source in (path / 'desktop').iterdir():
        if source.is_file():
            shutil.copy2(source, root / 'src-tauri/icons' / source.name)
    mac = path / 'mac.svg'
    mac.write_text(svg(True))
    subprocess.run(['npm', 'run', 'tauri', '--', 'icon', str(mac), '-o', str(path / 'icons')], cwd=root, check=True)
    for name in ['icon.icns', 'icon.png', '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png']:
        source = path / 'icons' / name
        if source.exists():
            shutil.copy2(source, root / 'src-tauri/icons' / name)

subprocess.run(['sips', '-z', '64', '64', str(root / 'src-tauri/icons/icon.png'), '--out', str(root / 'src-tauri/icons/64x64.png')], check=True)
(root / 'public').mkdir(exist_ok=True)
shutil.copy2(root / 'src-tauri/icons/32x32.png', root / 'public/favicon.png')

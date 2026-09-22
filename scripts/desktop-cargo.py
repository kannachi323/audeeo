#!/usr/bin/env python3
"""Tauri macOS Cargo runner: keep hot reload inside a signed StoreKit-capable app.

Build commands pass straight through. For `cargo run`, a Cargo target runner
packages the freshly compiled executable before launching it. No release build,
frontend rebuild, mocked prices, or changes to the user's billing mode are needed.
"""
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=False):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=capture)


def prepare_app(executable):
    executable = Path(executable).resolve()
    config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
    app = executable.parent / 'bundle/macos/Audeeo Dev.app'
    contents = app / 'Contents'
    macos = contents / 'MacOS'
    resources = contents / 'Resources'
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)

    identities = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True).stdout
    installed = re.findall(r'"(Apple Development:[^"]+)"', identities)
    preferred = os.environ.get('AUDEEO_MAC_DEV_SIGNING_IDENTITY') or config['bundle']['macOS'].get('signingIdentity')
    signing = preferred if preferred in installed else installed[0] if installed else None
    if os.environ.get('AUDEEO_MAC_DEV_SIGNING_IDENTITY') and signing != preferred:
        sys.exit('AUDEEO_MAC_DEV_SIGNING_IDENTITY must be an installed Apple Development identity.')
    if not signing:
        sys.exit('Install an Apple Development signing identity in Xcode to run Audeeo with StoreKit. No ad-hoc fallback is used.')

    plist = plistlib.loads((ROOT / 'src-tauri/Info.plist').read_bytes())
    plist.update({
        'CFBundleIdentifier': config['identifier'],
        'CFBundleName': 'Audeeo Dev', 'CFBundleDisplayName': 'Audeeo Dev',
        'CFBundleExecutable': executable.name, 'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': config['version'], 'CFBundleVersion': '1',
        'CFBundleIconFile': 'icon.icns', 'NSHighResolutionCapable': True,
        'LSMinimumSystemVersion': config['bundle']['macOS']['minimumSystemVersion'],
    })
    (contents / 'Info.plist').write_bytes(plistlib.dumps(plist))
    (contents / 'PkgInfo').write_bytes(b'APPL????')
    bundled = macos / executable.name
    shutil.copyfile(executable, bundled)
    bundled.chmod(0o755)
    shutil.copyfile(ROOT / 'src-tauri/icons/icon.icns', resources / 'icon.icns')
    shutil.copyfile(ROOT / 'src-tauri/PrivacyInfo.xcprivacy', resources / 'PrivacyInfo.xcprivacy')

    architectures = run('xcrun', 'lipo', '-archs', str(executable), capture=True).stdout.split()
    products = Path(run('swift', 'build', '--package-path', str(ROOT / 'native/apple'), '-c', 'release',
                        '--arch', architectures[0], '--show-bin-path', capture=True).stdout.strip())
    sdk_resources = products / 'RevenueCat_RevenueCat.bundle'
    if not (sdk_resources / 'PrivacyInfo.xcprivacy').is_file():
        sys.exit('RevenueCat resources are missing. Run sh scripts/apple-native-build.sh macos first.')
    shutil.copytree(sdk_resources, resources / sdk_resources.name, dirs_exist_ok=True, copy_function=shutil.copyfile)

    # Match the signed local test app's sandbox permissions. Restricted app/team
    # entitlement claims require a provisioning profile and are omitted locally.
    entitlements = plistlib.loads((ROOT / 'src-tauri/Entitlements.macOS.plist').read_bytes())
    entitlements.pop('com.apple.application-identifier', None)
    entitlements.pop('com.apple.developer.team-identifier', None)
    entitlements_path = app.parent / 'AudeeoDev.entitlements'
    entitlements_path.write_bytes(plistlib.dumps(entitlements))
    run('codesign', '--force', '--sign', signing, '--entitlements', str(entitlements_path), str(app))
    run('codesign', '--verify', '--deep', '--strict', str(app))
    print(f'Signed development app: {app}', flush=True)
    return bundled


def main():
    args = sys.argv[1:]
    if args and args[0] in ('--launch', '--prepare'):
        executable = prepare_app(args[1])
        if args[0] == '--launch':
            # exec preserves Cargo/Tauri process supervision and restart behavior.
            os.execv(str(executable), [str(executable), *args[2:]])
        return
    if args and args[0] == 'run':
        runner = ['python3', str(Path(__file__).resolve()), '--launch']
        setting = 'target.\'cfg(target_os = "macos")\'.runner = ' + json.dumps(runner)
        separator = args.index('--') if '--' in args else len(args)
        args[separator:separator] = ['--config', setting]
    os.execvp('cargo', ['cargo', *args])


if __name__ == '__main__':
    main()

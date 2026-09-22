#!/usr/bin/env python3
"""Build and verify a self-contained sandboxed Mac app. Never uploads it.

--local uses an installed development identity for sandbox smoke tests.
--testflight uses distribution signing with sandbox billing for approved testers.
Distribution requires AUDEEO_MAC_SIGNING_IDENTITY, AUDEEO_MAC_INSTALLER_IDENTITY,
AUDEEO_MAC_PROFILE, and AUDEEO_BUILD_NUMBER. No credentials go in tracked config.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TEAM = '7D6BVN4W87'
BUNDLE = 'com.mattdev727.audeeo'

def run(*args, capture=False, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=capture, **kwargs)

def required(key):
    value = os.environ.get(key)
    if not value:
        sys.exit(f'Set {key} before building a distribution package. See docs/mac-app-store.md.')
    return value

parser = argparse.ArgumentParser(description=__doc__)
channel = parser.add_mutually_exclusive_group()
channel.add_argument('--local', action='store_true')
channel.add_argument('--testflight', action='store_true')
parser.add_argument('--preflight-only', action='store_true', help='Validate release configuration without building.')
parser.add_argument('--target', choices=['aarch64-apple-darwin', 'universal-apple-darwin'], default='universal-apple-darwin')
args = parser.parse_args()
# Scope billing to this packaging process. Never rewrite the developer's .env.
# TestFlight purchases are sandbox transactions, even in a distribution-signed app.
if not args.local:
    os.environ['AUDEEO_BILLING_ENVIRONMENT'] = 'sandbox' if args.testflight else 'production'
settings = json.loads(run('node', '--input-type=module', '-e',
    "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; const e={...parseEnv(readFileSync('.env','utf8')),...process.env}; console.log(JSON.stringify({distribution:e.AUDEEO_DISTRIBUTION,billing:e.AUDEEO_BILLING_ENVIRONMENT||'production'}));",
    capture=True).stdout)
if settings.get('distribution') != 'app-store':
    sys.exit('Set AUDEEO_DISTRIBUTION=app-store in .env before using the App Store packager.')
if settings['billing'] not in ('sandbox', 'production'):
    sys.exit('AUDEEO_BILLING_ENVIRONMENT must be sandbox or production.')
identities = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True).stdout
if args.local:
    import re
    candidates = re.findall(r'"(Apple Development:[^"]+)"', identities)
    if not candidates:
        sys.exit('Install an Apple Development identity for local sandbox testing.')
    signing = candidates[0]
    build = os.environ.get('AUDEEO_BUILD_NUMBER', '1')
    profile = None
else:
    signing = required('AUDEEO_MAC_SIGNING_IDENTITY')
    installer = required('AUDEEO_MAC_INSTALLER_IDENTITY')
    if not signing.startswith(('Apple Distribution:', '3rd Party Mac Developer Application:')):
        sys.exit('Use a Mac App Store distribution identity, not Apple Development or Developer ID.')
    if 'Installer' not in installer or 'Developer ID' in installer:
        sys.exit('Use a Mac Installer Distribution identity for the package.')
    import urllib.request
    try:
        request = urllib.request.Request('https://api.audeeo.app/v1/release-readiness', headers={'User-Agent': 'Audeeo-Release-Check', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=15) as response:
            readiness = json.load(response)
        if readiness.get('ready') is not True:
            sys.exit('Production account-deletion credentials are not ready. See docs/mac-app-store.md.')
    except (OSError, ValueError):
        sys.exit('Could not verify production release readiness. Deploy and configure the relay first.')
    build = required('AUDEEO_BUILD_NUMBER')
    profile = Path(required('AUDEEO_MAC_PROFILE')).expanduser().resolve()
    info = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile), capture=True).stdout.encode())
    ent = info['Entitlements']
    from datetime import datetime, timezone
    expires = info['ExpirationDate'].replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        sys.exit('The provisioning profile has expired.')
    if ent.get('com.apple.application-identifier') != f'{TEAM}.{BUNDLE}' or ent.get('com.apple.developer.team-identifier') != TEAM:
        sys.exit('The provisioning profile does not match Audeeo and its team.')
    if ent.get('get-task-allow') or info.get('ProvisionedDevices') or info.get('ProvisionsAllDevices'):
        sys.exit('Use a Mac App Store Connect distribution profile.')
    # A valid profile for this bundle is insufficient if it was issued to a
    # different signing certificate. Match its actual DER certificate fingerprint.
    import re
    installed = re.findall(r'([0-9A-F]{40})\s+"([^"]+)"', identities)
    selected = next((digest for digest, name in installed if name == signing), None)
    allowed = {hashlib.sha1(cert).hexdigest().upper() for cert in info.get('DeveloperCertificates', [])}
    if selected not in allowed:
        sys.exit('The provisioning profile does not include the selected app-signing certificate.')
if signing not in identities:
    sys.exit('The requested app-signing identity is not installed in the keychain.')
if not build.isdecimal() or int(build) < 1:
    sys.exit('AUDEEO_BUILD_NUMBER must be a positive integer, increased for each upload.')

features = run('cargo', 'tree', '--manifest-path', 'src-tauri/Cargo.toml', '-e', 'features', capture=True).stdout
if 'macos-private-api' in features:
    sys.exit('Private macOS APIs remain enabled in the Cargo dependency graph.')
for source in (ROOT / 'native/apple/Sources').rglob('*.swift'):
    if 'forKey: "drawsBackground"' in source.read_text():
        sys.exit(f'Private WebKit API remains in {source.name}.')

release_channel = 'local' if args.local else 'testflight' if args.testflight else 'app-store'
print(f'Validated {release_channel} configuration: build {build}, {settings["billing"]} billing.', flush=True)
if args.preflight_only:
    sys.exit(0)

architectures = ['arm64', 'x86_64'] if args.target == 'universal-apple-darwin' else ['arm64']
for arch in architectures:
    run('sh', 'scripts/apple-native-build.sh', 'macos', arch)
products = Path(run('swift', 'build', '--package-path', 'native/apple', '-c', 'release', '--arch', 'arm64', '--show-bin-path', capture=True).stdout.strip())
resources = products / 'RevenueCat_RevenueCat.bundle'
if not (resources / 'PrivacyInfo.xcprivacy').is_file():
    sys.exit('RevenueCat privacy resources are missing.')
# RevenueCat 5.89.0 has a manifest-only resource bundle and does not call Bundle.module.
# Require a resource-loader review if a future SDK starts loading assets at runtime.
sdk = ROOT / 'native/apple/.build/checkouts/purchases-ios/Sources'
if any('Bundle.module' in p.read_text() for p in sdk.rglob('*.swift')):
    sys.exit('Review the new RevenueCat runtime resource loader before shipping this SDK version.')

out = ROOT / 'artifacts/mac-app-store'
out.mkdir(parents=True, exist_ok=True)
# SwiftPM copies some manifests read-only. Stage writable files without inherited
# xattrs so Tauri can clear quarantine attributes before signing the app.
import shutil
staged = out / 'RevenueCat_RevenueCat.bundle'
shutil.copytree(resources, staged, dirs_exist_ok=True, copy_function=shutil.copyfile)
for item in staged.rglob('*'):
    item.chmod(0o755 if item.is_dir() else 0o644)
# SwiftPM emits only CFBundleDevelopmentRegion for this resource-only bundle.
# App Store validation requires its own identifier, even without an executable.
resource_info_path = staged / 'Info.plist'
resource_info = plistlib.loads(resource_info_path.read_bytes())
resource_info.update({
    'CFBundleIdentifier': f'{BUNDLE}.resources.RevenueCat',
    'CFBundleName': 'RevenueCat_RevenueCat',
    'CFBundlePackageType': 'BNDL',
    'CFBundleShortVersionString': '1.0',
    'CFBundleVersion': '1',
})
resource_info_path.write_bytes(plistlib.dumps(resource_info))
files = {'Resources/RevenueCat_RevenueCat.bundle': str(staged)}
if profile:
    files['embedded.provisionprofile'] = str(profile)
entitlements = ROOT / 'src-tauri/Entitlements.macOS.plist'
if args.local:
    # App/team identifiers are restricted and require an Apple profile. Keep the
    # same sandbox/device/network permissions for a runnable local smoke build.
    local_entitlements = plistlib.loads(entitlements.read_bytes())
    local_entitlements.pop('com.apple.application-identifier', None)
    local_entitlements.pop('com.apple.developer.team-identifier', None)
    entitlements = out / 'LocalSandbox.entitlements'
    entitlements.write_bytes(plistlib.dumps(local_entitlements))
config = out / 'build-config.json'
config.write_text(json.dumps({'bundle': {'macOS': {'signingIdentity': signing, 'bundleVersion': build, 'files': files, 'entitlements': str(entitlements)}}}))
run('npm', 'run', 'tauri', '--', 'build', '--target', args.target, '--config', 'src-tauri/tauri.store.conf.json', '--config', str(config))
app = ROOT / f'src-tauri/target/{args.target}/release/bundle/macos/Audeeo.app'
run('codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app))
signed = run('codesign', '-d', '--entitlements', ':-', str(app), capture=True)
ent = plistlib.loads(signed.stdout.encode())
assert ent.get('com.apple.security.app-sandbox') is True, 'Sandbox entitlement missing'
assert ent.get('com.apple.security.network.client') is True, 'Outgoing network entitlement missing'
assert ent.get('com.apple.security.network.server') is True, 'OAuth loopback listener entitlement missing'
if not args.local:
    assert ent.get('com.apple.application-identifier') == f'{TEAM}.{BUNDLE}', 'App identifier missing'
for manifest in [app/'Contents/Resources/PrivacyInfo.xcprivacy', app/'Contents/Resources/RevenueCat_RevenueCat.bundle/PrivacyInfo.xcprivacy']:
    with manifest.open('rb') as f:
        plistlib.load(f)
for nested_bundle in (app / 'Contents').rglob('*.bundle'):
    nested_info_path = nested_bundle / 'Contents/Info.plist'
    if not nested_info_path.is_file():
        nested_info_path = nested_bundle / 'Info.plist'
    nested_info = plistlib.loads(nested_info_path.read_bytes())
    assert nested_info.get('CFBundleIdentifier'), f'Bundle identifier missing: {nested_bundle}'
if args.local:
    print(f'Local sandbox app verified: {app}\nThis development-signed build cannot be submitted.')
else:
    package = out / f'Audeeo-{"TestFlight-" if args.testflight else ""}{build}.pkg'
    run('xcrun', 'productbuild', '--sign', installer, '--component', str(app), '/Applications', str(package))
    run('pkgutil', '--check-signature', str(package))
    app_info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    executable = app / 'Contents/MacOS' / app_info['CFBundleExecutable']
    actual_architectures = run('lipo', '-archs', str(executable), capture=True).stdout.strip().split()
    assert set(actual_architectures) == set(architectures), 'Packaged executable architectures do not match target'
    assert app_info['CFBundleVersion'] == build, 'Packaged build number does not match request'
    verification = {
        'version': app_info['CFBundleShortVersionString'], 'build': build,
        'channel': release_channel, 'billingEnvironment': settings['billing'],
        'architectures': actual_architectures, 'package': str(package),
        'sizeBytes': package.stat().st_size, 'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
        'localSignatureVerified': True, 'appleValidated': False, 'uploaded': False,
    }
    package.with_suffix('.verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    print(f'Package ready for Apple validation: {package}')

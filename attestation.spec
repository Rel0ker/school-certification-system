# -*- mode: python ; coding: utf-8 -*-
# Сборка: из корня проекта на Windows:  py -m PyInstaller --clean --noconfirm attestation.spec
from pathlib import Path

block_cipher = None
ROOT = Path(SPEC).resolve().parent

a = Analysis(
    [str(ROOT / "start.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / "index.html"), "."),
        (str(ROOT / "styles.css"), "."),
        (str(ROOT / "app.js"), "."),
        (str(ROOT / "db.js"), "."),
        (str(ROOT / "vendor" / "sql-wasm.js"), "vendor"),
        (str(ROOT / "vendor" / "sql-wasm.wasm"), "vendor"),
        (str(ROOT / "admin" / "index.html"), "admin"),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="SchoolAttestation",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

"""Check every bundled Mach-O slice before signing or distributing macOS apps."""

import subprocess
import ctypes
import plistlib


MACHO_MAGICS = {
    b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe',
    b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca',
}


def process_architecture(pid):
    """Read the original Mach-O CPU type through macOS's unprivileged proc API."""
    class ArchInfo(ctypes.Structure):
        _fields_ = [('cpu', ctypes.c_int32), ('subtype', ctypes.c_int32)]
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                     ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    info = ArchInfo()
    # PROC_PIDARCHINFO and struct proc_archinfo from the public macOS SDK.
    if library.proc_pidinfo(int(pid), 19, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info):
        raise RuntimeError(f'Cannot read architecture of owned test PID {pid}: errno {ctypes.get_errno()}')
    names = {0x0100000c: 'arm64', 0x01000007: 'x86_64'}
    if info.cpu not in names:
        raise RuntimeError(f'Unexpected CPU type {info.cpu} for test PID {pid}')
    return names[info.cpu]


def verify_bundle_version(app, version):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if (info.get('CFBundleShortVersionString') != version or
            info.get('CFBundleIdentifier') != 'com.browseroperator.BrowserOperator'):
        raise RuntimeError('Browser bundle identity/version differs from the requested release')
    versions = app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions'
    present = {p.name for p in versions.iterdir() if p.is_dir() and not p.is_symlink()}
    current = versions / 'Current'
    if present != {version} or not current.is_symlink() or current.resolve() != (versions / version).resolve():
        raise RuntimeError('Browser bundle contains a stale or mismatched framework version')


def verify_architectures(app, architecture):
    expected = {'arm64'} if architecture == 'arm64' else {'x86_64'} if architecture == 'x64' else None
    if architecture == 'universal':
        expected = {'arm64', 'x86_64'}
    if expected is None:
        raise RuntimeError('Unsupported macOS architecture')
    binaries = {}
    for path in sorted(app.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            magic = stream.read(4)
        if magic not in MACHO_MAGICS:
            continue
        arches = subprocess.check_output(['lipo', '-archs', str(path)], text=True).split()
        if set(arches) != expected:
            raise RuntimeError(f'Unexpected architectures {arches} in {path}; expected {sorted(expected)}')
        binaries[path.relative_to(app).as_posix()] = sorted(arches)
    if not binaries:
        raise RuntimeError(f'No Mach-O code found in {app}')
    return binaries

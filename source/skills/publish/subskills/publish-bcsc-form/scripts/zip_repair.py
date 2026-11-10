"""Streaming ZIP repair utility.

LEAP exports .docx files as streaming ZIPs — valid local file headers
but no central directory or EOCD record. Python's zipfile module requires
these and rejects the file with BadZipFile.

This module provides readable_zip(), a context manager that transparently
repairs streaming ZIPs by reconstructing the central directory from local
file headers.
"""
from __future__ import annotations

import contextlib
import os
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path

# Local file header signature
_LFH_SIG = b'PK\x03\x04'
_LFH_SIZE = 30  # fixed portion of local file header

# Central directory header fields
_CDH_SIG = b'PK\x01\x02'
_EOCD_SIG = b'PK\x05\x06'


def _scan_local_headers(data: bytes) -> list[dict]:
    """Scan local file headers and extract member metadata + data."""
    members = []
    pos = 0

    while pos <= len(data) - _LFH_SIZE:
        if data[pos:pos + 4] != _LFH_SIG:
            break

        (sig, ver_needed, flags, method, mod_time, mod_date,
         crc32, comp_size, uncomp_size,
         name_len, extra_len) = struct.unpack_from('<4sHHHHHIIIHH', data, pos)

        header_end = pos + _LFH_SIZE + name_len + extra_len
        name = data[pos + _LFH_SIZE:pos + _LFH_SIZE + name_len]

        data_start = header_end
        has_descriptor = bool(flags & 0x08)

        if has_descriptor and comp_size == 0:
            # Sizes unknown — decompress to find boundary
            if method == 8:  # DEFLATE
                dec = zlib.decompressobj(-15)
                consumed = 0
                chunk = 4096
                while consumed < len(data) - data_start:
                    end = min(consumed + chunk, len(data) - data_start)
                    try:
                        dec.decompress(data[data_start + consumed:data_start + end])
                    except zlib.error:
                        break
                    consumed = end
                    if dec.eof:
                        consumed -= len(dec.unused_data)
                        break
                comp_size = consumed
                decompressed = dec.flush() if not dec.eof else b''
                _ = decompressed  # not needed; we re-read below
            elif method == 0:  # STORED — scan for next header or EOF
                next_header = data.find(_LFH_SIG, data_start + 1)
                if next_header == -1:
                    comp_size = len(data) - data_start
                else:
                    # Account for data descriptor between data and next header
                    comp_size = next_header - data_start
                    # Subtract descriptor size (will be handled below)
                    if data[next_header - 16:next_header - 12] == b'PK\x07\x08':
                        comp_size -= 16
                    elif next_header >= data_start + 12:
                        comp_size -= 12
            else:
                raise ValueError(
                    f"Unsupported compression method {method} "
                    f"for member {name.decode('utf-8', errors='replace')}")

        comp_data = data[data_start:data_start + comp_size]

        # Decompress to get actual sizes and CRC
        if method == 8:
            raw = zlib.decompress(comp_data, -15)
        elif method == 0:
            raw = comp_data
        else:
            raise ValueError(f"Unsupported compression method {method}")

        actual_crc = zlib.crc32(raw) & 0xFFFFFFFF

        members.append({
            'name': name,
            'method': method,
            'mod_time': mod_time,
            'mod_date': mod_date,
            'crc32': actual_crc,
            'comp_size': len(comp_data),
            'uncomp_size': len(raw),
            'offset': pos,
            'comp_data': comp_data,
            'raw_data': raw,
            'extra': data[pos + _LFH_SIZE + name_len:header_end],
        })

        # Advance past compressed data
        pos = data_start + comp_size

        # Skip data descriptor if present
        if has_descriptor:
            if pos + 4 <= len(data) and data[pos:pos + 4] == b'PK\x07\x08':
                pos += 16  # signature + crc32 + comp_size + uncomp_size
            else:
                pos += 12  # crc32 + comp_size + uncomp_size (no signature)

    return members


def _rebuild_zip(members: list[dict]) -> bytes:
    """Build a conforming ZIP from extracted member data."""
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
        for m in members:
            zout.writestr(m['name'].decode('utf-8'), m['raw_data'])
    return buf.getvalue()


@contextlib.contextmanager
def readable_zip(path: Path):
    """Open a .docx/.dotx as a ZipFile, repairing streaming ZIPs if needed.

    Usage:
        with readable_zip(Path("template.docx")) as zf:
            members = {n: zf.read(n) for n in zf.namelist()}
    """
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            yield zf
        return

    data = path.read_bytes()
    if data[:4] != _LFH_SIG:
        raise ValueError(f"Not a ZIP file (no PK\\x03\\x04 header): {path}")

    members = _scan_local_headers(data)
    if not members:
        raise ValueError(f"No ZIP members found in streaming ZIP: {path}")

    repaired = _rebuild_zip(members)
    tmp = tempfile.NamedTemporaryFile(suffix='.docx', delete=False)
    try:
        tmp.write(repaired)
        tmp.close()
        with zipfile.ZipFile(tmp.name) as zf:
            yield zf
    finally:
        os.unlink(tmp.name)

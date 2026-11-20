"""
Builds the compact multi-tier Western North America historical climate atlas
(`public/data/western-climate-atlas.bin`) and static volcanic forcing lookup
(`src/model/volcanicForcing.ts`) from public-domain NOAA NCEI datasets:

1. NOAA nClimDiv Monthly Instrumental Climate Divisions (1895-1980, aligned to 1981-2020)
   + Official CONUS Climate Divisions Shapefile (exact polygon mapping on 0.5 deg grid)
2. Living Blended Drought Atlas v2 (LBDA v2, Cook et al. 2010 / 2017; 1200-1894 JJA PMDI)
3. Western North American Temperature Atlas (WNATA, King et al. 2024; 1553-1894 JJA Tmax, aligned to 1981-2020)
4. N-TREND Northern Hemisphere MJJA Temperature Reconstruction (Wilson et al. 2016; 1200-1552, aligned to 1981-2011)
5. Ice-Core Volcanic Stratospheric Aerosol Optical Depth 30-90N (Crowley & Unterman 2013; 1200-2000)

Usage:
    python scripts/build_climate_atlas.py
"""

from __future__ import annotations

import gzip
import io
import math
import os
import re
import struct
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT_DIR / '.cache' / 'climate_raw'
OUT_BIN = ROOT_DIR / 'public' / 'data' / 'western-climate-atlas.bin'
OUT_VOLC_TS = ROOT_DIR / 'src' / 'model' / 'volcanicForcing.ts'

# Spatial bounds for Western North America
DIV_LAT_MIN = 30.0
DIV_LON_MIN = -125.0
DIV_ROWS = 40  # 30.0 .. 49.5 at 0.5 deg
DIV_COLS = 48  # -125.0 .. -101.5 at 0.5 deg

PALEO_LAT_MIN = 30.5
PALEO_LON_MIN = -125.5
PALEO_ROWS = 20  # 30.5 .. 49.5 at 1.0 deg (bins [30..31) .. [49..50))
PALEO_COLS = 25  # -125.5 .. -101.5 at 1.0 deg (bins [-126..-125) .. [-102..-101))

NCLIM_START = 1895
NCLIM_END = 1980
BASE_START = 1981
BASE_END = 2020

LBDA_START = 1200
LBDA_END = 1894

WNATA_START = 1553
WNATA_END = 1894

NTREND_START = 1200
NTREND_END = 1552

VOLC_START = 1200
VOLC_END = 2000


def download_cached(url: str, filename: str, timeout: int = 120) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = CACHE_DIR / filename
    if target.exists() and target.stat().st_size > 0:
        print(f'  [cache] {filename} ({target.stat().st_size:,} bytes)')
        return target
    print(f'  [fetch] {url} -> {filename} ...')
    resp = requests.get(url, timeout=timeout, stream=True)
    resp.raise_for_status()
    tmp = target.with_suffix(target.suffix + '.part')
    with open(tmp, 'wb') as f:
        for chunk in resp.iter_content(chunk_size=1024 * 256):
            if chunk:
                f.write(chunk)
    tmp.replace(target)
    print(f'  [saved] {filename} ({target.stat().st_size:,} bytes)')
    return target


def resolve_latest_climdiv_files() -> Tuple[str, str]:
    """Discovers the latest climdiv-tmpcdv and climdiv-pcpndv filenames on NOAA NCEI."""
    index_url = 'https://www.ncei.noaa.gov/pub/data/cirs/climdiv/'
    try:
        resp = requests.get(index_url, timeout=20)
        resp.raise_for_status()
        tmpc_matches = sorted(set(re.findall(r'climdiv-tmpcdv-v[\d.]+-\d+', resp.text)))
        pcpn_matches = sorted(set(re.findall(r'climdiv-pcpndv-v[\d.]+-\d+', resp.text)))
        if tmpc_matches and pcpn_matches:
            return tmpc_matches[-1], pcpn_matches[-1]
    except Exception as exc:
        print(f'  [warn] Could not list climdiv directory ({exc}); checking local cache')

    cached_tmpc = sorted(CACHE_DIR.glob('climdiv-tmpcdv-v*'))
    cached_pcpn = sorted(CACHE_DIR.glob('climdiv-pcpndv-v*'))
    if cached_tmpc and cached_pcpn:
        return cached_tmpc[-1].name, cached_pcpn[-1].name
    raise RuntimeError('Unable to resolve NOAA climdiv filenames')


def parse_dbf_records(dbf_bytes: bytes) -> List[Dict[str, str]]:
    num_records, header_len, rec_len = struct.unpack('<IHH', dbf_bytes[4:12])
    pos = 32
    fields: List[Tuple[str, int]] = []
    while pos < header_len - 1 and dbf_bytes[pos] != 0x0D:
        name = dbf_bytes[pos : pos + 11].split(b'\x00')[0].decode('ascii', errors='ignore')
        flen = dbf_bytes[pos + 16]
        fields.append((name, flen))
        pos += 32

    records: List[Dict[str, str]] = []
    offset = header_len
    for _ in range(num_records):
        rec = dbf_bytes[offset : offset + rec_len]
        offset += rec_len
        if len(rec) < rec_len or rec[0] == 0x2A:  # deleted record
            continue
        p = 1
        row: Dict[str, str] = {}
        for name, flen in fields:
            row[name] = rec[p : p + flen].decode('ascii', errors='ignore').strip()
            p += flen
        records.append(row)
    return records


def polygon_centroid_and_rings(
    shp_bytes: bytes,
) -> List[Tuple[Tuple[float, float, float, float], List[np.ndarray], Tuple[float, float]]]:
    """Parses all polygon shapes from an ESRI .shp byte buffer."""
    file_code = struct.unpack('>i', shp_bytes[0:4])[0]
    if file_code != 9994:
        raise ValueError(f'Unexpected shapefile code: {file_code}')
    ver, shape_type, xmin, ymin, xmax, ymax = struct.unpack('<2i4d', shp_bytes[28:68])
    if shape_type != 5:
        raise ValueError(f'Expected Polygon shapefile (5), got {shape_type}')
    if not (-130.0 <= xmin <= -60.0 and 20.0 <= ymin <= 55.0):
        raise ValueError(f'Shapefile bbox not in geographic degrees: {(xmin, ymin, xmax, ymax)}')

    shapes = []
    offset = 100
    total_len = len(shp_bytes)
    while offset + 8 <= total_len:
        _rec_num, content_words = struct.unpack('>2i', shp_bytes[offset : offset + 8])
        offset += 8
        rec_bytes = content_words * 2
        content = shp_bytes[offset : offset + rec_bytes]
        offset += rec_bytes

        rec_shape_type = struct.unpack('<i', content[0:4])[0]
        if rec_shape_type == 0:
            shapes.append(((0.0, 0.0, 0.0, 0.0), [], (0.0, 0.0)))
            continue
        if rec_shape_type != 5:
            raise ValueError(f'Unexpected record shapeType {rec_shape_type}')

        bxmin, bymin, bxmax, bymax = struct.unpack('<4d', content[4:36])
        num_parts, num_points = struct.unpack('<2i', content[36:44])
        parts_end = 44 + 4 * num_parts
        parts = list(struct.unpack(f'<{num_parts}i', content[44:parts_end]))
        pts = np.frombuffer(content, dtype='<f8', count=num_points * 2, offset=parts_end).reshape(num_points, 2)

        rings: List[np.ndarray] = []
        for idx in range(num_parts):
            start_i = parts[idx]
            end_i = parts[idx + 1] if idx + 1 < num_parts else num_points
            if end_i - start_i >= 3:
                rings.append(pts[start_i:end_i])

        # Compute signed-area centroid weighted across rings
        area_sum = 0.0
        cx_sum = 0.0
        cy_sum = 0.0
        for ring in rings:
            x = ring[:, 0]
            y = ring[:, 1]
            x_next = np.roll(x, -1)
            y_next = np.roll(y, -1)
            cross = x * y_next - x_next * y
            signed_area = 0.5 * float(np.sum(cross))
            if abs(signed_area) > 1e-12:
                cx = float(np.sum((x + x_next) * cross)) / (6.0 * signed_area)
                cy = float(np.sum((y + y_next) * cross)) / (6.0 * signed_area)
                area_sum += signed_area
                cx_sum += cx * signed_area
                cy_sum += cy * signed_area
        if abs(area_sum) > 1e-12:
            cent = (cy_sum / area_sum, cx_sum / area_sum)  # (lat, lon)
        else:
            cent = (0.5 * (bymin + bymax), 0.5 * (bxmin + bxmax))

        shapes.append(((bxmin, bymin, bxmax, bymax), rings, cent))
    return shapes


def point_in_rings_even_odd(lon: float, lat: float, rings: List[np.ndarray]) -> bool:
    inside = False
    for ring in rings:
        x = ring[:, 0]
        y = ring[:, 1]
        x2 = np.roll(x, -1)
        y2 = np.roll(y, -1)
        cond_y = (y > lat) != (y2 > lat)
        if not np.any(cond_y):
            continue
        xi = x[cond_y]
        yi = y[cond_y]
        x2i = x2[cond_y]
        y2i = y2[cond_y]
        x_intersect = xi + (lat - yi) * (x2i - xi) / (y2i - yi)
        hits = int(np.sum(lon < x_intersect))
        if hits % 2 == 1:
            inside = not inside
    return inside


def build_western_divisions(shp_zip_path: Path):
    print('Parsing NOAA CONUS Climate Divisions shapefile...')
    with zipfile.ZipFile(shp_zip_path, 'r') as zf:
        dbf_name = [n for n in zf.namelist() if n.lower().endswith('.dbf')][0]
        shp_name = [n for n in zf.namelist() if n.lower().endswith('.shp')][0]
        dbf_records = parse_dbf_records(zf.read(dbf_name))
        shapes = polygon_centroid_and_rings(zf.read(shp_name))

    if len(dbf_records) != len(shapes):
        raise RuntimeError(f'DBF/SHP mismatch: {len(dbf_records)} vs {len(shapes)}')

    lat_hi = DIV_LAT_MIN + (DIV_ROWS - 1) * 0.5 + 0.5
    lat_lo = DIV_LAT_MIN - 0.5
    lon_lo = DIV_LON_MIN - 0.5
    lon_hi = DIV_LON_MIN + (DIV_COLS - 1) * 0.5 + 0.5

    kept_by_id: Dict[int, dict] = {}
    for rec, (bbox, rings, cent) in zip(dbf_records, shapes):
        if not rings:
            continue
        bxmin, bymin, bxmax, bymax = bbox
        if bxmax < lon_lo or bxmin > lon_hi or bymax < lat_lo or bymin > lat_hi:
            continue
        div_id = int(rec['CLIMDIV'])
        if div_id in kept_by_id:
            kept_by_id[div_id]['rings'].extend(rings)
            ob = kept_by_id[div_id]['bbox']
            kept_by_id[div_id]['bbox'] = (
                min(ob[0], bxmin),
                min(ob[1], bymin),
                max(ob[2], bxmax),
                max(ob[3], bymax),
            )
        else:
            kept_by_id[div_id] = {
                'div_id': div_id,
                'name': f"{rec.get('ST_ABBRV', '')} {rec.get('NAME', '')}".strip(),
                'bbox': bbox,
                'rings': list(rings),
                'cent': cent,
            }

    kept = [kept_by_id[k] for k in sorted(kept_by_id.keys())]
    if len(kept) > 254:
        raise RuntimeError(f'Too many western divisions ({len(kept)} > 254) for Uint8 indexing')
    print(f'  Kept {len(kept)} Western US climate divisions.')

    div_map = np.full((DIV_ROWS, DIV_COLS), 255, dtype=np.uint8)
    for r in range(DIV_ROWS):
        lat = DIV_LAT_MIN + r * 0.5
        for c in range(DIV_COLS):
            lon = DIV_LON_MIN + c * 0.5
            matched_idx: Optional[int] = None
            for idx, div in enumerate(kept):
                bxmin, bymin, bxmax, bymax = div['bbox']
                if bxmin <= lon <= bxmax and bymin <= lat <= bymax:
                    if point_in_rings_even_odd(lon, lat, div['rings']):
                        matched_idx = idx
                        break
            if matched_idx is None:
                # Near-coast fallback: nearest polygon vertex within 0.60 deg
                best_d2 = 0.60 * 0.60
                best_idx: Optional[int] = None
                for idx, div in enumerate(kept):
                    bxmin, bymin, bxmax, bymax = div['bbox']
                    if lon < bxmin - 0.65 or lon > bxmax + 0.65 or lat < bymin - 0.65 or lat > bymax + 0.65:
                        continue
                    for ring in div['rings']:
                        d2 = np.min((ring[:, 0] - lon) ** 2 + (ring[:, 1] - lat) ** 2)
                        if d2 < best_d2:
                            best_d2 = float(d2)
                            best_idx = idx
                matched_idx = best_idx
            if matched_idx is not None:
                div_map[r, c] = matched_idx

    assigned = int(np.sum(div_map != 255))
    print(f'  divMap assigned {assigned}/{DIV_ROWS * DIV_COLS} grid cells ({100.0 * assigned / (DIV_ROWS * DIV_COLS):.1f}%).')
    return kept, div_map


def parse_climdiv_series(
    filepath: Path,
    kept_div_ids: set[int],
    missing_below: float,
) -> Dict[int, Dict[int, List[Optional[float]]]]:
    """Parses NOAA nClimDiv flat text file into div_id -> year -> [12 monthly values]."""
    out: Dict[int, Dict[int, List[Optional[float]]]] = {}
    with open(filepath, 'r', encoding='ascii', errors='ignore') as f:
        for line in f:
            if len(line) < 20:
                continue
            try:
                div_id = int(line[0:4])
            except ValueError:
                continue
            if div_id not in kept_div_ids:
                continue
            try:
                year = int(line[6:10])
            except ValueError:
                continue
            if year < NCLIM_START or year > BASE_END:
                continue
            tokens = line[10:].split()
            if len(tokens) < 12:
                continue
            vals: List[Optional[float]] = []
            for tok in tokens[:12]:
                v = float(tok)
                vals.append(None if v <= missing_below else v)
            out.setdefault(div_id, {})[year] = vals
    return out


def build_nclimdiv_arrays(
    kept_divs: List[dict],
    tmpc_path: Path,
    pcpn_path: Path,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    print('Parsing NOAA nClimDiv monthly temperature & precipitation...')
    kept_ids = {d['div_id'] for d in kept_divs}
    tmp_raw = parse_climdiv_series(tmpc_path, kept_ids, missing_below=-90.0)
    pcp_raw = parse_climdiv_series(pcpn_path, kept_ids, missing_below=-0.001)

    n_divs = len(kept_divs)
    n_years = NCLIM_END - NCLIM_START + 1
    temp_anom_q = np.full((n_divs, n_years, 12), -128, dtype=np.int8)
    precip_log_q = np.full((n_divs, n_years, 12), -128, dtype=np.int8)
    base_p_mm_by_div = np.zeros((n_divs, 12), dtype=np.float64)

    for idx, div in enumerate(kept_divs):
        did = div['div_id']
        t_years = tmp_raw.get(did, {})
        p_years = pcp_raw.get(did, {})

        # Compute 1981..2020 baseline monthly means
        base_t_f = np.zeros(12, dtype=np.float64)
        base_p_mm = np.zeros(12, dtype=np.float64)
        for m in range(12):
            t_samples = [
                t_years[y][m]
                for y in range(BASE_START, BASE_END + 1)
                if y in t_years and t_years[y][m] is not None
            ]
            p_samples = [
                p_years[y][m] * 25.4
                for y in range(BASE_START, BASE_END + 1)
                if y in p_years and p_years[y][m] is not None
            ]
            base_t_f[m] = float(np.mean(t_samples)) if t_samples else float('nan')
            base_p_mm[m] = float(np.mean(p_samples)) if p_samples else float('nan')
        base_p_mm_by_div[idx] = np.nan_to_num(base_p_mm, nan=1.0)

        for y in range(NCLIM_START, NCLIM_END + 1):
            yi = y - NCLIM_START
            ty = t_years.get(y)
            py = p_years.get(y)
            for m in range(12):
                if ty is not None and ty[m] is not None and not math.isnan(base_t_f[m]):
                    dt_c = (ty[m] - base_t_f[m]) * (5.0 / 9.0)
                    q = int(round(max(-12.7, min(12.7, dt_c)) * 10.0))
                    temp_anom_q[idx, yi, m] = max(-127, min(127, q))
                if py is not None and py[m] is not None and not math.isnan(base_p_mm[m]):
                    p_mm = max(0.0, py[m] * 25.4)
                    lr = math.log((p_mm + 1.5) / (base_p_mm[m] + 1.5))
                    q = int(round(max(-2.54, min(2.54, lr)) * 50.0))
                    precip_log_q[idx, yi, m] = max(-127, min(127, q))

    return temp_anom_q, precip_log_q, base_p_mm_by_div


def build_lbda_arrays(lbda_path: Path) -> Tuple[np.ndarray, np.ndarray]:
    print('Parsing LBDA v2 JJA PMDI reconstruction (1200-1894)...')
    n_years = LBDA_END - LBDA_START + 1
    sums = np.zeros((PALEO_ROWS, PALEO_COLS, n_years), dtype=np.float64)
    counts = np.zeros((PALEO_ROWS, PALEO_COLS, n_years), dtype=np.int32)

    with open(lbda_path, 'r', encoding='ascii', errors='ignore') as f:
        lat_toks = f.readline().split()[1:]
        lon_toks = f.readline().split()[1:]
        col_bins: List[Tuple[int, int, int]] = []
        for idx, (la_s, lo_s) in enumerate(zip(lat_toks, lon_toks)):
            la = float(la_s)
            lo = float(lo_s)
            r = math.floor(la - 30.0)
            c = math.floor(lo - (-126.0))
            if 0 <= r < PALEO_ROWS and 0 <= c < PALEO_COLS:
                col_bins.append((idx + 1, r, c))  # +1 skips year col

        for line in f:
            if not line.strip():
                continue
            head_end = line.find(' ')
            if head_end < 0:
                continue
            yr = int(line[:head_end])
            if yr < LBDA_START:
                continue
            if yr > LBDA_END:
                break
            yi = yr - LBDA_START
            toks = line.split()
            for tok_idx, r, c in col_bins:
                s = toks[tok_idx]
                if s != 'NA' and s != 'NaN':
                    v = float(s)
                    if not math.isnan(v):
                        sums[r, c, yi] += v
                        counts[r, c, yi] += 1

    cell_map = np.full((PALEO_ROWS, PALEO_COLS), -1, dtype=np.int16)
    cell_series: List[np.ndarray] = []
    for r in range(PALEO_ROWS):
        for c in range(PALEO_COLS):
            valid_years = int(np.sum(counts[r, c] > 0))
            if valid_years >= int(0.5 * n_years):
                cell_idx = len(cell_series)
                cell_map[r, c] = cell_idx
                arr = np.full(n_years, -128, dtype=np.int8)
                for yi in range(n_years):
                    cnt = counts[r, c, yi]
                    if cnt > 0:
                        val = sums[r, c, yi] / cnt
                        q = int(round(max(-12.7, min(12.7, val)) * 10.0))
                        arr[yi] = max(-127, min(127, q))
                cell_series.append(arr)

    packed = np.vstack(cell_series) if cell_series else np.zeros((0, n_years), dtype=np.int8)
    print(f'  LBDA v2 kept {len(cell_series)}/{PALEO_ROWS * PALEO_COLS} 1.0 deg cells.')
    return cell_map, packed


def build_wnata_arrays(
    gridcells_path: Path,
    wnata_path: Path,
) -> Tuple[np.ndarray, np.ndarray]:
    print('Parsing King et al. 2024 WNATA JJA Tmax reconstruction (1553-1894, aligned to 1981-2020)...')
    gp_coords: Dict[str, Tuple[int, int]] = {}
    with open(gridcells_path, 'r', encoding='utf-8', errors='ignore') as f:
        header_seen = False
        for line in f:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            if not header_seen:
                header_seen = True
                continue
            toks = s.split()
            gp_id = toks[0]
            lat = float(toks[1])
            lon = float(toks[2])
            r = math.floor(lat - 30.0)
            c = math.floor(lon - (-126.0))
            if 0 <= r < PALEO_ROWS and 0 <= c < PALEO_COLS:
                gp_coords[gp_id] = (r, c)

    total_span = BASE_END - WNATA_START + 1  # 1553..2020
    sums = np.zeros((PALEO_ROWS, PALEO_COLS, total_span), dtype=np.float64)
    counts = np.zeros((PALEO_ROWS, PALEO_COLS, total_span), dtype=np.int32)

    with open(wnata_path, 'r', encoding='utf-8', errors='ignore') as f:
        col_bins: List[Tuple[int, int, int]] = []
        header_seen = False
        for line in f:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            toks = s.split()
            if not header_seen:
                header_seen = True
                for idx, col_id in enumerate(toks[1:], start=1):
                    rc = gp_coords.get(col_id)
                    if rc is not None:
                        col_bins.append((idx, rc[0], rc[1]))
                continue
            yr = int(float(toks[0]))
            if yr < WNATA_START or yr > BASE_END:
                continue
            yi = yr - WNATA_START
            for idx, r, c in col_bins:
                tok = toks[idx]
                if tok != 'NaN' and tok != 'NA':
                    v = float(tok)
                    if not math.isnan(v):
                        sums[r, c, yi] += v
                        counts[r, c, yi] += 1

    n_wnata_years = WNATA_END - WNATA_START + 1
    b0 = BASE_START - WNATA_START
    b1 = BASE_END - WNATA_START + 1

    cell_map = np.full((PALEO_ROWS, PALEO_COLS), -1, dtype=np.int16)
    cell_series: List[np.ndarray] = []
    for r in range(PALEO_ROWS):
        for c in range(PALEO_COLS):
            base_vals = [
                sums[r, c, yi] / counts[r, c, yi]
                for yi in range(b0, b1)
                if counts[r, c, yi] > 0
            ]
            if len(base_vals) < 10:
                continue
            valid_recon = int(np.sum(counts[r, c, :n_wnata_years] > 0))
            if valid_recon < int(0.5 * n_wnata_years):
                continue
            base_mean = float(np.mean(base_vals))
            cell_idx = len(cell_series)
            cell_map[r, c] = cell_idx
            arr = np.full(n_wnata_years, -128, dtype=np.int8)
            for yi in range(n_wnata_years):
                cnt = counts[r, c, yi]
                if cnt > 0:
                    dt = (sums[r, c, yi] / cnt) - base_mean
                    q = int(round(max(-6.35, min(6.35, dt)) * 20.0))
                    arr[yi] = max(-127, min(127, q))
            cell_series.append(arr)

    packed = np.vstack(cell_series) if cell_series else np.zeros((0, n_wnata_years), dtype=np.int8)
    print(f'  WNATA kept {len(cell_series)}/{PALEO_ROWS * PALEO_COLS} 1.0 deg cells.')
    return cell_map, packed


def build_ntrend_array(ntrend_path: Path) -> np.ndarray:
    print('Parsing Wilson et al. 2016 N-TREND MJJA temperature reconstruction (1200-1552)...')
    by_year: Dict[int, float] = {}
    with open(ntrend_path, 'r', encoding='utf-8', errors='ignore') as f:
        header_seen = False
        for line in f:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            parts = line.rstrip('\r\n').split('\t')
            if not header_seen:
                header_seen = True
                continue
            yr = int(parts[0])
            if len(parts) > 1 and parts[1].strip():
                by_year[yr] = float(parts[1])

    base_vals = [by_year[y] for y in range(1981, 2012) if y in by_year]
    base_mean = float(np.mean(base_vals)) if base_vals else 0.0
    print(f'  N-TREND 1981-2011 baseline offset = {base_mean:+.3f} C (n={len(base_vals)})')

    n_years = NTREND_END - NTREND_START + 1
    arr = np.full(n_years, -128, dtype=np.int8)
    for y in range(NTREND_START, NTREND_END + 1):
        if y in by_year:
            dt = by_year[y] - base_mean
            q = int(round(max(-6.35, min(6.35, dt)) * 20.0))
            arr[y - NTREND_START] = max(-127, min(127, q))
    return arr


def build_volcanic_array(volc_path: Path) -> Tuple[np.ndarray, Dict[int, float]]:
    print('Parsing Crowley & Unterman 2013 ICI5 30-90N volcanic AOD (1200-2000)...')
    n_years = VOLC_END - VOLC_START + 1
    grow_max: Dict[int, float] = {}
    year_max: Dict[int, float] = {}

    with open(volc_path, 'r', encoding='ascii', errors='ignore') as f:
        for line in f:
            toks = line.split()
            if len(toks) < 2:
                continue
            dec_yr = float(toks[0])
            aod = float(toks[1])
            yr = int(math.floor(dec_yr))
            if yr < VOLC_START or yr > VOLC_END:
                continue
            frac = dec_yr - yr
            year_max[yr] = max(year_max.get(yr, 0.0), aod)
            if 0.25 <= frac <= 0.75:
                grow_max[yr] = max(grow_max.get(yr, 0.0), aod)

    arr = np.zeros(n_years, dtype=np.uint8)
    raw_by_year: Dict[int, float] = {}
    for y in range(VOLC_START, VOLC_END + 1):
        val = grow_max.get(y, year_max.get(y, 0.0))
        raw_by_year[y] = val
        q = int(round(max(0.0, min(0.51, val)) * 500.0))
        arr[y - VOLC_START] = max(0, min(255, q))
    return arr, raw_by_year


def write_volcanic_ts(raw_by_year: Dict[int, float]) -> None:
    sig_entries = [
        (y, round(aod, 4))
        for y, aod in sorted(raw_by_year.items())
        if aod >= 0.03
    ]
    lines = [
        '/**',
        ' * Auto-generated from Crowley & Unterman (2013) ice-core stratospheric',
        ' * volcanic aerosol optical depth (ICI5 30-90N, Apr-Sep peak, 1200-2000 CE).',
        ' * Regenerate via: python scripts/build_climate_atlas.py',
        ' */',
        'export const CROWLEY_VOLCANIC_AOD_NH: Readonly<Record<number, number>> = {',
    ]
    for i in range(0, len(sig_entries), 6):
        chunk = sig_entries[i : i + 6]
        lines.append('  ' + ', '.join(f'{y}: {val:.4f}' for y, val in chunk) + ',')
    lines.extend([
        '};',
        '',
        '/**',
        ' * Returns Northern-Hemisphere or attenuated Southern-Hemisphere peak growing-season',
        ' * stratospheric aerosol optical depth (SAOD at 550nm) for the given calendar year.',
        ' */',
        'export function getVolcanicAod(year: number, latitude: number): number {',
        '  const aodNh = CROWLEY_VOLCANIC_AOD_NH[year] ?? 0;',
        '  if (aodNh <= 0) return 0;',
        '  if (latitude >= 0) return aodNh;',
        '  // High-latitude NH eruptions (e.g. 1783 Laki) barely cross the equator;',
        '  // only strong tropical/bipolar events retain partial SH forcing.',
        '  return aodNh >= 0.18 ? Number((aodNh * 0.55).toFixed(4)) : 0;',
        '}',
        '',
    ])
    OUT_VOLC_TS.write_text('\n'.join(lines), encoding='utf-8')
    print(f'  Wrote {OUT_VOLC_TS} ({len(sig_entries)} significant volcanic years >= 0.03 AOD).')


def write_binary_atlas(
    kept_divs: List[dict],
    div_map: np.ndarray,
    nclim_temp: np.ndarray,
    nclim_precip: np.ndarray,
    lbda_cell_map: np.ndarray,
    lbda_pmdi: np.ndarray,
    wnata_cell_map: np.ndarray,
    wnata_temp: np.ndarray,
    ntrend_temp: np.ndarray,
    volc_aod: np.ndarray,
) -> None:
    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)

    # Explicit 64-byte little-endian header matching src/services/climateAtlas.ts:
    # 0..3: 'XYCA' (4s)
    # 4..7: version (H), flags (H)
    # 8..51: 22 x 16-bit fields (exact layout)
    # 52..63: 3 x uint32 reserved = 0
    header = struct.pack(
        '<4sHH'
        'hhHHHhh'
        'hhHHHh'
        'hHhh'
        'hhhhH'
        'III',
        b'XYCA',
        1,
        0,
        NCLIM_START,
        NCLIM_END,
        len(kept_divs),
        DIV_ROWS,
        DIV_COLS,
        int(round(DIV_LAT_MIN * 10)),
        int(round(DIV_LON_MIN * 10)),
        int(round(PALEO_LAT_MIN * 10)),
        int(round(PALEO_LON_MIN * 10)),
        PALEO_ROWS,
        PALEO_COLS,
        lbda_pmdi.shape[0],
        LBDA_START,
        LBDA_END,
        wnata_temp.shape[0],
        WNATA_START,
        WNATA_END,
        NTREND_START,
        NTREND_END,
        VOLC_START,
        VOLC_END,
        0,
        0,
        0,
        0,
    )
    assert len(header) == 64, f'Header length must be 64, got {len(header)}'

    div_ids = np.array([d['div_id'] for d in kept_divs], dtype='<u2')
    div_cent_lat = np.array([int(round(d['cent'][0] * 100)) for d in kept_divs], dtype='<i2')
    div_cent_lon = np.array([int(round(d['cent'][1] * 100)) for d in kept_divs], dtype='<i2')

    with open(OUT_BIN, 'wb') as f:
        f.write(header)
        # All 16-bit arrays first (2-byte aligned throughout)
        f.write(div_ids.tobytes())
        f.write(div_cent_lat.tobytes())
        f.write(div_cent_lon.tobytes())
        f.write(lbda_cell_map.astype('<i2').tobytes())
        f.write(wnata_cell_map.astype('<i2').tobytes())
        # All 8-bit arrays second
        f.write(div_map.astype(np.uint8).tobytes())
        f.write(nclim_temp.astype(np.int8).tobytes())
        f.write(nclim_precip.astype(np.int8).tobytes())
        f.write(lbda_pmdi.astype(np.int8).tobytes())
        f.write(wnata_temp.astype(np.int8).tobytes())
        f.write(ntrend_temp.astype(np.int8).tobytes())
        f.write(volc_aod.astype(np.uint8).tobytes())

    raw_bytes = OUT_BIN.read_bytes()
    gz_len = len(gzip.compress(raw_bytes, compresslevel=9))
    print(f'  Wrote {OUT_BIN}: {len(raw_bytes):,} bytes raw ({gz_len:,} bytes gzipped).')
    assert len(raw_bytes) < 800_000, f'Raw atlas too large: {len(raw_bytes)}'
    assert gz_len < 600_000, f'Gzipped atlas too large: {gz_len}'


def sanity_check(
    kept_divs: List[dict],
    div_map: np.ndarray,
    nclim_temp: np.ndarray,
    nclim_precip: np.ndarray,
    base_p_mm_by_div: np.ndarray,
    lbda_cell_map: np.ndarray,
    lbda_pmdi: np.ndarray,
    wnata_cell_map: np.ndarray,
    wnata_temp: np.ndarray,
    volc_aod: np.ndarray,
) -> None:
    print('\n=== SANITY CHECKS ===')

    def lookup_div(lat: float, lon: float):
        r = int(round((lat - DIV_LAT_MIN) / 0.5))
        c = int(round((lon - DIV_LON_MIN) / 0.5))
        d_idx = int(div_map[r, c])
        assert d_idx != 255, f'Expected valid division at ({lat}, {lon})'
        return d_idx, kept_divs[d_idx]

    def lookup_paleo_nn(lat: float, lon: float):
        r = max(0, min(PALEO_ROWS - 1, math.floor(lat - 30.0)))
        c = max(0, min(PALEO_COLS - 1, math.floor(lon - (-126.0))))
        return int(lbda_cell_map[r, c]), int(wnata_cell_map[r, c])

    def annual_precip_ratio(d_idx: int, year: int) -> float:
        weights = base_p_mm_by_div[d_idx]
        num = 0.0
        den = 0.0
        for m in range(12):
            q = int(nclim_precip[d_idx, year - NCLIM_START, m])
            if q != -128:
                num += math.exp(q / 50.0) * float(weights[m])
                den += float(weights[m])
        return num / max(1e-6, den)

    # 1. Flagstaff, AZ (35.2645, -111.7442)
    az_idx, az_div = lookup_div(35.2645, -111.7442)
    pluvial_p = [annual_precip_ratio(az_idx, y) for y in range(1905, 1920)]
    p1934 = annual_precip_ratio(az_idx, 1934)
    p1956 = annual_precip_ratio(az_idx, 1956)
    t1934 = float(np.mean([float(nclim_temp[az_idx, 1934 - NCLIM_START, m]) / 10.0 for m in range(12)]))
    az_lbda_c, az_wn_c = lookup_paleo_nn(35.2645, -111.7442)
    pmdi_1580s = float(np.mean([lbda_pmdi[az_lbda_c, y - LBDA_START] / 10.0 for y in range(1579, 1588)]))
    aod_1816 = float(volc_aod[1816 - VOLC_START]) / 500.0
    print(f'  Flagstaff div={az_div["div_id"]} ({az_div["name"]}):')
    print(f'    1905-1919 annual precip ratio={np.mean(pluvial_p):.3f}, 1934={p1934:.3f} (dT={t1934:+.2f}C), 1956={p1956:.3f}')
    print(f'    1579-1587 LBDA PMDI={pmdi_1580s:.2f}, 1816 AOD={aod_1816:.3f}')
    assert np.mean(pluvial_p) > 1.05
    assert p1934 < 0.90 and t1934 > 0.4
    assert p1956 < 0.80
    assert pmdi_1580s < -1.0
    assert aod_1816 > 0.25

    # 2. H.J. Andrews vs Metolius OR
    hja_idx, hja_div = lookup_div(44.2124, -122.2557)
    met_idx, met_div = lookup_div(44.4622, -121.6358)
    wy_num = 0.0
    wy_den = 0.0
    for y_off, months in [(1976, range(9, 12)), (1977, range(0, 9))]:
        for m in months:
            q = int(nclim_precip[hja_idx, y_off - NCLIM_START, m])
            if q != -128:
                wy_num += math.exp(q / 50.0) * float(base_p_mm_by_div[hja_idx, m])
                wy_den += float(base_p_mm_by_div[hja_idx, m])
    wy1977_hja = wy_num / max(1e-6, wy_den)
    print(f'  H.J. Andrews div={hja_div["div_id"]} ({hja_div["name"]}) vs Metolius div={met_div["div_id"]} ({met_div["name"]})')
    print(f'    H.J. Andrews Water-Year 1977 (Oct76-Sep77) precip ratio={wy1977_hja:.3f}')
    assert hja_div['div_id'] != met_div['div_id'], 'Cascades West vs East must map to distinct climate divisions'
    assert wy1977_hja < 0.75, f'Expected dry WY1977 at H.J. Andrews, got {wy1977_hja:.3f}'

    # 3. White Mountains CA & Bitterroot MT
    for label, lat, lon in [('White Mts CA', 37.3855, -118.1788), ('Bitterroot MT', 46.1294, -114.2531)]:
        d_idx, d_info = lookup_div(lat, lon)
        lc, wc = lookup_paleo_nn(lat, lon)
        assert lc >= 0 and wc >= 0, f'Missing paleo cell for {label}'
        t1816 = float(wnata_temp[wc, 1816 - WNATA_START]) / 20.0
        print(f'  {label}: div={d_info["div_id"]} ({d_info["name"]}), lbdaCell={lc}, wnataCell={wc}, 1816 WNATA dT={t1816:+.2f}C')

    print('All sanity checks PASSED!')


def main() -> None:
    print('Resolving NOAA NCEI datasets...')
    tmpc_name, pcpn_name = resolve_latest_climdiv_files()
    base_climdiv = 'https://www.ncei.noaa.gov/pub/data/cirs/climdiv/'

    shp_zip = download_cached(base_climdiv + 'CONUS_CLIMATE_DIVISIONS.shp.zip', 'CONUS_CLIMATE_DIVISIONS.shp.zip')
    tmpc_path = download_cached(base_climdiv + tmpc_name, tmpc_name)
    pcpn_path = download_cached(base_climdiv + pcpn_name, pcpn_name)
    lbda_path = download_cached(
        'https://www.ncei.noaa.gov/pub/data/paleo/drought/LBDP-v2/lbda-v2_pmdi_kddm_rowyears_2017.txt',
        'lbda-v2_pmdi_kddm_rowyears_2017.txt',
        timeout=180,
    )
    wnata_grid_path = download_cached(
        'https://www.ncei.noaa.gov/pub/data/paleo/treering/reconstructions/northamerica/king2024/king2024-WNATA-gridcells.txt',
        'king2024-WNATA-gridcells.txt',
    )
    wnata_path = download_cached(
        'https://www.ncei.noaa.gov/pub/data/paleo/treering/reconstructions/northamerica/king2024/king2024-WNATA.txt',
        'king2024-WNATA.txt',
    )
    ntrend_path = download_cached(
        'https://www.ncei.noaa.gov/pub/data/paleo/treering/reconstructions/n_hem_temp/ntrend2015-noaa.txt',
        'ntrend2015-noaa.txt',
    )
    volc_path = download_cached(
        'https://www.ncei.noaa.gov/pub/data/paleo/climate_forcing/volcanic_aerosols/crowley2013/ICI5_3090N_AOD_c.txt',
        'ICI5_3090N_AOD_c.txt',
    )

    kept_divs, div_map = build_western_divisions(shp_zip)
    nclim_temp, nclim_precip, base_p_mm_by_div = build_nclimdiv_arrays(kept_divs, tmpc_path, pcpn_path)
    lbda_cell_map, lbda_pmdi = build_lbda_arrays(lbda_path)
    wnata_cell_map, wnata_temp = build_wnata_arrays(wnata_grid_path, wnata_path)
    ntrend_temp = build_ntrend_array(ntrend_path)
    volc_aod, raw_volc = build_volcanic_array(volc_path)

    write_volcanic_ts(raw_volc)
    write_binary_atlas(
        kept_divs,
        div_map,
        nclim_temp,
        nclim_precip,
        lbda_cell_map,
        lbda_pmdi,
        wnata_cell_map,
        wnata_temp,
        ntrend_temp,
        volc_aod,
    )
    sanity_check(
        kept_divs,
        div_map,
        nclim_temp,
        nclim_precip,
        base_p_mm_by_div,
        lbda_cell_map,
        lbda_pmdi,
        wnata_cell_map,
        wnata_temp,
        volc_aod,
    )


if __name__ == '__main__':
    main()

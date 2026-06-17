import { Range, Chiku } from './tables';

// WGS84 ellipsoid
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;

// Bessel 1841 ellipsoid (Tokyo Datum / EPSG:4301)
const BESSEL_A = 6377397.155;
const BESSEL_F = 1 / 299.1528128;

// Simplified Molodensky datum shift (lon/lat in degrees, returns [lon, lat])
function molodensky(
  lonDeg: number,
  latDeg: number,
  dx: number,
  dy: number,
  dz: number,
  srcA: number,
  srcF: number,
  tgtA: number,
  tgtF: number
): [number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const srcE2 = 2 * srcF - srcF * srcF;
  const da = tgtA - srcA;
  const df = tgtF - srcF;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const W = Math.sqrt(1 - srcE2 * sinLat * sinLat);
  const N = srcA / W;
  const M = (srcA * (1 - srcE2)) / (W * W * W);
  const dLat =
    (-dx * sinLat * cosLon -
      dy * sinLat * sinLon +
      dz * cosLat +
      (srcA * df + srcF * da) * Math.sin(2 * lat)) /
    M;
  const dLon = (-dx * sinLon + dy * cosLon) / (N * cosLat);
  return [lonDeg + (dLon * 180) / Math.PI, latDeg + (dLat * 180) / Math.PI];
}

// WGS84 (EPSG:4326) → Tokyo Datum (EPSG:4301)
function wgs84ToTokyo(lon: number, lat: number): [number, number] {
  // towgs84=-148,507,685 means Tokyo→WGS84 shift is (-148,507,685),
  // so WGS84→Tokyo shift is the inverse: (148,-507,-685)
  return molodensky(
    lon,
    lat,
    148,
    -507,
    -685,
    WGS84_A,
    WGS84_F,
    BESSEL_A,
    BESSEL_F
  );
}

// Tokyo Datum (EPSG:4301) → WGS84 (EPSG:4326)
function tokyoToWgs84(lon: number, lat: number): [number, number] {
  return molodensky(
    lon,
    lat,
    -148,
    507,
    685,
    BESSEL_A,
    BESSEL_F,
    WGS84_A,
    WGS84_F
  );
}

// DMS string ("deg/min/sec.ms") or decimal number → decimal degrees
function dmsToDecimal(v: string | number): number {
  if (typeof v === 'number') return v;
  const parts = String(v).trim().split('/');
  if (parts.length >= 3) {
    const deg = Number(parts[0]);
    const min = Number(parts[1]);
    const sec = Number(parts[2]);
    if ([deg, min, sec].some(x => !Number.isFinite(x))) return NaN;
    return deg + min / 60 + sec / 3600;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const CMC_FORWARD = [5, 6, 7, 8, 0, 1, 2, 3, 4];
const CMC_REVERSE = [4, 5, 6, 7, 8, 0, 1, 2, 3];

export function encodeMapCode(
  lat: number,
  lon: number,
  flg = 9
): string | null {
  if (lat == null || lon == null) return null;

  [lon, lat] = wgs84ToTokyo(lon, lat);

  // All arithmetic in integer milliseconds (thousandths of arc-seconds), floor-truncated
  const lon_ms = Math.floor(lon * 3_600_000);
  const lat_ms = Math.floor(lat * 3_600_000);

  let Zn = -1;
  let matchedIdx = -1;
  for (let cnt = 0; cnt < Range.Area.length; cnt++) {
    const e = Range.Area[cnt];
    if (
      e[1] * 1000 <= lon_ms &&
      lon_ms <= e[3] * 1000 &&
      e[2] * 1000 <= lat_ms &&
      lat_ms <= e[4] * 1000
    ) {
      Zn = e[0];
      matchedIdx = cnt;
      break;
    }
  }
  if (matchedIdx === -1) return null;

  const e = Range.Area[matchedIdx];
  const o_k_ms = lon_ms - e[1] * 1000;
  const o_i_ms = lat_ms - e[2] * 1000;

  const bn_k = Math.floor(o_k_ms / 30_000);
  const bn_i = Math.floor(o_i_ms / 30_000);
  const un_k = Math.floor(o_k_ms / 1000) % 30;
  const un_i = Math.floor(o_i_ms / 1000) % 30;

  const Bn = bn_i * 30 + bn_k;
  const Un = un_i * 30 + un_k;
  const MC = Zn * 1_000_000 + Bn * 1000 + Un;

  let CMC: string | null = null;
  if (flg === 3 || flg === 9) {
    const frac_k = o_k_ms % 1000;
    const frac_i = o_i_ms % 1000;

    const cn_k = Math.floor((frac_k * 3) / 1000);
    const cn_i = Math.floor((frac_i * 3) / 1000);
    const csn_k = Math.floor((((frac_k * 3) % 1000) * 3) / 1000);
    const csn_i = Math.floor((((frac_i * 3) % 1000) * 3) / 1000);

    const Cn = cn_i * 3 + cn_k;
    const Csn = csn_i * 3 + csn_k;

    const Cnc = CMC_FORWARD[Cn];
    const Csnc = CMC_FORWARD[Csn];

    CMC = flg === 3 ? String(Cnc) : String(Cnc) + String(Csnc);
  }

  const Un2 = MC % 1000;
  const wk = Math.floor(MC / 1000);
  const Bn2 = wk % 1000;
  const Zn2 = Math.floor(wk / 1000);

  const pad3 = (n: number) => String(n).padStart(3, '0');
  let mapcode =
    Zn2 > 0 ? `${Zn2} ${pad3(Bn2)} ${pad3(Un2)}` : `${Bn2} ${pad3(Un2)}`;
  if (CMC != null) mapcode += `*${CMC}`;

  return mapcode;
}

export function decodeMapCode(
  mapcode: string
): { lon: number; lat: number } | null {
  const parts = mapcode.split('*');
  if (parts.length > 2) return null;
  const [standardPartRaw, cmcPartRaw] = parts;
  const standardDigits = standardPartRaw.replace(/\s+/g, '');
  if (!/^\d+$/.test(standardDigits)) return null;
  const MC = Number.parseInt(standardDigits, 10);
  const CMC = cmcPartRaw != null ? cmcPartRaw.trim() : null;
  if (CMC != null && !/^\d{1,2}$/.test(CMC)) return null;

  const wk = Math.floor(MC / 1000);
  const Zn = Math.floor(wk / 1000);
  const Un = MC % 1000;
  const Bn = wk % 1000;

  let Lon_ms = 0;
  let Lat_ms = 0;
  if (CMC) {
    const Cnc = parseInt(CMC[0], 10);
    const Csnc = CMC.length === 2 ? parseInt(CMC[1], 10) : 0;
    const Cn = CMC_REVERSE[Cnc];
    const Csn = CMC_REVERSE[Csnc];

    // floor((Cn%3)/3 + (Csn%3)/9) * 1000 = floor(((Cn%3)*3 + (Csn%3)) * 1000/9)
    Lon_ms = Math.floor((((Cn % 3) * 3 + (Csn % 3)) * 1000) / 9);
    Lat_ms = Math.floor(
      ((Math.floor(Cn / 3) * 3 + Math.floor(Csn / 3)) * 1000) / 9
    );
  }

  for (let i = 0; i < Chiku.Area.length; i++) {
    const area = Chiku.Area[i];
    if (area[0] !== Zn) continue;

    const divisor = area[1];

    let sec =
      area[2] * 3600 +
      area[3] * 60 +
      area[4] +
      ((Bn % divisor) * 30 + (Un % 30));
    const lonH = Math.floor(sec / 3600);
    const lonS = sec % 60;
    const lonM = Math.floor(((sec - lonS) % 3600) / 60);
    const lonDms = `${lonH}/${String(lonM).padStart(2, '0')}/${String(lonS).padStart(2, '0')}.${String(Lon_ms).padStart(3, '0')}`;

    sec =
      area[5] * 3600 +
      area[6] * 60 +
      area[7] +
      (Math.floor(Bn / divisor) * 30 + Math.floor(Un / 30));
    const latH = Math.floor(sec / 3600);
    const latS = sec % 60;
    const latM = Math.floor(((sec - latS) % 3600) / 60);
    const latDms = `${latH}/${String(latM).padStart(2, '0')}/${String(latS).padStart(2, '0')}.${String(Lat_ms).padStart(3, '0')}`;

    const tkyLon = dmsToDecimal(lonDms);
    const tkyLat = dmsToDecimal(latDms);
    if (!Number.isFinite(tkyLon) || !Number.isFinite(tkyLat)) return null;

    const [wgsLon, wgsLat] = tokyoToWgs84(tkyLon, tkyLat);
    if (!Number.isFinite(wgsLon) || !Number.isFinite(wgsLat)) return null;
    return { lon: wgsLon, lat: wgsLat };
  }

  return null;
}

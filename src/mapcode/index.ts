import Decimal from 'decimal.js';
import proj4 from 'proj4';
import { Range, Chiku } from './tables';

proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');
proj4.defs('EPSG:4301', '+proj=longlat +ellps=bessel +towgs84=-148,507,685 +no_defs');

const SOURCE_DATUM = 'EPSG:4326';
const TARGET_DATUM = 'EPSG:4301';

const CMC_FORWARD = [5, 6, 7, 8, 0, 1, 2, 3, 4];
const CMC_REVERSE = [4, 5, 6, 7, 8, 0, 1, 2, 3];

function toSeconds(coord: number | string | Decimal): Decimal | null {
  if (Decimal.isDecimal(coord)) {
    return (coord as Decimal).toDecimalPlaces(3, Decimal.ROUND_FLOOR);
  }
  if (typeof coord === 'number') {
    return new Decimal(coord).times(3600).toDecimalPlaces(3, Decimal.ROUND_FLOOR);
  }
  if (typeof coord === 'string') {
    if (coord.includes('/')) {
      const parts = coord.split('/');
      if (parts.length === 3) {
        const deg = new Decimal(parts[0]);
        const min = new Decimal(parts[1]);
        const sec = new Decimal(parts[2]);
        return deg.times(3600).plus(min.times(60)).plus(sec).toDecimalPlaces(3, Decimal.ROUND_FLOOR);
      }
    }
    const num = Number(coord);
    if (!Number.isNaN(num)) {
      return new Decimal(num).times(3600).toDecimalPlaces(3, Decimal.ROUND_FLOOR);
    }
  }
  return null;
}

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

export function fetchMapCode(lat: number, lon: number, flg = 9): string | null {
  if (lat == null || lon == null) return null;

  try {
    const [txLon, txLat] = proj4(SOURCE_DATUM, TARGET_DATUM, [lon, lat]);
    lon = txLon;
    lat = txLat;
  } catch {
    // keep original coords on proj4 failure
  }

  const lon_sec = toSeconds(lon);
  const lat_sec = toSeconds(lat);
  if (!lon_sec || !lat_sec) return null;

  let Zn = -1;
  let matchedIdx = -1;
  for (let cnt = 0; cnt < Range.Area.length; cnt++) {
    const entry = Range.Area[cnt];
    const rLonStart = new Decimal(entry[1]);
    const rLonEnd = new Decimal(entry[3]);
    const rLatStart = new Decimal(entry[2]);
    const rLatEnd = new Decimal(entry[4]);

    if (
      rLonStart.lte(lon_sec) && lon_sec.lte(rLonEnd) &&
      rLatStart.lte(lat_sec) && lat_sec.lte(rLatEnd)
    ) {
      Zn = entry[0];
      matchedIdx = cnt;
      break;
    }
  }
  if (Zn === -1 || matchedIdx === -1) return null;

  const entry = Range.Area[matchedIdx];
  const o_k = lon_sec.minus(new Decimal(entry[1]));
  const o_i = lat_sec.minus(new Decimal(entry[2]));

  const bn_k = o_k.dividedBy(30).floor().toNumber();
  const bn_i = o_i.dividedBy(30).floor().toNumber();

  const un_k = o_k.floor().minus(new Decimal(bn_k).times(30)).toNumber();
  const un_i = o_i.floor().minus(new Decimal(bn_i).times(30)).toNumber();

  const Bn = bn_i * 30 + bn_k;
  const Un = un_i * 30 + un_k;
  const MC = Zn * 1000000 + Bn * 1000 + Un;

  let CMC: string | null = null;
  if (flg === 3 || flg === 9) {
    const int_o_k = o_k.floor();
    const int_o_i = o_i.floor();

    const cn_k = o_k.minus(int_o_k).times(3).floor().toNumber();
    const cn_i = o_i.minus(int_o_i).times(3).floor().toNumber();

    const csn_k = o_k.minus(int_o_k).times(3).minus(cn_k).times(3).floor().toNumber();
    const csn_i = o_i.minus(int_o_i).times(3).minus(cn_i).times(3).floor().toNumber();

    const Cn = cn_i * 3 + cn_k;
    const Csn = csn_i * 3 + csn_k;

    const Cnc = CMC_FORWARD[Cn];
    const Csnc = CMC_FORWARD[Csn];

    CMC = flg === 3 ? String(Cnc) : String(Cnc) + String(Csnc);
  }

  const Un2 = MC - Math.floor(MC / 1000) * 1000;
  const wk = Math.floor(MC / 1000);
  const Bn2 = wk - Math.floor(wk / 1000) * 1000;
  const Zn2 = Math.floor(wk / 1000);

  const pad3 = (n: number) => String(n).padStart(3, '0');
  let mapcode = Zn2 > 0 ? `${Zn2} ${pad3(Bn2)} ${pad3(Un2)}` : `${Bn2} ${pad3(Un2)}`;
  if (CMC != null) mapcode += `*${CMC}`;

  return mapcode;
}

export function getLonLat(mapcode: string): { lon: number; lat: number } | null {
  const [standardPart, cmcPart] = mapcode.split('*');
  const MC = parseInt(standardPart.replace(/ /g, ''), 10);
  const CMC = cmcPart ?? null;

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

    const onePer3 = new Decimal(1).dividedBy(3);
    const onePer9 = new Decimal(1).dividedBy(9);

    Lon_ms = onePer3.times(Cn % 3).plus(onePer9.times(Csn % 3)).times(1000).floor().toNumber();
    Lat_ms = onePer3.times(Math.floor(Cn / 3)).plus(onePer9.times(Math.floor(Csn / 3))).times(1000).floor().toNumber();
  }

  for (let i = 0; i < Chiku.Area.length; i++) {
    const area = Chiku.Area[i];
    if (area[0] !== Zn) continue;

    const divisor = area[1];

    let sec = area[2] * 3600 + area[3] * 60 + area[4] + ((Bn % divisor) * 30 + (Un % 30));
    const lonH = Math.floor(sec / 3600);
    const lonS = sec % 60;
    const lonM = Math.floor((sec - lonS) % 3600 / 60);
    const lonDms = `${lonH}/${String(lonM).padStart(2, '0')}/${String(lonS).padStart(2, '0')}.${Lon_ms}`;

    sec = area[5] * 3600 + area[6] * 60 + area[7] + (Math.floor(Bn / divisor) * 30 + Math.floor(Un / 30));
    const latH = Math.floor(sec / 3600);
    const latS = sec % 60;
    const latM = Math.floor((sec - latS) % 3600 / 60);
    const latDms = `${latH}/${String(latM).padStart(2, '0')}/${String(latS).padStart(2, '0')}.${Lat_ms}`;

    const tkyLon = dmsToDecimal(lonDms);
    const tkyLat = dmsToDecimal(latDms);
    if (!Number.isFinite(tkyLon) || !Number.isFinite(tkyLat)) return null;

    try {
      const [wgsLon, wgsLat] = proj4(TARGET_DATUM, SOURCE_DATUM, [tkyLon, tkyLat]);
      if (!Number.isFinite(wgsLon) || !Number.isFinite(wgsLat)) return null;
      return { lon: wgsLon, lat: wgsLat };
    } catch {
      return null;
    }
  }

  return null;
}

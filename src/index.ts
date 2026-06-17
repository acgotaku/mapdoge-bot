import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import { OpenLocationCode } from 'open-location-code';
import { encodeMapCode } from './mapcode';

const MAX_LAT = 46;
const MIN_LAT = 20;
const MAX_LNG = 153;
const MIN_LNG = 122;

const plusCodeRegex =
  /([23456789CFGHJMPQRVWX]{4}(?:[23456789CFGHJMPQRVWX]{2}){0,2}\+[23456789CFGHJMPQRVWX]{2,3})/;

const googleMapsUrlRegex =
  /https?:\/\/(?:maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+|(?:www\.)?google\.com\/maps\/\S+|maps\.google\.com\/\S+)/;

interface OLC {
  isFull(code: string): boolean;
  decode(code: string): { latitudeCenter: number; longitudeCenter: number };
  recoverNearest(code: string, refLat: number, refLng: number): string;
}
const olc = new OpenLocationCode() as unknown as OLC;

interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}

interface Location {
  lat: number;
  lng: number;
}

function isInJapan(loc: Location): boolean {
  return (
    loc.lat >= MIN_LAT &&
    loc.lat <= MAX_LAT &&
    loc.lng >= MIN_LNG &&
    loc.lng <= MAX_LNG
  );
}

function parseGoogleMapsCoords(url: string): Location | null {
  // Pin location takes priority (more precise than viewport center)
  const pinMatch = url.match(/3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (pinMatch) {
    return { lat: parseFloat(pinMatch[1]), lng: parseFloat(pinMatch[2]) };
  }
  // Fallback: viewport center @lat,lon,zoom
  const viewMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (viewMatch) {
    return { lat: parseFloat(viewMatch[1]), lng: parseFloat(viewMatch[2]) };
  }
  return null;
}

async function nominatimGeocode(query: string): Promise<Location | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'mapdoge-bot/1.0' } }
  );
  if (!res.ok) return null;
  const geo = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!geo.length) return null;
  return { lat: parseFloat(geo[0].lat), lng: parseFloat(geo[0].lon) };
}

async function resolveGoogleMapsUrl(url: string): Promise<Location> {
  const res = await fetch(url, { redirect: 'follow' });
  const finalUrl = res.url;

  const coords = parseGoogleMapsCoords(finalUrl);
  if (coords) return coords;

  // GPS-share URLs (entry=gps) redirect to ?q=PLACE,ADDRESS without coordinates.
  // Extract q=, normalize "7 Chome-2-18" → "7-2-18", then retry Nominatim
  // progressively skipping leading non-address parts (place name, building, etc.).
  const qParam = new URL(finalUrl).searchParams.get('q');
  if (!qParam) throw new Error('No coordinates or address found');

  const parts = qParam
    .replace(/(\d+)\s+Chome-(\d+)-(\d+)/gi, '$1-$2-$3') // "7 Chome-2-18" → "7-2-18"
    .replace(/\b(\w+)\s+City\b/gi, '$1')                  // "Chuo City" → "Chuo"
    .replace(/\b\d{3}-\d{4}\b/g, '')                      // remove postal codes
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (let skip = 0; skip <= Math.min(3, parts.length - 2); skip++) {
    const loc = await nominatimGeocode(parts.slice(skip).join(' '));
    if (loc) return loc;
  }

  throw new Error('Could not geocode address from Google Maps URL');
}

async function resolvePlusCode(text: string): Promise<Location> {
  const match = text.match(plusCodeRegex);
  if (!match) throw new Error('No plus code found');
  const code = match[1];

  if (olc.isFull(code)) {
    const area = olc.decode(code);
    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
  }

  // Short code — geocode the locality part with Nominatim
  const locality = text
    .replace(code, '')
    .trim()
    .replace(/^[,\s]+/, '');
  if (!locality) throw new Error('Short code requires a locality');

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locality)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'mapdoge-bot/1.0' } }
  );
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  const geo = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!geo.length) throw new Error('Could not geocode locality');

  const refLat = parseFloat(geo[0].lat);
  const refLng = parseFloat(geo[0].lon);
  const fullCode = olc.recoverNearest(code, refLat, refLng);
  const area = olc.decode(fullCode);
  return { lat: area.latitudeCenter, lng: area.longitudeCenter };
}

async function replyWithMapcode(
  ctx: {
    reply: (msg: string) => Promise<unknown>;
    replyWithLocation: (lat: number, lng: number) => Promise<unknown>;
  },
  location: Location
): Promise<void> {
  await ctx.replyWithLocation(location.lat, location.lng);
  if (!isInJapan(location)) {
    await ctx.reply('Location is outside Japan.');
    return;
  }
  const mapcode = encodeMapCode(location.lat, location.lng);
  if (mapcode) {
    await ctx.reply(
      `Mapcode: ${mapcode}\nLat: ${location.lat}, Lng: ${location.lng}`
    );
  } else {
    await ctx.reply('Get Mapcode failed.');
  }
}

let bot: Telegraf | null = null;

function getBot(token: string): Telegraf {
  if (!bot) {
    bot = new Telegraf(token);

    bot.start(async ctx => {
      await ctx.reply(
        'I can help you to query MAPCODE with Telegram.\n' +
          'Send me a Google Maps URL or a plus code.'
      );
    });

    bot.help(async ctx => {
      await ctx.replyWithHTML(
        'Send me a Google Maps share URL (maps.app.goo.gl/…) or a ' +
          '<a href="https://maps.google.com/pluscodes/">plus code</a>.'
      );
    });

    bot.on(message('text'), async ctx => {
      const text = ctx.message.text;

      // Google Maps URL
      const gmUrlMatch = text.match(googleMapsUrlRegex);
      if (gmUrlMatch) {
        let location: Location;
        try {
          location = await resolveGoogleMapsUrl(gmUrlMatch[0]);
        } catch {
          await ctx.reply('Could not extract location from Google Maps URL.');
          return;
        }
        await replyWithMapcode(ctx, location);
        return;
      }

      // Plus code
      if (!plusCodeRegex.test(text)) {
        await ctx.reply('Please send a Google Maps URL or a plus code.');
        return;
      }
      let location: Location;
      try {
        location = await resolvePlusCode(text);
      } catch (err) {
        const msg =
          err instanceof Error &&
          err.message === 'Short code requires a locality'
            ? 'Short plus code needs a city name, e.g. "9Q8F+6W Tokyo"'
            : 'Get location failed.';
        await ctx.reply(msg);
        return;
      }
      await replyWithMapcode(ctx, location);
    });
  }
  return bot;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('MapDoge Bot is running!', { status: 200 });
    }
    const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secretHeader !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const update = await request.json();
      await getBot(env.BOT_TOKEN).handleUpdate(update as Update);
      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error(err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

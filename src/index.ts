import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import { OpenLocationCode } from 'open-location-code';
import { MapCodeResponse } from './types';

const MAX_LAT = 46;
const MIN_LAT = 20;
const MAX_LNG = 153;
const MIN_LNG = 122;

const plusCodeRegex =
  /([23456789CFGHJMPQRVWX]{4}(?:[23456789CFGHJMPQRVWX]{2}){0,2}\+[23456789CFGHJMPQRVWX]{2,3})/;

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

async function resolveLocation(text: string): Promise<Location> {
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

async function getMapCode(lat: number, lng: number): Promise<MapCodeResponse> {
  const res = await fetch('https://japanmapcode.com/mapcode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: `lat=${lat}&lng=${lng}`
  });
  if (!res.ok) throw new Error(`mapcode API error: ${res.status}`);
  return res.json();
}

let bot: Telegraf | null = null;

function getBot(token: string): Telegraf {
  if (!bot) {
    bot = new Telegraf(token);

    bot.start(async ctx => {
      await ctx.reply(
        'I can help you to query MAPCODE with Telegram.\nYou can copy plus code from Google Maps and paste it to tell me.'
      );
    });

    bot.help(async ctx => {
      await ctx.replyWithHTML(
        'Send me a <a href="https://maps.google.com/pluscodes/">plus code</a>'
      );
    });

    bot.on(message('text'), async ctx => {
      const text = ctx.message.text;
      if (!plusCodeRegex.test(text)) {
        await ctx.reply('Invalid plus code!');
        return;
      }
      let location: Location;
      try {
        location = await resolveLocation(text);
      } catch (err) {
        const msg =
          err instanceof Error &&
          err.message === 'Short code requires a locality'
            ? 'Short plus code needs a city name, e.g. "9Q8F+6W Tokyo"'
            : 'Get location failed.';
        await ctx.reply(msg);
        return;
      }
      await ctx.replyWithLocation(location.lat, location.lng);
      if (
        location.lat >= MIN_LAT &&
        location.lat <= MAX_LAT &&
        location.lng >= MIN_LNG &&
        location.lng <= MAX_LNG
      ) {
        let mapcode: MapCodeResponse;
        try {
          mapcode = await getMapCode(location.lat, location.lng);
        } catch {
          await ctx.reply('Get Mapcode failed.');
          return;
        }
        if (mapcode.success) {
          await ctx.reply(
            `Mapcode: ${mapcode.mapcode}\nLat: ${location.lat}, Lng: ${location.lng}`
          );
        } else {
          await ctx.reply('Get Mapcode failed.');
        }
      } else {
        await ctx.reply('Invalid Japan plus code!');
      }
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

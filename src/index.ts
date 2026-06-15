import { Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import { OpenLocationCode } from 'open-location-code';
import { MapCodeResponse } from './types';

const MAX_LAT = 45;
const MIN_LAT = 20;
const MAX_LNG = 153;
const MIN_LNG = 122;

const plusCodeRegex =
  /([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})/;

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

  if (OpenLocationCode.isFull(code)) {
    const area = OpenLocationCode.decode(code);
    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
  }

  // Short code — geocode the locality part with Nominatim
  const locality = text.replace(code, '').trim().replace(/^[,\s]+/, '');
  if (!locality) throw new Error('Short code requires a locality');

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locality)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'mapdoge-bot/1.0' } }
  );
  const geo = await res.json() as Array<{ lat: string; lon: string }>;
  if (!geo.length) throw new Error('Could not geocode locality');

  const refLat = parseFloat(geo[0].lat);
  const refLng = parseFloat(geo[0].lon);
  const fullCode = OpenLocationCode.recoverNearest(code, refLat, refLng);
  const area = OpenLocationCode.decode(fullCode);
  return { lat: area.latitudeCenter, lng: area.longitudeCenter };
}

async function getMapCode(lat: number, lng: number): Promise<MapCodeResponse> {
  const res = await fetch('https://japanmapcode.com/mapcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `lat=${lat}&lng=${lng}`,
  });
  return res.json();
}

let bot: Telegraf | null = null;

function getBot(token: string): Telegraf {
  if (!bot) {
    bot = new Telegraf(token);

    bot.catch((err) => {
      console.error('Bot error:', err);
    });

    bot.start(ctx => {
      ctx.reply(
        `I can help you to query MAPCODE with Telegram.\nYou can copy plus code from Google Maps and paste it to tell me.`
      );
    });

    bot.help(ctx => {
      ctx.replyWithMarkdownV2(
        'Send me a [plus code](https://maps.google.com/pluscodes/)'
      );
    });

    bot.on('text', async ctx => {
      const text = ctx.message.text;
      if (!plusCodeRegex.test(text)) {
        await ctx.reply('Invalid plus code!');
        return;
      }
      let location: Location;
      try {
        location = await resolveLocation(text);
      } catch {
        await ctx.reply('Get location failed.');
        return;
      }
      await ctx.replyWithLocation(location.lat, location.lng);
      if (
        location.lat >= MIN_LAT &&
        location.lat <= MAX_LAT &&
        location.lng >= MIN_LNG &&
        location.lng <= MAX_LNG
      ) {
        const mapcode = await getMapCode(location.lat, location.lng);
        if (mapcode.success) {
          await ctx.replyWithHTML(
            `Mapcode: ${mapcode.mapcode}\n<a href="https://mapdoge.tomomo.org?lat=${location.lat}&lng=${location.lng}">View on drivenippon</a>`
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
      console.error('Fetch handler error:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

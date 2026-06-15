import { Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import { PlusCode, MapCodeResponse } from './types';

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

async function getPlusCode(text: string): Promise<PlusCode> {
  const res = await fetch(
    `https://plus.codes/api?address=${encodeURIComponent(text)}&language=ja`,
    { headers: { Referer: 'https://plus.codes' } }
  );
  const data = await res.json() as PlusCode;
  console.log('plus.codes status:', data.status);
  return data;
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
        await ctx.reply(`Invalid plus code!`);
        return;
      }
      const plusCodeResult = await getPlusCode(text);
      if (plusCodeResult.status !== 'OK') {
        await ctx.reply('Get location failed.');
        return;
      }
      const location = plusCodeResult.plus_code.geometry.location;
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
        await ctx.reply(`Invalid Japan plus code!`);
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

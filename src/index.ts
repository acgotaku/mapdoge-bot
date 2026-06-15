import { Telegraf } from 'telegraf';
import axios from './axios';
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

let bot: Telegraf | null = null;

function getBot(token: string): Telegraf {
  if (!bot) {
    bot = new Telegraf(token);

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
      const plusCodeResult = (await axios.get(
        `https://plus.codes/api?address=${encodeURIComponent(text)}&language=ja`
      )) as PlusCode;
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
        const mapcode = (await axios.post(
          'https://japanmapcode.com/mapcode',
          `lat=${location.lat}&lng=${location.lng}`
        )) as MapCodeResponse;
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
      await getBot(env.BOT_TOKEN).handleUpdate(update as any);
      return new Response('OK', { status: 200 });
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

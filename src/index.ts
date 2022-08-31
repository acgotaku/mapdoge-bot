import { Telegraf } from 'telegraf';
import axios from '@/axios';
import { PlusCode, MapCodeResponse } from '@/types';

const MAX_LAT = 45;
const MIN_LAT = 20;

const MAX_LNG = 153;
const MIN_LNG = 122;

const bot = new Telegraf(process.env.BOT_TOKEN);
const plusCodeRegex =
  /([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})/;

bot.start(ctx => {
  const message = `I can help you to query MAPCODE with Telegram.\nYou can copy plus code from Google Maps and paste it to tell me.`;
  ctx.reply(message);
});

bot.help(ctx => {
  ctx.replyWithMarkdownV2(
    'Send me a [plus code](https://maps.google.com/pluscodes/)'
  );
  ctx.reply(`MapDoge Version ${process.env.npm_package_version}`);
});

bot.on('text', async ctx => {
  const text = ctx.message.text;
  const match = plusCodeRegex.test(text);
  if (match) {
    const plusCodeResult = (await axios.get(
      `https://plus.codes/api?address=${encodeURIComponent(text)}&language=ja`
    )) as PlusCode;
    if (plusCodeResult.status === 'OK') {
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
          await ctx.reply(`Mapcode: ${mapcode.mapcode}`);
        } else {
          await ctx.reply('Get Mapcode failed.');
        }
      } else {
        await ctx.reply(`Invalid Japan plus code!`);
      }
    } else {
      await ctx.reply('Get location failed.');
    }
  } else {
    await ctx.reply(`Invalid plus code!`);
  }
});

bot.launch();
console.log(`MapDoge start with Version ${process.env.npm_package_version}`);

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

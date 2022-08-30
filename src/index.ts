import { Telegraf } from 'telegraf';
import axios from './axios';
import { PlusCode, MapCodeResponse } from './types';

const bot = new Telegraf(process.env.BOT_TOKEN);
const plusCodeRegex =
  /([23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3})/;

bot.start(ctx => {
  const message = `I can help you to query MAPCODE with Telegram.\nYou can copy plus code from Google Maps and paste it to tell me.`;
  ctx.reply(message);
});

bot.help(ctx =>
  ctx.replyWithMarkdownV2(
    'Send me a [plus code](https://maps.google.com/pluscodes/)'
  )
);

bot.on('text', async ctx => {
  const text = ctx.message.text;
  const match = plusCodeRegex.test(text)
  if (match) {
    const plusCodeResult = await axios.get(`https://plus.codes/api?address=${encodeURIComponent(text)}&language=ja`) as PlusCode;
    const location = plusCodeResult.plus_code.geometry.location;
    const mapcode = await axios.post('https://japanmapcode.com/mapcode', `lat=${location.lat}&lng=${location.lng}`) as MapCodeResponse;
    ctx.reply(`lat: ${location.lat}\nlng: ${location.lng}\nMapcode: ${mapcode.mapcode}`);
  } else {
    ctx.reply(`Invalid plus code!`);
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

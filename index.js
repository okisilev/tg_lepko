require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { Stage } = require('telegraf/scenes');
const { orderScene } = require('./scenes/order');
const db = require('./db');
const admin = require('./admin');
const cron = require('./cron');
const yookassa = require('./yookassa');

const bot = new Telegraf(process.env.BOT_TOKEN);
db.init();

const stage = new Stage([orderScene]);
bot.use(session());
bot.use(stage.middleware());

// Главное меню
const mainMenuButtons = [
  [{ text: 'Записаться на МК (2500₽)', callback_data: 'service_mk' }],
  [{ text: 'Записаться на глазурный МК (1200₽)', callback_data: 'service_glaze' }],
  [{ text: 'Купить эл. талон на лепку (от 1000₽)', callback_data: 'service_voucher' }],
  [{ text: 'Записаться на свидание (5000₽)', callback_data: 'service_date' }],
  [{ text: 'Записаться на индивид. МК (5000₽)', callback_data: 'service_individual' }],
  [{ text: 'Предложить свой МК (2500₽)', callback_data: 'service_custom' }],
  [{ text: 'Организация праздников (от 6500₽)', callback_data: 'service_party' }],
  [{ text: 'Семейный МК (от 6500₽)', callback_data: 'service_family' }],
  [{ text: 'Аренда помещения (от 2000₽)', callback_data: 'service_rent' }],
  [{ text: 'Изделие на заказ (от 4000₽)', callback_data: 'service_order' }],
  [{ text: 'Абонемент 4 занятия (7200₽)', callback_data: 'service_abonement' }],
  [{ text: '🛠️ Админка', callback_data: 'open_admin_panel' }]
];

bot.start((ctx) => {
  ctx.reply('Добро пожаловать в студию "Лепко"! 🎨', {
    reply_markup: { inline_keyboard: mainMenuButtons }
  });
});

bot.action(/service_(.+)/, (ctx) => {
  const serviceType = ctx.match[1];
  ctx.scene.session.service = serviceType;
  ctx.scene.enter('order');
});

// Обработка кнопки "Админка"
// Кнопка "Админка"
bot.action('open_admin_panel', async (ctx) => {
  const admins = await db.getAllAdmins();
  if (!admins.includes(ctx.from.id)) {
    return ctx.answerCbQuery('🔒 Доступ запрещён', true);
  }
  await ctx.reply('Админ-панель:', admin.getAdminMenu());
}); // ← не сработает напрямую

  // Лучше — вызвать напрямую логику админки:
  //await ctx.reply('Админ-панель:', {
    //reply_markup: {
      //inline_keyboard: [
        //[{ text: '📸 Установить фото на дату', callback_data: 'admin_set_photo' }],
        //[{ text: '📤 Рассылка', callback_data: 'admin_broadcast' }],
        //[{ text: '📊 Отчёты', callback_data: 'admin_reports' }],
        //[{ text: '🎟️ Отчёт по талонам', callback_data: 'admin_voucher_report' }]
      //]
//    }
//  });
//});

// Админка
admin.register(bot); // ← важно!

// Long polling
bot.launch();
cron.start(bot);

console.log('✅ Бот запущен в режиме long polling');
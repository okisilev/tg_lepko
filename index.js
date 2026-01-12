require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { Stage } = require('telegraf/scenes');
const { bookingScene } = require('./scenes/booking');
const db = require('./db');
const admin = require('./admin');
const cron = require('./cron');

// Инициализация БД
db.init();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware сессий и сцен
const stage = new Stage([bookingScene]);
bot.use(session());
bot.use(stage.middleware());

// Стартовое меню
bot.start(async (ctx) => {
  const admins = await db.getAllAdmins();
  const isAdmin = admins.includes(ctx.from.id);
  const keyboard = [
    [{ text: 'Записаться на мастер-класс', callback_data: 'book' }]
  ];
  
  if (isAdmin) {
    keyboard.push([{ text: '🛠️ Админка', callback_data: 'open_admin' }]);
  }

  await ctx.reply('Добро пожаловать в студию "Лепко"! 🎨', {
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Обработка кнопки "Админка"
bot.action('open_admin', async (ctx) => {
    const admins = await db.getAllAdmins();
    if (!admins.includes(ctx.from.id)) {
      return ctx.answerCbQuery('🔒 Доступ запрещён', true);
    }
  
    await ctx.answerCbQuery(); // подтверждаем нажатие
    await ctx.reply('Админ-панель:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📸 Установить фото на дату', callback_data: 'admin_set_photo' }],
          [{ text: '📤 Рассылка', callback_data: 'admin_broadcast' }],
          [{ text: '📊 Отчёты', callback_data: 'admin_reports' }]
        ]
      }
    });
  });

// Обработка кнопки "Записаться"
bot.action('book', (ctx) => {
  ctx.scene.enter('booking');
});

// Регистрация админских команд и обработчиков
admin.register(bot);

// Запуск бота в режиме long polling (для локальной разработки)
bot.launch();

// Запуск напоминаний
cron.start(bot);

console.log('✅ Бот запущен в режиме long polling');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
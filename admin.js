const { Composer, Markup } = require('telegraf');
const db = require('./db');
const fs = require('fs');        // ✅ для createWriteStream
const fsPromises = require('fs').promises; // для async операций
const path = require('path');
const axios = require('axios');
const { parse, format } = require('date-fns'); // ✅ Добавлено

const composer = new Composer();

const isAdmin = async (ctx, next) => {
  const admins = await db.getAllAdmins();
  if (admins.includes(ctx.from.id)) {
    return next();
  }
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 Доступ запрещён', true);
  } else {
    await ctx.reply('🔒 Доступ запрещён');
  }
};

composer.command('admin', isAdmin, async (ctx) => {
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

composer.action('admin_set_photo', isAdmin, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.adminStep = 'awaiting_date_for_photo';
  await ctx.reply('Введите дату в формате ДД-ММ-ГГГГ (например, 13-01-2026):');
});

composer.on('text', async (ctx, next) => {
  if (ctx.scene?.session?.adminStep === 'awaiting_date_for_photo') {
    const input = ctx.message.text.trim();

    // Принимаем только ДД-ММ-ГГГГ
    if (!/^\d{2}-\d{2}-\d{4}$/.test(input)) {
      return ctx.reply('Формат: ДД-ММ-ГГГГ (например, 13-01-2026)');
    }

    let storageDate;
    try {
      const parsed = parse(input, 'dd-MM-yyyy', new Date());
      storageDate = format(parsed, 'yyyy-MM-dd'); // сохраняем в БД-формате
    } catch (e) {
      return ctx.reply('Неверная дата. Попробуйте снова.');
    }

    ctx.scene.session.photoDate = storageDate;
    ctx.scene.session.adminStep = 'awaiting_photo';
    return ctx.reply('Отправьте фото:');
  }
  return next();
});

composer.on('photo', async (ctx, next) => {
  if (ctx.scene?.session?.adminStep === 'awaiting_photo') {
    const date = ctx.scene.session.photoDate;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    try {
      const fileId = photo.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);

      const response = await axios({
        method: 'GET',
        url: fileLink,
        responseType: 'stream'
      });

      const filename = `${date}.jpg`;
      const uploadDir = path.join(__dirname, '..', 'uploads');
      const filePath = path.join(uploadDir, filename);

      await fsPromises.mkdir(uploadDir, { recursive: true });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      await db.setWorkshopPhoto(date, filePath);

      await ctx.reply('✅ Фото мастер-класса сохранено на сервер!');
      console.log(`📸 Фото сохранено: ${filePath}`);
    } catch (e) {
      console.error('Ошибка загрузки фото:', e);
      await ctx.reply('❌ Не удалось сохранить фото.');
    }

    delete ctx.scene.session.adminStep;
    delete ctx.scene.session.photoDate;
    return;
  }
  return next();
});

composer.action('admin_broadcast', isAdmin, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.adminStep = 'awaiting_broadcast_message';
  await ctx.reply('Отправьте сообщение для рассылки:');
});

composer.on('text', async (ctx, next) => {
  if (ctx.scene?.session?.adminStep === 'awaiting_broadcast_message') {
    const users = await db.getAllBookedUsers();
    let sent = 0;
    for (const uid of users) {
      try {
        await ctx.telegram.sendMessage(uid, ctx.message.text);
        sent++;
      } catch (e) {}
    }
    await ctx.reply(`📤 Рассылка отправлена ${sent} пользователям.`);
    delete ctx.scene.session.adminStep;
    return;
  }
  return next();
});

composer.action('admin_reports', isAdmin, async (ctx) => {
  const today = new Date().toISOString().split('T')[0];
  const bookings = await db.getBookingsForDate(today);
  if (bookings.length === 0) {
    await ctx.answerCbQuery(`Сегодня (${today}) записей нет`, true);
  } else {
    let msg = `📊 Отчёт на ${today}:\n\n`;
    bookings.forEach(b => {
      msg += `🕒 ${b.time_slot} | ${b.name} | ${b.phone}\n`;
    });
    await ctx.answerCbQuery();
    await ctx.reply(msg);
  }
});

module.exports = { register: (bot) => bot.use(composer.middleware()), isAdmin };
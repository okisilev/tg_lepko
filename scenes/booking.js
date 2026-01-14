const { Scenes } = require('telegraf');
const { format, addDays, parse } = require('date-fns');
const db = require('../db');
const yookassa = require('../yookassa');
const fs = require('fs');
const path = require('path');

const TIME_SLOTS = ['11:00', '14:00', '15:00', '17:00', '18:30'];
const DISPLAY_FORMAT = 'dd-MM-yyyy';
const STORAGE_FORMAT = 'yyyy-MM-dd';

const bookingScene = new Scenes.BaseScene('booking');

// Вход в сцену — выбор даты
bookingScene.enter(async (ctx) => {
  const dates = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(new Date(), i);
    dates.push(format(d, DISPLAY_FORMAT));
  }
  const buttons = dates.map(d => [{ text: d, callback_data: `date_${d}` }]);
  await ctx.reply('Выберите дату мастер-класса:', {
    reply_markup: { inline_keyboard: buttons }
  });
});

// Выбор даты → показ фото и времени
bookingScene.action(/date_(\d{2}-\d{2}-\d{4})/, async (ctx) => {
  const displayDate = ctx.match[1];
  let storageDate;
  try {
    const parsed = parse(displayDate, DISPLAY_FORMAT, new Date());
    storageDate = format(parsed, STORAGE_FORMAT);
  } catch (e) {
    return ctx.answerCbQuery('Неверная дата', true);
  }

  ctx.scene.session.date = storageDate;

  let photoToSend;
  const workshop = await db.getWorkshop(storageDate);
  if (workshop?.photo_path && fs.existsSync(workshop.photo_path)) {
    photoToSend = { source: fs.createReadStream(workshop.photo_path) };
  } else {
    const defaultPath = path.join(__dirname, '..', 'public', 'default.jpg');
    photoToSend = { source: fs.createReadStream(defaultPath) };
  }

  const keyboard = [];
  for (const time of TIME_SLOTS) {
    const count = await db.getBookingsCount(storageDate, time);
    if (count < 10) {
      keyboard.push([{ text: time, callback_data: `time_${time}` }]);
    }
  }

  if (keyboard.length === 0) {
    await ctx.answerCbQuery('Все места заняты.', true);
    return ctx.scene.leave();
  }

  await ctx.replyWithPhoto(photoToSend, {
    caption: `Мастер-класс ${displayDate}`,
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Выбор времени → запрос количества
bookingScene.action(/time_(.+)/, async (ctx) => {
  ctx.scene.session.time = ctx.match[1];
  await ctx.reply('Сколько человек будет участвовать? (1–10):', {
    reply_markup: {
      keyboard: [[{ text: '🔙 Назад' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
  ctx.scene.session.step = 'people_count';
});

// Кнопка "Назад"
bookingScene.hears('🔙 Назад', async (ctx) => {
  const step = ctx.scene.session.step;
  const date = ctx.scene.session.date;

  if (step === 'phone') {
    await ctx.reply('Ваше имя:', {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.scene.session.step = 'name';
    return;
  }

  if (step === 'name') {
    await ctx.reply('Сколько человек будет участвовать? (1–10):', {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.scene.session.step = 'people_count';
    return;
  }

  if (step === 'people_count') {
    // Вернуться к выбору времени
    let photoToSend;
    const workshop = await db.getWorkshop(date);
    if (workshop?.photo_path && fs.existsSync(workshop.photo_path)) {
      photoToSend = { source: fs.createReadStream(workshop.photo_path) };
    } else {
      const defaultPath = path.join(__dirname, '..', 'public', 'default.jpg');
      photoToSend = { source: fs.createReadStream(defaultPath) };
    }

    const keyboard = [];
    for (const time of TIME_SLOTS) {
      const count = await db.getBookingsCount(date, time);
      if (count < 10) {
        keyboard.push([{ text: time, callback_data: `time_${time}` }]);
      }
    }

    const displayDate = format(new Date(date), DISPLAY_FORMAT);
    await ctx.replyWithPhoto(photoToSend, {
      caption: `Мастер-класс ${displayDate}`,
      reply_markup: { inline_keyboard: keyboard }
    });

    delete ctx.scene.session.step;
    delete ctx.scene.session.people_count;
    delete ctx.scene.session.name;
    delete ctx.scene.session.phone;
    return;
  }

  // Если неизвестный шаг — выйти
  await ctx.reply('Главное меню:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Записаться', callback_data: 'book' }]]
    }
  });
  ctx.scene.leave();
});

// Обработка текстовых сообщений
bookingScene.on('text', async (ctx) => {
  const step = ctx.scene.session.step;
  const storageDate = ctx.scene.session.date;

  if (step === 'people_count') {
    const count = parseInt(ctx.message.text.trim(), 10);
    if (!count || count < 1 || count > 10) {
      return ctx.reply('Введите число от 1 до 10.');
    }

    const time = ctx.scene.session.time;
    const currentCount = await db.getBookingsCount(storageDate, time);
    const available = 10 - currentCount;
    if (count > available) {
      return ctx.reply(`Доступно только ${available} место(а/с).`);
    }

    ctx.scene.session.people_count = count;
    await ctx.reply('Ваше имя:', {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.scene.session.step = 'name';
    return;
  }

  if (step === 'name') {
    ctx.scene.session.name = ctx.message.text;
    await ctx.reply('Номер телефона:', {
      reply_markup: {
        keyboard: [
          [{ text: 'Отправить контакт', request_contact: true }],
          [{ text: '🔙 Назад' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.scene.session.step = 'phone';
    return;
  }
});

// Обработка контакта
bookingScene.on('contact', async (ctx) => {
  if (ctx.scene.session.step !== 'phone') return;

  const { date, time, name, people_count } = ctx.scene.session;
  const phone = ctx.message.contact.phone_number;
  const userId = ctx.from.id;

  try {
    // ✅ Передаём people_count в createPayment
    const paymentData = await yookassa.createPayment({
      date,
      time,
      userId,
      people_count // ← ключевое исправление
    });

    await db.createBooking({
      workshop_date: date,
      time_slot: time,
      user_id: userId,
      name,
      phone,
      people_count,
      payment_id: paymentData.id
    });

    // Запуск polling (опционально, если нет вебхука)
    startPollingPayment(ctx, paymentData.id, people_count, date, time);

    const displayDate = format(new Date(date), DISPLAY_FORMAT);
    await ctx.reply(
      `Оплата за ${people_count} чел. (${displayDate} в ${time})\n${paymentData.confirmation.confirmation_url}`,
      { reply_markup: { remove_keyboard: true } }
    );
    ctx.scene.leave();
  } catch (e) {
    console.error('Ошибка платежа:', e);
    await ctx.reply('❌ Ошибка при создании платежа.');
    ctx.scene.leave();
  }
});

/**
 * Polling статуса платежа (без вебхука)
 */
async function startPollingPayment(ctx, paymentId, people_count, date, time) {
  const maxAttempts = 40; // ~10 минут
  const intervalMs = 15000;

  let attempt = 0;
  const checkStatus = async () => {
    attempt++;
    try {
      const payment = await yookassa.getPaymentStatus(paymentId);
      if (payment.status === 'succeeded') {
        await db.updatePaymentStatus(paymentId, 'succeeded');
        const booking = await db.getBookingByPaymentId(paymentData.id);
if (booking) {
  const admins = await db.getAllAdmins();
  const msg = `✅ Новая запись!\nУслуга: ${SERVICES[serviceType].name}\nНоминал: ${finalAmount} ₽\nНомер талона: ${voucherNumber || '—'}\nИмя: ${booking.name}\nТелефон: ${booking.phone}\nUsername: @${ctx.from.username || 'не указан'}\nUser ID: ${userId}`;
  
  for (const id of admins) {
            try { await ctx.telegram.sendMessage(id, msg); } catch (e) {}
          }
          try {
            const displayDate = new Date(booking.workshop_date).toLocaleDateString('ru-RU');
            await ctx.telegram.sendMessage(
              booking.user_id,
              `✅ Оплата прошла успешно!\nЖдём вас на мастер-классе ${displayDate} в ${booking.time_slot}.`
            );
          } catch (e) {}
        }
        return;
      }

      if (['canceled', 'expired'].includes(payment.status)) {
        return;
      }

      if (attempt < maxAttempts) {
        setTimeout(checkStatus, intervalMs);
      }
    } catch (e) {
      if (attempt < maxAttempts) {
        setTimeout(checkStatus, intervalMs);
      }
    }
  };

  setTimeout(checkStatus, intervalMs);
}

module.exports = { bookingScene };
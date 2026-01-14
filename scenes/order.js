// scenes/order.js
const { Scenes } = require('telegraf');
const { parse, format } = require('date-fns');
const { SERVICES, getAvailableDates } = require('../services');
const db = require('../db');
const yookassa = require('../yookassa');
const { ru } = require('date-fns/locale');
const { format, addDays, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth } = require('date-fns');

const orderScene = new Scenes.BaseScene('order');

// Генерация уникального номера талона
function generateVoucherNumber() {
  return 'VT' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// Вход в сцену
orderScene.enter(async (ctx) => {
  const serviceType = ctx.scene.session.service;
  const service = SERVICES[serviceType];

  if (!service) {
    await ctx.reply('Неизвестная услуга.');
    return ctx.scene.leave();
  }

  if (serviceType === 'voucher') {
    const buttons = [1000, 1500, 2000, 2500, 3000, 3700, 5000, 10000].map(v =>
      [{ text: `${v} ₽`, callback_data: `voucher_${v}` }]
    );
    return ctx.reply('Выберите сумму талона:', {
      reply_markup: { inline_keyboard: buttons }
    });
  }

  if (serviceType === 'rent') {
    const msg = `С 08:00 до 17:00\n- 1-й час — 2000 ₽\n- 2-й час и последующие — +1500 ₽/час\n\nС 17:00 до 00:00\n- 1-й час – 3500 ₽\n- 2-й час и последующие — +1500 ₽/час`;
    await ctx.reply(msg);
    return collectName(ctx);
  }

  if (['order', 'abonement'].includes(serviceType)) {
    return collectName(ctx);
  }

  if (serviceType === 'custom') {
    return ctx.reply('Опишите желаемое изделие или загрузите картинку:');
  }

  const dates = getAvailableDates();
  const buttons = dates.map(d => [{ text: d, callback_data: `date_${d}` }]);
  await ctx.reply('Выберите дату:', {
    reply_markup: { inline_keyboard: buttons }
  });
});

// Выбор суммы талона
orderScene.action(/voucher_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1]);
    ctx.scene.session.amount = amount; // ← правильно
    ctx.scene.session.voucher_number = generateVoucherNumber();
    return collectName(ctx);
  });

// Выбор даты
orderScene.action(/date_(\d{2}-\d{2}-\d{4})/, async (ctx) => {
  const displayDate = ctx.match[1];
  let storageDate;
  try {
    const parsed = parse(displayDate, 'dd-MM-yyyy', new Date());
    storageDate = format(parsed, 'yyyy-MM-dd');
  } catch (e) {
    return ctx.answerCbQuery('Неверная дата', true);
  }

  ctx.scene.session.date = storageDate;

  const serviceType = ctx.scene.session.service;
  const service = SERVICES[serviceType];
  const keyboard = [];

  for (const time of service.timeSlots) {
    const count = await db.getBookingsCount(storageDate, time);
    if (count < service.maxPeople) {
      keyboard.push([{ text: time, callback_data: `time_${time}` }]);
    }
  }

  if (keyboard.length === 0) {
    await ctx.answerCbQuery('Все места заняты.', true);
    return ctx.scene.leave();
  }

  await ctx.reply(`Выберите время для "${service.name}":`, {
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Выбор времени
orderScene.action(/time_(.+)/, async (ctx) => {
  ctx.scene.session.time = ctx.match[1];
  const serviceType = ctx.scene.session.service;

  if (serviceType === 'party' || serviceType === 'family') {
    const max = serviceType === 'party' ? 20 : 15;
    ctx.scene.session.step = 'people_count';
    return ctx.reply(`Сколько будет людей? (от 4 до ${max}):`);
  }

  if (serviceType === 'custom') {
    return ctx.reply('Опишите желаемое изделие или загрузите картинку:');
  }

  return collectName(ctx);
});

// Кнопка "Назад"
orderScene.hears('🔙 Назад', (ctx) => {
  ctx.scene.leave();
  sendMainMenu(ctx);
});

// Обработка текста
orderScene.on('text', async (ctx) => {
  const step = ctx.scene.session.step;
  const serviceType = ctx.scene.session.service;

  if (step === 'people_count') {
    const count = parseInt(ctx.message.text.trim(), 10);
    const max = serviceType === 'party' ? 20 : 15;
    if (count < 4 || count > max) {
      return ctx.reply(`Введите число от 4 до ${max}.`);
    }
    ctx.scene.session.people_count = count;
    return collectName(ctx);
  }

  if (serviceType === 'custom') {
    ctx.scene.session.description = ctx.message.text;
    return collectName(ctx);
  }

  if (step === 'name') {
    ctx.scene.session.name = ctx.message.text;
    await ctx.reply('Номер телефона:', {
      reply_markup: {
        keyboard: [[{ text: 'Отправить контакт', request_contact: true }], [{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.scene.session.step = 'phone';
    return;
  }
});

// Обработка фото
orderScene.on('photo', async (ctx) => {
  if (ctx.scene.session.service === 'custom') {
    ctx.scene.session.photo_file_id = ctx.message.photo[0].file_id;
    return collectName(ctx);
  }
});

// Обработка контакта → оплата
orderScene.on('contact', async (ctx) => {
  const session = ctx.scene.session;
  const serviceType = session.service;

  if (!serviceType || !SERVICES[serviceType]) {
    await ctx.reply('❌ Ошибка: не выбрана услуга.');
    return ctx.scene.leave();
  }
  
  if (!session.amount && serviceType === 'voucher') {
    await ctx.reply('❌ Ошибка: не указана сумма талона.');
    return ctx.scene.leave();
  }
  


  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  //const finalAmount = session.amount || SERVICES[serviceType]?.basePrice || 0;
  const finalAmount = serviceType === 'voucher' 
  ? session.amount 
  : SERVICES[serviceType]?.basePrice || 0;

  console.log('Сумма для оплаты:', finalAmount);

  try {
    const paymentData = await yookassa.createPayment({
      date: session.date,
      time: session.time,
      userId,
      people_count: session.people_count || 1,
      amount: finalAmount,
      description: `${SERVICES[serviceType].name} ${session.date || ''}`
    });

    await db.createBooking({
      workshop_date: session.date || null,
      time_slot: session.time || null,
      user_id: userId,
      name: session.name,
      phone,
      people_count: session.people_count || 1,
      service_type: serviceType,
      voucher_number: session.voucher_number || null,
      amount: finalAmount,
      username: ctx.from.username || null,
      description: session.description || null,
      photo_file_id: session.photo_file_id || null,
      username: ctx.from.username || null,
      payment_id: paymentData.id
    });

    await ctx.reply(
      `Оплата (${finalAmount} ₽):\n${paymentData.confirmation.confirmation_url}`,
      { reply_markup: { remove_keyboard: true } }
    );

    startPollingPayment(ctx, paymentData.id, finalAmount, serviceType, session.date, session.time);

    ctx.scene.leave();
  } catch (e) {
    console.error('Ошибка платежа:', e);
    await ctx.reply('❌ Ошибка при создании платежа.');
    ctx.scene.leave();
  }
});

// Вспомогательные функции
async function collectName(ctx) {
  ctx.scene.session.step = 'name';
  await ctx.reply('Ваше имя:', {
    reply_markup: {
      keyboard: [[{ text: '🔙 Назад' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

function sendMainMenu(ctx) {
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
    [{ text: 'Абонемент 4 занятия (7200₽)', callback_data: 'service_abonement' }]
  ];
  ctx.reply('Главное меню:', { reply_markup: { inline_keyboard: mainMenuButtons } });
}

// Polling статуса платежа
async function startPollingPayment(ctx, paymentId, amount, serviceType, date, time) {
  const maxAttempts = 40;
  const intervalMs = 15000;
  let attempt = 0;

  const checkStatus = async () => {
    attempt++;
    try {
      const payment = await yookassa.getPaymentStatus(paymentId);
      if (payment.status === 'succeeded') {
        await db.updatePaymentStatus(paymentId, 'succeeded');
        const booking = await db.getBookingByPaymentId(paymentId);
        if (booking) {
          const admins = await db.getAllAdmins();
          let msg = `✅ Новая запись!\nУслуга: ${SERVICES[serviceType].name}\n`;

          if (serviceType === 'voucher') {
            msg += `Номинал: ${booking.amount} ₽\n`;
            msg += `Номер талона: ${booking.voucher_number || '—'}\n`;
          } else {
            msg += `Дата: ${booking.workshop_date || '—'}\n`;
            msg += `Время: ${booking.time_slot || '—'}\n`;
          }

          msg += `Имя: ${booking.name}\n`;
          msg += `Телефон: ${booking.phone}\n`;
          msg += `Username: @${ctx.from.username || 'не указан'}\n`;
          msg += `User ID: ${booking.user_id}`;

          for (const id of admins) {
            try { await ctx.telegram.sendMessage(id, msg); } catch (e) {}
          }

          try {
            await ctx.telegram.sendMessage(booking.user_id, `✅ Оплата прошла успешно!`);
          } catch (e) {}
        }
        return;
      }

      if (['canceled', 'expired'].includes(payment.status)) return;
      if (attempt < maxAttempts) setTimeout(checkStatus, intervalMs);
    } catch (e) {
      if (attempt < maxAttempts) setTimeout(checkStatus, intervalMs);
    }
  };

  setTimeout(checkStatus, intervalMs);
}

module.exports = { orderScene };
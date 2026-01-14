// scenes/order.js
const { Scenes } = require('telegraf');
const { ru } = require('date-fns/locale');
const {
  parse,
  format,
  addDays,
  startOfWeek
} = require('date-fns');
const { SERVICES } = require('../services');
const db = require('../db');
const yookassa = require('../yookassa');

const orderScene = new Scenes.BaseScene('order');

function generateVoucherNumber() {
  return 'VT' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

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

  // === КАЛЕНДАРЬ ===
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addDays(new Date(today), 29);

  const weekdaysHeader = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const headerRow = weekdaysHeader.map(day => ({ 
    text: day, 
    callback_data: 'ignore' 
  }));

  const inlineKeyboard = [headerRow];

  let currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });

  for (let week = 0; week < 6; week++) {
    const row = [];
    for (let day = 0; day < 7; day++) {
      const date = addDays(currentWeekStart, day);
      if (date >= today && date <= endDate) {
        const displayDate = format(date, 'dd-MM-yyyy', { locale: ru });
        const dayLabel = format(date, 'dd', { locale: ru });
        row.push({ text: dayLabel, callback_data: `date_${displayDate}` });
      } else {
        row.push({ text: '·', callback_data: 'ignore' });
      }
    }
    inlineKeyboard.push(row);
    currentWeekStart = addDays(currentWeekStart, 7);
  }
  inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main_menu' }]);
  await ctx.reply('Выберите дату:', { reply_markup: { inline_keyboard: inlineKeyboard } });
});

orderScene.action('ignore', async (ctx) => {
  await ctx.answerCbQuery();
});

orderScene.action(/voucher_(\d+)/, async (ctx) => {
  const amount = parseInt(ctx.match[1]);
  ctx.scene.session.amount = amount;
  ctx.scene.session.voucher_number = generateVoucherNumber();
  return collectName(ctx);
});

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

  // Определяем длительность в зависимости от типа услуги
  const durationHours = serviceType === 'date' ? 3 : 1;
  
  for (const time of service.timeSlots) {
    // Проверяем доступность с учетом длительности
    const isAvailable = await checkTimeAvailability(storageDate, time, durationHours, service.maxPeople);
    
    if (isAvailable) {
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

orderScene.action(/time_(.+)/, async (ctx) => {
  ctx.scene.session.time = ctx.match[1];
  const serviceType = ctx.scene.session.service;

  if (serviceType === 'party' || serviceType === 'family') {
    const max = serviceType === 'party' ? 20 : 15;
    ctx.scene.session.step = 'people_count';
    return ctx.reply(`Сколько будет людей? (от 4 до ${max}):`, {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  if (serviceType === 'custom') {
    return ctx.reply('Опишите желаемое изделие или загрузите картинку:', {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  return collectName(ctx);
});

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

orderScene.on('photo', async (ctx) => {
  if (ctx.scene.session.service === 'custom') {
    ctx.scene.session.photo_file_id = ctx.message.photo[0].file_id;
    return collectName(ctx);
  }
});

orderScene.on('contact', async (ctx) => {
  const session = ctx.scene.session;
  const serviceType = session.service;

  if (!serviceType || !SERVICES[serviceType]) {
    await ctx.reply('❌ Ошибка: не выбрана услуга.');
    return ctx.scene.leave();
  }

  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  const finalAmount = session.amount || SERVICES[serviceType]?.deposit || SERVICES[serviceType]?.basePrice || 0;

  if (!finalAmount || finalAmount <= 0) {
    await ctx.reply('❌ Ошибка: не удалось определить сумму платежа.');
    return ctx.scene.leave();
  }

  try {
    const paymentData = await yookassa.createPayment({
      date: session.date,
      time: session.time,
      userId,
      people_count: session.people_count || 1,
      amount: finalAmount,
      description: `${SERVICES[serviceType].name} ${session.date || ''}`
    });

    let durationHours = 1;
    if (serviceType === 'date') {
      durationHours = 3;
    }

    await db.createBooking({
      workshop_date: session.date || null,
      time_slot: session.time || null,
      duration_hours: durationHours,
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

async function sendMainMenu(ctx) {
  const mainMenuButtons = [
    [{ text: 'Записаться на МК (предоплата 500₽)', callback_data: 'service_mk' }],
    [{ text: 'Записаться на глазурный МК (предоплата 500₽)', callback_data: 'service_glaze' }],
    [{ text: 'Купить эл. талон на лепку (от 1000₽)', callback_data: 'service_voucher' }],
    [{ text: 'Записаться на свидание (предоплата 1000₽)', callback_data: 'service_date' }],
    [{ text: 'Записаться на индивид. МК (предоплата 1000₽)', callback_data: 'service_individual' }],
    [{ text: 'Предложить свой МК (без предоплаты)', callback_data: 'service_custom' }],
    [{ text: 'Организация праздников (предоплата 1000₽)', callback_data: 'service_party' }],
    [{ text: 'Семейный МК (предоплата 1000₽)', callback_data: 'service_family' }],
    [{ text: 'Аренда помещения (предоплата 1000₽)', callback_data: 'service_rent' }],
    [{ text: 'Изделие на заказ (без предоплаты)', callback_data: 'service_order' }],
    [{ text: 'Абонемент 4 занятия (предоплата 1000₽)', callback_data: 'service_abonement' }],
    [{ text: '🛠️ Админка', callback_data: 'open_admin_panel' }]
  ];
  await ctx.reply('Главное меню:', { reply_markup: { inline_keyboard: mainMenuButtons } });
}

async function checkTimeAvailability(date, time, durationHours, maxPeople) {
  const [hours, minutes] = time.split(':').map(Number);
  const startMinutes = hours * 60 + minutes;
  const endMinutes = startMinutes + durationHours * 60;
  
  try {
    // Получаем все успешные бронирования на эту дату
    const bookings = await db.getAllBookingsForDate(date);
    
    // Проверяем каждое существующее бронирование на пересечение
    for (const booking of bookings) {
      const [bh, bm] = booking.time_slot.split(':').map(Number);
      const bookingStart = bh * 60 + bm;
      const bookingDuration = booking.duration_hours || (booking.service_type === 'date' ? 3 : 1);
      const bookingEnd = bookingStart + bookingDuration * 60;
      
      // Если интервалы пересекаются
      if (!(endMinutes <= bookingStart || startMinutes >= bookingEnd)) {
        return false; // Время недоступно
      }
    }
    
    return true; // Время доступно
  } catch (error) {
    console.error('Ошибка проверки доступности времени:', error);
    return false;
  }
}

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
          const username = booking.username ? `@${booking.username}` : 'не указан';
          msg += `Пользователь: ${username}\n`;
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

orderScene.hears('🔙 Назад', (ctx) => {
  ctx.scene.leave();
  sendMainMenu(ctx);
});

orderScene.action('back_to_main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.leave();
  sendMainMenu(ctx);
});

module.exports = { orderScene };
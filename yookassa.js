const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');

// Получаем ключи из .env и убираем пробелы
const YOO_SHOP_ID = (process.env.YOO_SHOP_ID || '').trim();
const YOO_SECRET_KEY = (process.env.YOO_SECRET_KEY || '').trim();

if (!YOO_SHOP_ID || !YOO_SECRET_KEY) {
  console.warn('⚠️  ЮKassa: не указаны YOO_SHOP_ID или YOO_SECRET_KEY в .env');
}

/**
 * Создаёт платёж в ЮKassa
 */
async function createPayment({ date, time, userId, people_count }) {
    if (!YOO_SHOP_ID || !YOO_SECRET_KEY) {
      throw new Error('ЮKassa не настроен');
    }
  
    // Защита от ошибок
    if (!people_count || people_count < 1) {
      throw new Error('Некорректное количество участников');
    }
  
    const returnUrl = `https://t.me/test_okiselev_bot`;
  
    try {
      const response = await axios.post(
        'https://api.yookassa.ru/v3/payments',
        {
            amount: { value: (500 * people_count).toFixed(2), currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: returnUrl },
            description: `Мастер-класс ${date} в ${time} (${people_count} чел.)`,
            meta: { userId: String(userId) },
            capture: true
        },
        {
          auth: { username: YOO_SHOP_ID, password: YOO_SECRET_KEY },
          headers: { 'Idempotence-Key': crypto.randomUUID() }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Ошибка ЮKassa:', error.response?.data || error.message);
      throw new Error('Не удалось создать платёж. Попробуйте позже.');
    }
  }

/**
 * Проверяет подпись вебхука ЮKassa
 */
function verifySignature(body, signature) {
  if (!YOO_SECRET_KEY) return false;
  const hmac = crypto.createHmac('sha256', YOO_SECRET_KEY);
  hmac.update(body, 'utf8');
  const digest = hmac.digest('hex');
  return digest === signature;
}

/**
 * Обработчик вебхука от ЮKassa
 */
function createWebhookHandler(bot) {
  return async (req, res) => {
    const signature = req.headers['x-yookassa-signature'];
    const body = JSON.stringify(req.body);

    if (!verifySignature(body, signature)) {
      console.warn('ЮKassa: неверная подпись вебхука');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    if (event.event === 'payment.succeeded') {
      const paymentId = event.object.id;
      await db.updatePaymentStatus(paymentId, 'succeeded');

      const booking = await db.getBookingByPaymentId(paymentId);
      if (booking) {
        // Уведомляем админов
        const admins = await db.getAllAdmins();
        const msg = `✅ Новая запись!\nДата: ${booking.workshop_date}\nВремя: ${booking.time_slot}\nИмя: ${booking.name}\nТелефон: ${booking.phone}\n👥 Участников: ${booking.people_count}`;
        for (const id of admins) {
          try {
            await bot.telegram.sendMessage(id, msg);
          } catch (e) {
            console.error('Не удалось отправить админу:', e.message);
          }
        }

        // Уведомляем пользователя
        try {
          const displayDate = new Date(booking.workshop_date).toLocaleDateString('ru-RU');
          await bot.telegram.sendMessage(
            booking.user_id,
            `✅ Оплата прошла успешно!\nЖдём вас на мастер-классе ${displayDate} в ${booking.time_slot}.`
          );
        } catch (e) {
          console.error('Не удалось отправить пользователю:', e.message);
        }
      }
    }

    res.status(200).end();
  };
}

/**
 * Получить статус платежа по ID
 */
async function getPaymentStatus(paymentId) {
    if (!YOO_SHOP_ID || !YOO_SECRET_KEY) {
      throw new Error('ЮKassa не настроен');
    }
  
    try {
      const response = await axios.get(
        `https://api.yookassa.ru/v3/payments/${paymentId}`,
        {
          auth: { username: YOO_SHOP_ID, password: YOO_SECRET_KEY },
          timeout: 5000
        }
      );
      return response.data;
    } catch (error) {
      console.error(`Ошибка при проверке платежа ${paymentId}:`, error.response?.data || error.message);
      throw error;
    }
  }
  
  module.exports = {
    createPayment,
    getPaymentStatus, // ← добавлено
    createWebhookHandler
  };
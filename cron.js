const cron = require('node-cron');
const { format, addDays } = require('date-fns');
const db = require('./db');

function start(bot) {
    cron.schedule('0 9 * * *', async () => {
      const tomorrowStorage = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const tomorrowDisplay = format(addDays(new Date(), 1), 'dd-MM-yyyy');
      const bookings = await db.getBookingsForDate(tomorrowStorage);
      for (const b of bookings) {
        await bot.telegram.sendMessage(
          b.user_id,
          `🔔 Напоминаем!\nМастер-класс завтра (${tomorrowDisplay}) в ${b.time_slot}.`
        );
      }
    });
  }

module.exports = { start };
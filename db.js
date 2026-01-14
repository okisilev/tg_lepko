// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let db;

function init() {
  db = new sqlite3.Database(path.resolve(__dirname, 'lepko.db'), (err) => {
    if (err) throw err;

    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS workshops (
          date TEXT PRIMARY KEY,
          photo_path TEXT
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workshop_date TEXT,
          time_slot TEXT,
          duration_hours INTEGER DEFAULT 1,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          people_count INTEGER DEFAULT 1,
          service_type TEXT NOT NULL,
          description TEXT,
          photo_file_id TEXT,
          payment_status TEXT DEFAULT 'pending',
          payment_id TEXT,
          voucher_number TEXT DEFAULT NULL,
          is_voucher_redeemed INTEGER DEFAULT 0,
          amount INTEGER DEFAULT 0,
          username TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS admins (
          user_id INTEGER PRIMARY KEY
        )
      `);
    });

    setTimeout(() => {
      const adminIds = (process.env.ADMIN_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d+$/.test(id))
        .map(Number);
      const stmt = db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)');
      adminIds.forEach(id => stmt.run(id));
      stmt.finalize();
    }, 100);
  });
}

function getWorkshop(date) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM workshops WHERE date = ?', [date], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function setWorkshopPhoto(date, photoPath) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO workshops (date, photo_path) VALUES (?, ?)', [date, photoPath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getBookingsCount(date, time) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT time_slot, duration_hours, service_type FROM bookings WHERE workshop_date = ? AND payment_status = "succeeded"',
      [date],
      (err, rows) => {
        if (err) return reject(err);
        
        // Получаем длительность для текущего бронирования
        const serviceType = time.serviceType; // Нужно передавать тип услуги
        const durationHours = serviceType === 'date' ? 3 : 1;
        const [hours, minutes] = time.split(':').map(Number);
        const startMinutes = hours * 60 + minutes;
        const endMinutes = startMinutes + durationHours * 60;
        
        let total = 0;
        for (const row of rows) {
          const [h, m] = row.time_slot.split(':').map(Number);
          const slotStart = h * 60 + m;
          const slotEnd = slotStart + (row.duration_hours || (row.service_type === 'date' ? 3 : 1)) * 60;
          
          // Проверяем пересечение интервалов
          if (!(endMinutes <= slotStart || startMinutes >= slotEnd)) {
            total += 1;
            if (total > 0) break; // Достаточно найти хотя бы одно пересечение
          }
        }
        
        resolve(total);
      }
    );
  });
}

function createBooking(data) {
  return new Promise((resolve, reject) => {
    const {
      workshop_date,
      time_slot,
      duration_hours,
      user_id,
      name,
      phone,
      people_count,
      service_type,
      description,
      photo_file_id,
      payment_id,
      voucher_number,
      is_voucher_redeemed,
      amount,
      username
    } = data;

    db.run(
      `INSERT INTO bookings (
        workshop_date, time_slot, duration_hours, user_id, name, phone, people_count,
        service_type, description, photo_file_id, payment_id,
        voucher_number, is_voucher_redeemed, amount, username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workshop_date,
        time_slot,
        duration_hours || 1,
        user_id,
        name,
        phone,
        people_count,
        service_type,
        description || null,
        photo_file_id || null,
        payment_id || null,
        voucher_number || null,
        is_voucher_redeemed || 0,
        amount || 0,
        username || null
      ],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function updatePaymentStatus(paymentId, status) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE bookings SET payment_status = ? WHERE payment_id = ?', [status, paymentId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getBookingByPaymentId(paymentId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM bookings WHERE payment_id = ?', [paymentId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}


function getAllBookingsForDate(date) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM bookings WHERE workshop_date = ? AND payment_status = "succeeded"',
      [date],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}
function getAllAdmins() {
  return new Promise((resolve, reject) => {
    db.all('SELECT user_id FROM admins', (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.user_id));
    });
  });
}

function getAllBookedUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT DISTINCT user_id FROM bookings WHERE payment_status = "succeeded"', (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.user_id));
    });
  });
}

function getBookingsForDate(date) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM bookings WHERE workshop_date = ? AND payment_status = "succeeded"', [date], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getVouchers() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM bookings 
      WHERE service_type = 'voucher' 
      ORDER BY created_at DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function redeemVoucher(number) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE bookings SET is_voucher_redeemed = 1 WHERE voucher_number = ? AND is_voucher_redeemed = 0',
      [number],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

module.exports = {
  init,
  getWorkshop,
  setWorkshopPhoto,
  getBookingsCount,
  getAllBookingsForDate,
  createBooking,
  updatePaymentStatus,
  getBookingByPaymentId,
  getAllAdmins,
  getAllBookedUsers,
  getBookingsForDate,
  getVouchers,
  redeemVoucher
};
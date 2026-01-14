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

// Получить мастер-класс по дате
function getWorkshop(date) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM workshops WHERE date = ?', [date], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Сохранить путь к фото
function setWorkshopPhoto(date, photoPath) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO workshops (date, photo_path) VALUES (?, ?)', [date, photoPath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Получить общее количество занятых мест (не записей!)
function getBookingsCount(date, time) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT COALESCE(SUM(people_count), 0) as total FROM bookings WHERE workshop_date = ? AND time_slot = ? AND payment_status = "succeeded"',
        [date, time],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.total);
        }
      );
    });
  }

// Создать запись
function createBooking(data) {
    return new Promise((resolve, reject) => {
      const {
        workshop_date,
        time_slot,
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
        amount
      } = data;
  
      db.run(
        `INSERT INTO bookings (
      workshop_date, time_slot, user_id, name, phone, people_count,
      voucher_number, is_voucher_redeemed, amount,
      service_type, description, photo_file_id, payment_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workshop_date,
          time_slot,
          user_id,
          name,
          phone,
          people_count,
          voucher_number || null,        
          is_voucher_redeemed || 0, 
          amount || 0,     
          service_type,                  
          description || null,           
          photo_file_id || null,         
          payment_id || null             
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

// Обновить статус оплаты
function updatePaymentStatus(paymentId, status) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE bookings SET payment_status = ? WHERE payment_id = ?', [status, paymentId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Получить запись по payment_id
function getBookingByPaymentId(paymentId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM bookings WHERE payment_id = ?', [paymentId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Получить всех админов
function getAllAdmins() {
  return new Promise((resolve, reject) => {
    db.all('SELECT user_id FROM admins', (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.user_id));
    });
  });
}

// Получить всех пользователей с успешной записью
function getAllBookedUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT DISTINCT user_id FROM bookings WHERE payment_status = "succeeded"', (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.user_id));
    });
  });
}

// Отчёты на дату
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


// Экспортируйте все нужные функции
module.exports = {
    init,
    getWorkshop,
    setWorkshopPhoto,
    getBookingsCount,
    createBooking,
    updatePaymentStatus,
    getBookingByPaymentId,
    getAllAdmins,
    getAllBookedUsers,
    getBookingsForDate,
    getVouchers,
    redeemVoucher
  };
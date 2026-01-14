// services.js
const { format, addDays } = require('date-fns');

const SERVICES = {
  mk: {
    name: 'Мастер-класс',
    basePrice: 2500,
    timeSlots: ['11:00', '14:00', '16:30', '18:30'],
    maxPeople: 10
  },
  glaze: {
    name: 'Глазурный МК',
    basePrice: 1200,
    timeSlots: ['11:00', '13:00', '15:00', '17:00', '19:00'],
    maxPeople: 10
  },
  date: {
    name: 'Свидание',
    basePrice: 5000,
    timeSlots: Array.from({ length: 10 }, (_, i) => `${11 + i}:00`),
    maxPeople: 2
  },
  individual: {
    name: 'Индивидуальный МК',
    basePrice: 5000,
    timeSlots: Array.from({ length: 10 }, (_, i) => `${11 + i}:00`),
    maxPeople: 1
  },
  custom: {
    name: 'Свой МК',
    basePrice: 2500,
    timeSlots: Array.from({ length: 10 }, (_, i) => `${11 + i}:00`),
    maxPeople: 10
  },
  party: {
    name: 'Праздник/комьюнити',
    basePrice: 6500,
    timeSlots: Array.from({ length: 10 }, (_, i) => `${11 + i}:00`),
    maxPeople: 20 // по ТЗ: от 4 до 20
  },
  family: {
    name: 'Семейный МК',
    basePrice: 6500,
    timeSlots: Array.from({ length: 10 }, (_, i) => `${11 + i}:00`),
    maxPeople: 15 // по ТЗ: от 4 до 15
  },
  rent: {
    name: 'Аренда помещения',
    basePrice: null,
    timeSlots: Array.from({ length: 16 }, (_, i) => `${8 + i}:00`),
    maxPeople: null
  },
  order: {
    name: 'Изделие на заказ',
    basePrice: 4000,
    timeSlots: null,
    maxPeople: null
  },
  abonement: {
    name: 'Абонемент 4 занятия',
    basePrice: 7200,
    timeSlots: null,
    maxPeople: null
  },
  voucher: {
    name: 'Электронный талон',
    basePrice: null,
    timeSlots: null,
    maxPeople: null
  }
};

function getAvailableDates(days = 30) {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(new Date(), i);
    return format(d, 'dd-MM-yyyy');
  });
}

module.exports = { SERVICES, getAvailableDates };
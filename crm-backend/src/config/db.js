const mysql = require("mysql2/promise");
require("dotenv").config();

/**
 * Pool de conexiones: Optimizado para Nube (Aiven.io / DigitalOcean / AWS).
 * Incluye soporte para SSL obligatorio y strings de fecha.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: '-05:00',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  // SSL es obligatorio para la mayoría de bases de datos en la nube (como Aiven.io)
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : null
});

module.exports = pool;

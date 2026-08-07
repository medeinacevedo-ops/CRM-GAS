const mysql = require("mysql2/promise");
require("dotenv").config();

// Pool de conexiones: reutiliza conexiones en vez de abrir una nueva por cada consulta.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: '-05:00', // <--- AÑADE ESTA LÍNEA AQUÍ
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
});

module.exports = pool;

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

/**
 * IMPORTANTE: la opción `timezone: '-05:00'` de arriba, con
 * `dateStrings: true`, NO cambia lo que MySQL calcula al ejecutar
 * NOW() -- esa opción solo controla cómo el driver convierte objetos
 * Date de JS al insertar, y con dateStrings:true casi ni eso. NOW()
 * se evalúa en el propio servidor, usando el `time_zone` de la SESIÓN
 * de MySQL, que en Aiven viene por defecto en UTC. Por eso "marcar
 * entrada/salida" (que usa NOW() en jornadaController) mostraba una
 * hora ~5 horas adelantada de la de Perú.
 *
 * Esto fuerza el time_zone real de cada conexión del pool a Perú
 * (UTC-5, sin horario de verano), para que NOW(), CURDATE(), etc.
 * devuelvan la hora de Perú directamente -- sin tener que convertir
 * nada en el backend, el panel admin, ni la app del vendedor.
 */
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '-05:00'");
});

module.exports = pool;

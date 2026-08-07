require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function createTable() {
  try {
    console.log("Creando tabla de notificaciones...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notificaciones (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL COMMENT 'ej. venta, sistema',
        mensaje TEXT NOT NULL,
        leida TINYINT(1) DEFAULT 0,
        referencia_id BIGINT NULL COMMENT 'ID de la visita o lead relacionado',
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notif_leida (leida),
        INDEX idx_notif_fecha (creado_en)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'notificaciones' creada con éxito.");
  } catch (err) {
    console.error("Error al crear la tabla:", err.message);
  } finally {
    process.exit();
  }
}

createTable();

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

/**
 * Tabla de historial/auditoría de mensajes enviados por el admin a vendedores.
 * No es la fuente de la entrega en tiempo real (eso lo hace el evento de socket
 * "admin_message", que el buzón de la app escucha directamente) -- esta tabla
 * es solo para que el admin pueda ver qué se envió, a quién y cuándo.
 * vendedor_id NULL significa que el mensaje se envió a todos los vendedores activos.
 */
async function createTable() {
  try {
    console.log("Creando tabla de mensajes_admin...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensajes_admin (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        vendedor_id INT NULL COMMENT 'NULL = enviado a todos los vendedores activos',
        titulo VARCHAR(150) NOT NULL,
        contenido TEXT NOT NULL,
        enviado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mensajes_admin_fecha (enviado_en),
        INDEX idx_mensajes_admin_vendedor (vendedor_id),
        CONSTRAINT fk_mensajes_admin_admin FOREIGN KEY (admin_id) REFERENCES usuarios(id),
        CONSTRAINT fk_mensajes_admin_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'mensajes_admin' creada con éxito.");
  } catch (err) {
    console.error("Error al crear la tabla:", err.message);
  } finally {
    process.exit();
  }
}

createTable();

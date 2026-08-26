require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

/**
 * Registra, por cada mensaje enviado (mensajes_admin), una fila por cada
 * vendedor destinatario -- así sabemos si YA le llegó (via socket en vivo)
 * o sigue PENDIENTE (porque estaba desconectado en el momento del envío).
 * La app debe consultar GET /api/mensajes/pendientes al conectar/reconectar
 * y luego confirmar con PATCH /api/mensajes/pendientes/confirmar.
 */
async function createTable() {
  try {
    console.log("Creando tabla de mensajes_admin_entregas...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensajes_admin_entregas (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        mensaje_id BIGINT NOT NULL,
        vendedor_id INT NOT NULL,
        entregado TINYINT(1) NOT NULL DEFAULT 0,
        entregado_en DATETIME NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entregas_vendedor_pendiente (vendedor_id, entregado),
        CONSTRAINT fk_entregas_mensaje FOREIGN KEY (mensaje_id) REFERENCES mensajes_admin(id),
        CONSTRAINT fk_entregas_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'mensajes_admin_entregas' creada con éxito.");
  } catch (err) {
    console.error("Error al crear la tabla:", err.message);
  } finally {
    process.exit();
  }
}

createTable();

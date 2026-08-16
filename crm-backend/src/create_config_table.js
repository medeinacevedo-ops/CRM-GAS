require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function setup() {
  try {
    // 1. Crear tabla de configuraciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuraciones (
        clave VARCHAR(100) PRIMARY KEY,
        valor VARCHAR(255) NOT NULL,
        descripcion TEXT,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'configuraciones' lista.");

    // 2. Insertar valores por defecto si no existen
    const defaults = [
      ['comision_por_venta', '50', 'Monto en soles ganado por cada venta cerrada'],
      ['meta_ventas_mes', '20', 'Cantidad de ventas necesarias para llegar a la meta mensual']
    ];

    for (const [clave, valor, desc] of defaults) {
      await pool.query(
        "INSERT IGNORE INTO configuraciones (clave, valor, descripcion) VALUES (?, ?, ?)",
        [clave, valor, desc]
      );
    }
    console.log("Configuraciones iniciales cargadas.");

  } catch (err) {
    console.error("Error al configurar tabla:", err);
  } finally {
    process.exit();
  }
}
setup();

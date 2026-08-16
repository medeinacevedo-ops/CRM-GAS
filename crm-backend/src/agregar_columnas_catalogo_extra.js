require("dotenv").config();
const pool = require("./config/db");

/**
 * Agrega a `productos` los campos que faltaban para el módulo de
 * mantenimiento de catálogo del panel admin:
 *
 *  - marca: texto libre (ej. "Fagor", "Bosch")
 *  - unidad: texto libre (ej. "unidad", "litros", "juego")
 *  - tipo: lista fija ('Producto' | 'Tarifa' | 'Servicio'), con
 *    default 'Producto' para que los 9 productos ya cargados queden
 *    clasificados automáticamente sin dejar filas en NULL.
 *
 * Uso: node src/agregar_columnas_catalogo_extra.js
 */
async function run() {
  const [cols] = await pool.query(`SHOW COLUMNS FROM productos LIKE 'marca'`);
  if (cols.length === 0) {
    console.log("Añadiendo columnas marca, unidad y tipo a productos...");
    await pool.query(`
      ALTER TABLE productos
        ADD COLUMN marca VARCHAR(150) NULL,
        ADD COLUMN unidad VARCHAR(50) NULL,
        ADD COLUMN tipo ENUM('Producto', 'Tarifa', 'Servicio') NOT NULL DEFAULT 'Producto'
    `);
  } else {
    console.log("productos ya tiene las columnas marca/unidad/tipo.");
  }

  console.log("Listo.");
  process.exit();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

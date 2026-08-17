require("dotenv").config();
const pool = require("./config/db");

/**
 * Agrega `carga_id` a productos para poder:
 *  a) saber qué productos vinieron de qué carga masiva, y
 *  b) poder "deshacer" una carga de catálogo (igual que ya se puede con
 *     leads_base) sin borrar productos de otras cargas por accidente.
 *
 * Como importarProductos usa upsert (ON DUPLICATE KEY UPDATE) por código,
 * si un producto se actualiza en una carga posterior, su carga_id se
 * mueve a la más reciente -- eso es correcto: "deshacer" solo debe
 * afectar el estado actual, no un historial de versiones.
 *
 * Uso: node src/agregar_carga_id_productos.js
 */
async function run() {
  const [cols] = await pool.query(`SHOW COLUMNS FROM productos LIKE 'carga_id'`);
  if (cols.length === 0) {
    console.log("Añadiendo carga_id a productos...");
    await pool.query(`
      ALTER TABLE productos
        ADD COLUMN carga_id INT NULL,
        ADD CONSTRAINT fk_producto_carga FOREIGN KEY (carga_id) REFERENCES cargas_productos(id)
    `);
  } else {
    console.log("productos ya tiene carga_id.");
  }

  console.log("Listo.");
  process.exit();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

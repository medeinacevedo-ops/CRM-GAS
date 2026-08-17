require("dotenv").config();
const pool = require("./config/db");

/**
 * Solo lee y muestra las columnas actuales de `productos` -- no modifica
 * nada. Sirve para confirmar, sin ambigüedad, si la migración de
 * marca/unidad/tipo/carga_id realmente se aplicó en ESTA base de datos
 * (la misma que usa el servidor en producción, según el .env de esta
 * carpeta).
 *
 * Uso: node src/verificar_columnas_productos.js
 */
async function run() {
  console.log("Conectando a la base de datos configurada en este .env...");
  const [cols] = await pool.query(`SHOW COLUMNS FROM productos`);
  console.log("\nColumnas actuales de la tabla productos:");
  cols.forEach((c) => console.log(" -", c.Field, `(${c.Type})`));

  const nombres = cols.map((c) => c.Field);
  console.log("\n¿Tiene 'marca'? ", nombres.includes("marca"));
  console.log("¿Tiene 'unidad'?", nombres.includes("unidad"));
  console.log("¿Tiene 'tipo'?  ", nombres.includes("tipo"));
  console.log("¿Tiene 'carga_id'?", nombres.includes("carga_id"));

  process.exit();
}

run().catch((err) => {
  console.error("Error al conectar o consultar:", err.message);
  process.exit(1);
});

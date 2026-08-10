require("dotenv").config();
const pool = require("./config/db");

/**
 * Agrega columnas de auditoria a `jornadas`, para que quede registro de
 * qué admin corrigió manualmente una jornada (ej. un vendedor marcó
 * salida por error) y cuándo -- importante en un sistema que mide horas
 * trabajadas: la corrección debe poder hacerse, pero debe quedar rastro
 * de que fue una corrección manual y no el marcado real del vendedor.
 *
 * Uso: node src/agregar_columnas_auditoria_jornada.js
 */
async function run() {
  const [columnas] = await pool.query(`SHOW COLUMNS FROM jornadas LIKE 'editado_por_admin_id'`);
  if (columnas.length > 0) {
    console.log("Ya existen las columnas de auditoría.");
    process.exit();
  }

  console.log("Añadiendo columnas de auditoría a jornadas...");
  await pool.query(`
    ALTER TABLE jornadas
      ADD COLUMN editado_por_admin_id INT NULL,
      ADD COLUMN editado_en DATETIME NULL,
      ADD CONSTRAINT fk_jornadas_editado_por FOREIGN KEY (editado_por_admin_id) REFERENCES usuarios(id)
  `);
  console.log("Listo.");
  process.exit();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

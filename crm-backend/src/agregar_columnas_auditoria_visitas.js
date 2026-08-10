require("dotenv").config();
const pool = require("./config/db");

/**
 * Agrega columnas de auditoria a `visitas`, mismo criterio que ya se usa
 * en `jornadas` (ver agregar_columnas_auditoria_jornada.js): un vendedor
 * puede equivocarse al registrar el resultado de una visita (marcar
 * "no interesado" en vez de "venta cerrada", errar el monto/producto,
 * o registrar la visita sobre el cliente equivocado) y el admin necesita
 * poder corregirlo -- pero debe quedar rastro de que fue una corrección
 * manual y no el registro original hecho en campo.
 *
 * Uso: node src/agregar_columnas_auditoria_visitas.js
 */
async function run() {
  const [columnas] = await pool.query(`SHOW COLUMNS FROM visitas LIKE 'editado_por_admin_id'`);
  if (columnas.length > 0) {
    console.log("Ya existen las columnas de auditoría.");
    process.exit();
  }

  console.log("Añadiendo columnas de auditoría a visitas...");
  await pool.query(`
    ALTER TABLE visitas
      ADD COLUMN editado_por_admin_id INT NULL,
      ADD COLUMN editado_en DATETIME NULL,
      ADD CONSTRAINT fk_visitas_editado_por FOREIGN KEY (editado_por_admin_id) REFERENCES usuarios(id)
  `);
  console.log("Listo.");
  process.exit();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

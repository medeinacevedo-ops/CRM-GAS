require("dotenv").config();
const pool = require("./config/db");

/**
 * Prepara la base para las correcciones nuevas del menú Principal:
 *
 *  1. Pausas individuales: columnas de auditoría en registros_pausas
 *     (mismo patrón que jornadas y visitas).
 *  2. Intercambios: se agrega el estado 'revertido' al ENUM (para
 *     distinguir "rechazado antes de confirmarse" de "confirmado y
 *     luego revertido por un admin"), más columnas de auditoría.
 *
 * (La reasignación directa de leads reutiliza la tabla `asignaciones`
 * que ya existe, y "eliminar visita" no requiere columnas nuevas.)
 *
 * Uso: node src/agregar_columnas_correcciones_principal.js
 */
async function run() {
  const [colsPausas] = await pool.query(`SHOW COLUMNS FROM registros_pausas LIKE 'editado_por_admin_id'`);
  if (colsPausas.length === 0) {
    console.log("Añadiendo columnas de auditoría a registros_pausas...");
    await pool.query(`
      ALTER TABLE registros_pausas
        ADD COLUMN editado_por_admin_id INT NULL,
        ADD COLUMN editado_en DATETIME NULL,
        ADD CONSTRAINT fk_regpausas_editado_por FOREIGN KEY (editado_por_admin_id) REFERENCES usuarios(id)
    `);
  } else {
    console.log("registros_pausas ya tiene columnas de auditoría.");
  }

  const [colsInterc] = await pool.query(`SHOW COLUMNS FROM intercambios_leads LIKE 'revertido_por_admin_id'`);
  if (colsInterc.length === 0) {
    console.log("Añadiendo soporte de reversión a intercambios_leads...");
    await pool.query(`
      ALTER TABLE intercambios_leads
        MODIFY COLUMN estado ENUM('pendiente', 'confirmado', 'rechazado', 'revertido') NOT NULL DEFAULT 'pendiente',
        ADD COLUMN revertido_por_admin_id INT NULL,
        ADD COLUMN revertido_en DATETIME NULL,
        ADD CONSTRAINT fk_interc_revertido_por FOREIGN KEY (revertido_por_admin_id) REFERENCES usuarios(id)
    `);
  } else {
    console.log("intercambios_leads ya tiene soporte de reversión.");
  }

  console.log("Listo.");
  process.exit();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

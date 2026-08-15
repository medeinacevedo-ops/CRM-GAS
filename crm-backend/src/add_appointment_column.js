require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function update() {
  try {
    // 1. Agregar columna proxima_cita a la tabla leads
    const [columns] = await pool.query("SHOW COLUMNS FROM leads LIKE 'proxima_cita'");
    if (columns.length === 0) {
      await pool.query("ALTER TABLE leads ADD COLUMN proxima_cita DATETIME NULL AFTER fecha_asignacion");
      console.log("Columna 'proxima_cita' añadida a la tabla leads.");
    } else {
      console.log("La columna 'proxima_cita' ya existe.");
    }

    // 2. Opcional: Agregar índice para búsquedas rápidas por fecha de cita
    await pool.query("CREATE INDEX idx_leads_proxima_cita ON leads(proxima_cita)");
    console.log("Índice creado para 'proxima_cita'.");

  } catch (err) {
    console.error("Error al actualizar la base de datos:", err);
  } finally {
    process.exit();
  }
}
update();

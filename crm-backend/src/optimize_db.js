require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function optimize() {
  try {
    console.log("Iniciando optimización de base de datos...");

    // 1. Índices para la tabla 'visitas'
    console.log("Optimizando tabla 'visitas'...");
    await pool.query("ALTER TABLE visitas ADD INDEX IF NOT EXISTS idx_visitas_vendedor_fecha (vendedor_id, fecha)");
    await pool.query("ALTER TABLE visitas ADD INDEX IF NOT EXISTS idx_visitas_resultado (resultado)");

    // 2. Índices para la tabla 'leads_base'
    console.log("Optimizando tabla 'leads_base'...");
    await pool.query("ALTER TABLE leads_base ADD INDEX IF NOT EXISTS idx_leadsbase_distrito (distrito)");
    await pool.query("ALTER TABLE leads_base ADD INDEX IF NOT EXISTS idx_leadsbase_nombre (nombre)");

    // 3. Índices para la tabla 'jornadas'
    console.log("Optimizando tabla 'jornadas'...");
    await pool.query("ALTER TABLE jornadas ADD INDEX IF NOT EXISTS idx_jornadas_vendedor_fecha (vendedor_id, fecha)");

    // 4. Índices para la tabla 'leads'
    console.log("Optimizando tabla 'leads'...");
    await pool.query("ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_vendedor_estado (vendedor_id, estado)");

    console.log("¡Optimización completada con éxito! El motor MySQL ahora es más eficiente.");
  } catch (err) {
    console.error("Error durante la optimización:", err.message);
  } finally {
    process.exit();
  }
}

optimize();

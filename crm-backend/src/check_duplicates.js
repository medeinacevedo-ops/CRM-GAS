require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function check() {
  try {
    console.log("Auditoría de duplicidad en Leads...");

    const [dupes] = await pool.query(`
      SELECT lead_base_id, COUNT(*) as cantidad
      FROM leads
      GROUP BY lead_base_id
      HAVING cantidad > 1
    `);

    if (dupes.length > 0) {
      console.log(`¡Se encontraron ${dupes.length} IDs duplicados!`);
      dupes.forEach(d => console.log(`LeadBaseID: ${d.lead_base_id} se repite ${d.cantidad} veces.`));
    } else {
      console.log("No hay duplicados de IDs base en la tabla operativa.");
    }

    const [[totalLeads]] = await pool.query("SELECT COUNT(*) as total FROM leads");
    const [[totalBase]] = await pool.query("SELECT COUNT(*) as total FROM leads_base");
    console.log(`Total en Leads (Operativo): ${totalLeads.total}`);
    console.log(`Total en Leads_Base (Cargado): ${totalBase.total}`);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();

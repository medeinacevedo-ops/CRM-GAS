require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function fix() {
  try {
    console.log("Checking database...");
    const [colsOfrecidos] = await pool.query("SHOW COLUMNS FROM intercambios_leads LIKE 'leads_ofrecidos'");
    if (colsOfrecidos.length === 0) {
      console.log("Adding leads_ofrecidos and leads_recibidos columns...");
      await pool.query("ALTER TABLE intercambios_leads ADD COLUMN leads_ofrecidos TEXT DEFAULT NULL, ADD COLUMN leads_recibidos TEXT DEFAULT NULL");
      console.log("Columns added successfully.");
    } else {
      console.log("Columns already exist.");
    }
  } catch (err) {
    console.error("Error fixing database:", err);
  } finally {
    process.exit();
  }
}

fix();

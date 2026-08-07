require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function fix() {
  try {
    console.log("Checking database...");
    const [columns] = await pool.query("SHOW COLUMNS FROM visitas LIKE 'firma_url'");
    if (columns.length === 0) {
      console.log("Adding firma_url column to visitas table...");
      await pool.query("ALTER TABLE visitas ADD COLUMN firma_url VARCHAR(255) DEFAULT NULL");
      console.log("Column added successfully.");
    } else {
      console.log("firma_url column already exists.");
    }
  } catch (err) {
    console.error("Error fixing database:", err);
  } finally {
    process.exit();
  }
}

fix();

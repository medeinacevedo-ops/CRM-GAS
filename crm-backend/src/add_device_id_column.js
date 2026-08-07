require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function run() {
  try {
    console.log("Añadiendo columna session_device_id a usuarios...");
    const [cols] = await pool.query("SHOW COLUMNS FROM usuarios LIKE 'session_device_id'");
    if (cols.length === 0) {
      await pool.query("ALTER TABLE usuarios ADD COLUMN session_device_id VARCHAR(255) NULL");
      console.log("Éxito.");
    } else {
      console.log("Ya existe la columna.");
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();

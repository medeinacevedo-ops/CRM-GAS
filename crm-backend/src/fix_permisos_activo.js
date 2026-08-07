require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function fix() {
  try {
    console.log("Chequeando tabla permisos_supervisor...");
    const [columns] = await pool.query("SHOW COLUMNS FROM permisos_supervisor LIKE 'activo'");
    if (columns.length === 0) {
      console.log("Añadiendo columna 'activo'...");
      await pool.query("ALTER TABLE permisos_supervisor ADD COLUMN activo TINYINT(1) DEFAULT 1");
      console.log("Éxito.");
    } else {
      console.log("La columna 'activo' ya existe.");
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

fix();

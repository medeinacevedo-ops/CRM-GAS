require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function check() {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE id = 3`
    );
    console.log("Usuario ID 3:");
    rows.forEach(r => console.log(`- ID: ${r.id}, Nombre: ${r.nombre}`));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
check();

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function update() {
  try {
    await pool.query("UPDATE usuarios SET zona_id = 2 WHERE id = 1");
    console.log("Admin Principal asignado a la zona de COMAS exitosamente.");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
update();

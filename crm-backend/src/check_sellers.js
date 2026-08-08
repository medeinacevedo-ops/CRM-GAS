require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function check() {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.zona_id, z.nombre as zona_nombre
       FROM usuarios u
       LEFT JOIN zonas z ON z.id = u.zona_id
       WHERE u.rol = 'vendedor' AND u.activo = 1`
    );
    console.log("Vendedores disponibles para intercambio:");
    rows.forEach(r => console.log(`- ID: ${r.id}, Nombre: ${r.nombre}, Zona: ${r.zona_nombre || 'N/A'}`));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
check();

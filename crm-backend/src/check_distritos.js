require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function check() {
  try {
    const [zDistritos] = await pool.query("SELECT * FROM zonas");
    console.log("Zonas registradas:");
    zDistritos.forEach(d => console.log(`- ID: ${d.id}, Nombre: ${d.nombre}, Distrito: '${d.distrito}'`));

    const [uZonas] = await pool.query("SELECT id, nombre, email, zona_id FROM usuarios WHERE rol='vendedor'");
    console.log("\nZona de vendedores:");
    uZonas.forEach(u => console.log(`- Vendedor: ${u.nombre}, ZonaID: ${u.zona_id}`));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
check();

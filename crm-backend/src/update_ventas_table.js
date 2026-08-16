require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function setup() {
  try {
    console.log("Actualizando tabla 'ventas'...");

    const [columns] = await pool.query("SHOW COLUMNS FROM ventas");
    const columnNames = columns.map(c => c.Field);

    if (!columnNames.includes('producto_id')) {
        await pool.query("ALTER TABLE ventas ADD COLUMN producto_id INT NULL AFTER visita_id");
        console.log("Columna 'producto_id' añadida.");
    }

    if (!columnNames.includes('comision')) {
        await pool.query("ALTER TABLE ventas ADD COLUMN comision DECIMAL(10,2) DEFAULT 0.00 AFTER monto");
        console.log("Columna 'comision' añadida.");
    }

    try {
        await pool.query("ALTER TABLE ventas ADD CONSTRAINT fk_venta_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL");
        console.log("FK 'fk_venta_producto' añadida.");
    } catch(e) {
        console.log("FK ya existía o error al añadirla (posiblemente ignorado)");
    }

    await pool.query("UPDATE ventas SET comision = 50.00 WHERE comision = 0 AND producto_id IS NULL");
    console.log("Comisiones históricas regularizadas.");

  } catch (err) {
    console.error("Error al actualizar tabla:", err);
  } finally {
    process.exit();
  }
}
setup();

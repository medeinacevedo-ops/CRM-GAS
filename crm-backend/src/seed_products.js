require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function seed() {
  const productos = [
    ['CAL-001-01', 'ROTOPLAS: TERMA', 'Termas', 499.00, 25.00, 'Marca: ROTOPLAS, Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-002-01', 'TERMA EVOLUTION', 'Termas', 569.00, 25.00, 'Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-003-01', 'TERMA A GAS', 'Termas', 569.00, 25.00, 'Marca: AQUAMAXX, Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-001-02', 'COCINA DE PIE 4H', 'Cocinas', 1199.00, 60.00, 'Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-002-02', 'COCINA', 'Cocinas', 1290.00, 60.00, 'Marca: SOLE, Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-001-03', 'ESTUFA', 'Estufas', 787.00, 40.00, 'Marca: SOLE, Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-001-04', 'SECADORA A GAS', 'Secadoras', 2949.00, 100.00, 'Marca: INDURAMA, Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-001-05', 'COCINA COMBOS', 'Combos', 4820.00, 150.00, 'Unidad: UND, Tipo: Producto. Precio público.'],
    ['CAL-001-06', 'Kit de conexión para gas', 'Accesorios', 150.00, 10.00, 'Tipo: Servicio. Instalación estándar.']
  ];

  try {
    console.log("Insertando productos iniciales de A3 PULSE...");

    for (const [cod, nom, cat, pre, com, desc] of productos) {
      await pool.query(
        `INSERT INTO productos (codigo, nombre, categoria, precio_lista, comision, descripcion)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), precio_lista=VALUES(precio_lista)`,
        [cod, nom, cat, pre, com, desc]
      );
    }

    console.log("¡Productos insertados con éxito!");

  } catch (err) {
    console.error("Error al insertar productos:", err);
  } finally {
    process.exit();
  }
}
seed();

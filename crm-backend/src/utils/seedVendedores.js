/**
 * Crea 40 vendedores de prueba (20 en Zona SJL, 20 en Zona Comas) con password
 * real hasheado. Usa la misma configuracion de conexion que el backend (.env).
 *
 * Uso:
 *   node src/utils/seedVendedores.js
 *
 * Password de todos los vendedores creados: Vendedor123!
 * (cada uno con su propio email: vendedor01@empresa.com ... vendedor40@empresa.com)
 */
const bcrypt = require("bcrypt");
const pool = require("../config/db");

const NOMBRES = [
  "Jorge Ramirez", "Lucia Campos", "Miguel Torres", "Rosa Salas", "Carlos Huaman",
  "Maria Quispe", "Luis Fernandez", "Ana Mamani", "Jose Rojas", "Carmen Flores",
  "Pedro Vargas", "Elena Castillo", "Victor Chavez", "Patricia Diaz", "Raul Gutierrez",
  "Sofia Herrera", "Manuel Paredes", "Diana Rios", "Fernando Vega", "Gabriela Cruz",
  "Andres Medina", "Karen Ortiz", "Ricardo Silva", "Vanessa Reyes", "Oscar Espinoza",
  "Milagros Guerra", "Julio Aguilar", "Nancy Cordova", "Cesar Ponce", "Yolanda Ibarra",
  "Hugo Salazar", "Roxana Delgado", "Marco Zevallos", "Cynthia Palomino", "Willy Cabrera",
  "Estela Nunez", "Freddy Roman", "Silvia Bautista", "Alberto Cisneros", "Karina Vidal",
];

async function main() {
  const passwordPlano = "Vendedor123!";
  const hash = await bcrypt.hash(passwordPlano, 10);

  const [zonas] = await pool.query(`SELECT id, nombre FROM zonas ORDER BY id LIMIT 2`);
  if (zonas.length < 2) {
    console.error("Necesitas al menos 2 zonas creadas (ya vienen en el script SQL semilla).");
    process.exit(1);
  }

  const valores = NOMBRES.map((nombre, i) => {
    const n = i + 1;
    const email = `vendedor${String(n).padStart(2, "0")}@empresa.com`;
    const telefono = `9${String(10000000 + n).slice(0, 8)}`;
    const zonaId = zonas[i % 2].id; // alterna entre las 2 zonas
    return [nombre, email, telefono, hash, "vendedor", zonaId, 1];
  });

  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO usuarios (nombre, email, telefono, password_hash, rol, zona_id, activo) VALUES ?`,
      [valores]
    );
    console.log(`${valores.length} vendedores creados correctamente.`);
    console.log(`Password para todos: ${passwordPlano}`);
    console.log(`Emails: vendedor01@empresa.com ... vendedor40@empresa.com`);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.error("Ya existen vendedores con esos emails. Borra la tabla usuarios (excepto el admin) si quieres regenerarlos.");
    } else {
      console.error("Error al insertar vendedores:", err.message);
    }
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();

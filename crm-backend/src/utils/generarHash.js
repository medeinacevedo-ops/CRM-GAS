/**
 * Utilidad de linea de comandos para generar el hash bcrypt de una contraseña.
 * Uso: node src/utils/generarHash.js "miPasswordSegura"
 * Copia el resultado en la columna password_hash del usuario admin en la base de datos.
 */
const bcrypt = require("bcrypt");

const password = process.argv[2];
if (!password) {
  console.error("Uso: node src/utils/generarHash.js <password>");
  process.exit(1);
}

bcrypt.hash(password, 10).then((hash) => {
  console.log(hash);
});

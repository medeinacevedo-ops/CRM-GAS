require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const pool = require("./config/db");

/**
 * Crea (si no existe) la tabla `ubigeo` y la puebla desde un CSV.
 *
 * Por que hace falta este script: ubigeoController.js consulta una tabla
 * `ubigeo` con columnas NOMBDEP/NOMBPROV/NOMBDIST que nunca fue creada ni
 * poblada -- por eso los selectores de Departamento/Provincia/Distrito del
 * panel admin (editar zona) muestran "Error al cargar": las 4 rutas de
 * /api/ubigeo/* devuelven 500 porque la tabla no existe.
 *
 * Uso:
 *   node src/importar_ubigeo.js ruta/al/archivo.csv
 *
 * El CSV puede venir con cualquiera de estos encabezados (no importa el
 * orden ni mayus/minus), ya que se detectan por nombre:
 *   - ubigeo | codigo            (opcional, codigo de 6 digitos INEI)
 *   - departamento | nombdep
 *   - provincia | nombprov
 *   - distrito | nombdist
 *
 * Fuente sugerida del CSV (dataset publico de division politica del Peru,
 * el mismo que usan la mayoria de proyectos de este tipo):
 *   https://github.com/ernestorivero/Ubigeo-Peru
 *   https://github.com/jmcastagnetto/ubigeo-peru-aumentado
 *   https://github.com/geodir/ubigeo-peru
 */

const RUTA_CSV = process.argv[2];
const TAMANO_LOTE = 500;

function normalizarEncabezado(h) {
  return h.trim().toLowerCase();
}

function detectarColumna(encabezados, alias) {
  const idx = encabezados.findIndex((h) => alias.includes(normalizarEncabezado(h)));
  return idx === -1 ? null : idx;
}

async function crearTabla() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ubigeo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      CODIGO VARCHAR(6) NULL,
      NOMBDEP VARCHAR(100) NOT NULL,
      NOMBPROV VARCHAR(100) NOT NULL,
      NOMBDIST VARCHAR(100) NOT NULL,
      INDEX idx_ubigeo_dep (NOMBDEP),
      INDEX idx_ubigeo_dep_prov (NOMBDEP, NOMBPROV),
      INDEX idx_ubigeo_dist (NOMBDIST)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function importar() {
  if (!RUTA_CSV) {
    console.error("Debes indicar la ruta del CSV. Uso: node src/importar_ubigeo.js ruta/al/archivo.csv");
    process.exit(1);
  }
  if (!fs.existsSync(RUTA_CSV)) {
    console.error(`No se encontró el archivo: ${RUTA_CSV}`);
    process.exit(1);
  }

  console.log("Creando tabla 'ubigeo' (si no existe)...");
  await crearTabla();

  const [[{ total: totalExistente }]] = await pool.query("SELECT COUNT(*) AS total FROM ubigeo");
  if (totalExistente > 0) {
    console.log(`La tabla ya tiene ${totalExistente} registros. Se vaciará antes de reimportar.`);
    await pool.query("TRUNCATE TABLE ubigeo");
  }

  console.log("Leyendo CSV...");
  const contenido = fs.readFileSync(RUTA_CSV, "utf8");
  const registros = parse(contenido, { columns: false, skip_empty_lines: true, trim: true });

  const encabezados = registros.shift();
  if (!encabezados) {
    console.error("El CSV está vacío.");
    process.exit(1);
  }

  const colCodigo = detectarColumna(encabezados, ["ubigeo", "codigo"]);
  const colDep = detectarColumna(encabezados, ["departamento", "nombdep"]);
  const colProv = detectarColumna(encabezados, ["provincia", "nombprov"]);
  const colDist = detectarColumna(encabezados, ["distrito", "nombdist"]);

  if (colDep === null || colProv === null || colDist === null) {
    console.error(
      "No se pudieron detectar las columnas departamento/provincia/distrito en el CSV.\n" +
      `Encabezados encontrados: ${encabezados.join(", ")}`
    );
    process.exit(1);
  }

  console.log(`Importando ${registros.length} registros en lotes de ${TAMANO_LOTE}...`);

  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const valores = lote.map((fila) => [
      colCodigo !== null ? fila[colCodigo] : null,
      fila[colDep].toUpperCase(),
      fila[colProv].toUpperCase(),
      fila[colDist].toUpperCase(),
    ]);

    await pool.query("INSERT INTO ubigeo (CODIGO, NOMBDEP, NOMBPROV, NOMBDIST) VALUES ?", [valores]);
    insertados += lote.length;
    process.stdout.write(`\r  ${insertados}/${registros.length}`);
  }

  console.log(`\nListo. Se importaron ${insertados} registros en la tabla 'ubigeo'.`);
}

importar()
  .catch((err) => console.error("Error al importar el ubigeo:", err.message))
  .finally(() => process.exit());

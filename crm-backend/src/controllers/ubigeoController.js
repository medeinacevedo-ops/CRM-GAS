const pool = require("../config/db");

/**
 * Lista los 25 departamentos del Peru (sin duplicados).
 */
async function listarDepartamentos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT NOMBDEP AS departamento FROM ubigeo ORDER BY NOMBDEP`
    );
    res.json(rows.map((r) => r.departamento));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar departamentos" });
  }
}

/**
 * Lista las provincias de un departamento especifico.
 * ?departamento=LIMA
 */
async function listarProvincias(req, res) {
  const { departamento } = req.query;
  if (!departamento) return res.status(400).json({ error: "departamento es requerido" });

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT NOMBPROV AS provincia FROM ubigeo WHERE NOMBDEP = ? ORDER BY NOMBPROV`,
      [departamento]
    );
    res.json(rows.map((r) => r.provincia));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar provincias" });
  }
}

/**
 * Lista los distritos de una provincia especifica.
 * ?departamento=LIMA&provincia=LIMA
 */
async function listarDistritos(req, res) {
  const { departamento, provincia } = req.query;
  if (!departamento || !provincia) {
    return res.status(400).json({ error: "departamento y provincia son requeridos" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT NOMBDIST AS distrito FROM ubigeo WHERE NOMBDEP = ? AND NOMBPROV = ? ORDER BY NOMBDIST`,
      [departamento, provincia]
    );
    res.json(rows.map((r) => r.distrito));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar distritos" });
  }
}

/**
 * Busca el departamento y provincia a los que pertenece un distrito dado,
 * para poder pre-seleccionar los 3 selectores en cascada al editar una zona
 * (la zona solo guarda el nombre del distrito, no su departamento/provincia).
 * ?distrito=SAN JUAN DE LURIGANCHO
 */
async function buscarPorDistrito(req, res) {
  const { distrito } = req.query;
  if (!distrito) return res.status(400).json({ error: "distrito es requerido" });

  try {
    const [[fila]] = await pool.query(
      `SELECT NOMBDEP AS departamento, NOMBPROV AS provincia, NOMBDIST AS distrito
       FROM ubigeo
       WHERE UPPER(TRIM(NOMBDIST)) = UPPER(TRIM(?))
       LIMIT 1`,
      [distrito]
    );
    if (!fila) return res.status(404).json({ error: "No se encontró ese distrito en el ubigeo" });
    res.json(fila);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar el distrito" });
  }
}

module.exports = { listarDepartamentos, listarProvincias, listarDistritos, buscarPorDistrito };

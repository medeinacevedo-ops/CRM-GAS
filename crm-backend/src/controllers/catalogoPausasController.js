const pool = require("../config/db");

async function listarCatalogoPausas(req, res) {
  const { tipo } = req.query;
  const condiciones = [];
  const valores = [];
  if (tipo) {
    condiciones.push("tipo = ?");
    valores.push(tipo);
  }
  // El vendedor solo necesita ver motivos activos para elegir uno al marcar pausa.
  // El admin ve todo (activos e inactivos) para poder gestionarlos.
  if (req.usuario.rol === "vendedor") {
    condiciones.push("activo = 1");
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, tipo, tiempo_max_minutos, activo, creado_en
       FROM catalogo_pausas ${where}
       ORDER BY tipo, nombre`,
      valores
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar el catalogo de pausas" });
  }
}

async function crearPausa(req, res) {
  const { nombre, tipo, tiempo_max_minutos } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ error: "nombre y tipo son requeridos" });
  }
  if (!["desconexion", "reductor"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'desconexion' o 'reductor'" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO catalogo_pausas (nombre, tipo, tiempo_max_minutos, activo, creado_por)
       VALUES (?, ?, ?, 1, ?)`,
      [nombre, tipo, tiempo_max_minutos || null, req.usuario.id]
    );
    res.status(201).json({ id: result.insertId, nombre, tipo, tiempo_max_minutos: tiempo_max_minutos || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el motivo de pausa" });
  }
}

async function actualizarPausa(req, res) {
  const { id } = req.params;
  const { nombre, tipo, tiempo_max_minutos } = req.body;

  if (tipo && !["desconexion", "reductor"].includes(tipo)) {
    return res.status(400).json({ error: "tipo debe ser 'desconexion' o 'reductor'" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE catalogo_pausas SET
         nombre = COALESCE(?, nombre),
         tipo = COALESCE(?, tipo),
         tiempo_max_minutos = ?
       WHERE id = ?`,
      [nombre ?? null, tipo ?? null, tiempo_max_minutos ?? null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Motivo no encontrado" });
    res.json({ mensaje: "Motivo actualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el motivo de pausa" });
  }
}

async function cambiarEstadoPausa(req, res) {
  const { id } = req.params;
  const { activo } = req.body;
  if (activo !== 0 && activo !== 1) {
    return res.status(400).json({ error: "activo debe ser 0 o 1" });
  }

  try {
    const [result] = await pool.query(`UPDATE catalogo_pausas SET activo = ? WHERE id = ?`, [activo, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Motivo no encontrado" });
    res.json({ mensaje: activo ? "Motivo activado" : "Motivo desactivado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado del motivo" });
  }
}

/**
 * Elimina un motivo del catalogo. Si ya fue usado en registros_pausas
 * (algun vendedor lo marco alguna vez), la base de datos rechaza el borrado
 * por la llave foranea -- en ese caso se sugiere desactivar en vez de
 * eliminar, para no perder el historial de esas pausas ya registradas.
 */
async function eliminarPausa(req, res) {
  const { id } = req.params;
  try {
    const [result] = await pool.query(`DELETE FROM catalogo_pausas WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Motivo no encontrado" });
    res.json({ mensaje: "Motivo eliminado" });
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        error: "No se puede eliminar: ya existen pausas registradas con este motivo. Desactivalo en su lugar.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el motivo" });
  }
}

module.exports = {
  listarCatalogoPausas,
  crearPausa,
  actualizarPausa,
  cambiarEstadoPausa,
  eliminarPausa,
};

const pool = require("../config/db");

/**
 * Lista zonas con conteo de vendedores asignados y leads totales,
 * util para que el admin vea de un vistazo el tamano de cada zona.
 */
async function listarZonas(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT z.id, z.nombre, z.distrito, z.activo,
              (SELECT COUNT(*) FROM usuarios u WHERE u.zona_id = z.id AND u.rol = 'vendedor') AS vendedores,
              (SELECT COUNT(*) FROM leads l WHERE l.zona_id = z.id) AS leads_totales
       FROM zonas z
       ORDER BY z.nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar zonas" });
  }
}

async function crearZona(req, res) {
  const { nombre, distrito } = req.body;
  if (!nombre || !distrito) {
    return res.status(400).json({ error: "nombre y distrito son requeridos" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO zonas (nombre, distrito, activo) VALUES (?, ?, 1)`,
      [nombre, distrito]
    );
    res.status(201).json({ id: result.insertId, nombre, distrito });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la zona" });
  }
}

async function actualizarZona(req, res) {
  const { id } = req.params;
  const { nombre, distrito } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE zonas SET nombre = COALESCE(?, nombre), distrito = COALESCE(?, distrito) WHERE id = ?`,
      [nombre ?? null, distrito ?? null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Zona no encontrada" });
    res.json({ mensaje: "Zona actualizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la zona" });
  }
}

async function cambiarEstadoZona(req, res) {
  const { id } = req.params;
  const { activo } = req.body;
  if (activo !== 0 && activo !== 1) {
    return res.status(400).json({ error: "activo debe ser 0 o 1" });
  }

  try {
    const [result] = await pool.query(`UPDATE zonas SET activo = ? WHERE id = ?`, [activo, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Zona no encontrada" });
    res.json({ mensaje: activo ? "Zona activada" : "Zona desactivada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado de la zona" });
  }
}

/**
 * Elimina una zona. Si ya tiene vendedores o leads asociados, la base de
 * datos rechaza el borrado por las llaves foraneas -- se sugiere
 * desactivar en vez de eliminar para conservar el historial.
 */
async function eliminarZona(req, res) {
  const { id } = req.params;
  try {
    const [result] = await pool.query(`DELETE FROM zonas WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Zona no encontrada" });
    res.json({ mensaje: "Zona eliminada" });
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        error: "No se puede eliminar: esta zona tiene vendedores o leads asociados. Desactivala en su lugar.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la zona" });
  }
}

module.exports = { listarZonas, crearZona, actualizarZona, cambiarEstadoZona, eliminarZona };

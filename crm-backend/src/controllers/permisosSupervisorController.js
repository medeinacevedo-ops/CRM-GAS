const pool = require("../config/db");

/**
 * Lista todos los permisos otorgados a supervisores, con nombres legibles
 * en vez de solo IDs (supervisor, zona o vendedor especifico).
 */
async function listarPermisos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT ps.id, ps.puede_ver_kpis, ps.puede_ver_ubicacion, ps.creado_en, ps.activo,
              s.id AS supervisor_id, s.nombre AS supervisor,
              z.id AS zona_id, z.nombre AS zona,
              v.id AS vendedor_id, v.nombre AS vendedor,
              a.nombre AS otorgado_por
       FROM permisos_supervisor ps
       JOIN usuarios s ON s.id = ps.supervisor_id
       LEFT JOIN zonas z ON z.id = ps.zona_id
       LEFT JOIN usuarios v ON v.id = ps.vendedor_id
       LEFT JOIN usuarios a ON a.id = ps.otorgado_por
       ORDER BY ps.creado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar los permisos de supervisor" });
  }
}

/**
 * Otorga un permiso a un supervisor: puede ser sobre una ZONA completa
 * (ve a todos los vendedores de esa zona) o sobre UN vendedor especifico
 * (acceso mas granular). Debe indicarse exactamente uno de los dos.
 */
async function otorgarPermiso(req, res) {
  const { supervisor_id, zona_id, vendedor_id, puede_ver_kpis, puede_ver_ubicacion } = req.body;

  if (!supervisor_id) return res.status(400).json({ error: "supervisor_id es requerido" });
  if (!zona_id && !vendedor_id) {
    return res.status(400).json({ error: "Debes indicar zona_id o vendedor_id (uno de los dos)" });
  }
  if (zona_id && vendedor_id) {
    return res.status(400).json({ error: "Indica solo zona_id O vendedor_id, no ambos" });
  }

  try {
    const [[supervisor]] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'supervisor'`,
      [supervisor_id]
    );
    if (!supervisor) return res.status(404).json({ error: "Supervisor no encontrado (verifica que su rol sea 'supervisor')" });

    if (zona_id) {
      const [[zona]] = await pool.query(`SELECT id FROM zonas WHERE id = ?`, [zona_id]);
      if (!zona) return res.status(404).json({ error: "Zona no encontrada" });
    }
    if (vendedor_id) {
      const [[vendedor]] = await pool.query(
        `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor'`,
        [vendedor_id]
      );
      if (!vendedor) return res.status(404).json({ error: "Vendedor no encontrado" });
    }

    const [result] = await pool.query(
      `INSERT INTO permisos_supervisor
         (supervisor_id, zona_id, vendedor_id, puede_ver_kpis, puede_ver_ubicacion, otorgado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        supervisor_id,
        zona_id || null,
        vendedor_id || null,
        puede_ver_kpis ? 1 : 0,
        puede_ver_ubicacion ? 1 : 0,
        req.usuario.id,
      ]
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al otorgar el permiso" });
  }
}

/**
 * Revoca (elimina) un permiso otorgado.
 */
async function revocarPermiso(req, res) {
  const { id } = req.params;
  try {
    const [result] = await pool.query(`DELETE FROM permisos_supervisor WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Permiso no encontrado" });
    res.json({ mensaje: "Permiso revocado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al revocar el permiso" });
  }
}

async function actualizarPermiso(req, res) {
  const { id } = req.params;
  const { puede_ver_kpis, puede_ver_ubicacion, activo, zona_id, vendedor_id } = req.body;

  // El alcance (zona vs vendedor) es opcional en la edición: solo se valida
  // y se reemplaza si el request trae explícitamente alguno de los dos campos.
  const cambiaAlcance = zona_id !== undefined || vendedor_id !== undefined;

  if (cambiaAlcance) {
    if (!zona_id && !vendedor_id) {
      return res.status(400).json({ error: "Debes indicar zona_id o vendedor_id (uno de los dos)" });
    }
    if (zona_id && vendedor_id) {
      return res.status(400).json({ error: "Indica solo zona_id O vendedor_id, no ambos" });
    }
    if (zona_id) {
      const [[zona]] = await pool.query(`SELECT id FROM zonas WHERE id = ?`, [zona_id]);
      if (!zona) return res.status(404).json({ error: "Zona no encontrada" });
    }
    if (vendedor_id) {
      const [[vendedor]] = await pool.query(
        `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor'`,
        [vendedor_id]
      );
      if (!vendedor) return res.status(404).json({ error: "Vendedor no encontrado" });
    }
  }

  try {
    const campos = [
      "puede_ver_kpis = COALESCE(?, puede_ver_kpis)",
      "puede_ver_ubicacion = COALESCE(?, puede_ver_ubicacion)",
      "activo = COALESCE(?, activo)",
    ];
    const valores = [puede_ver_kpis, puede_ver_ubicacion, activo];

    if (cambiaAlcance) {
      campos.push("zona_id = ?", "vendedor_id = ?");
      valores.push(zona_id || null, vendedor_id || null);
    }

    valores.push(id);

    const [result] = await pool.query(
      `UPDATE permisos_supervisor SET ${campos.join(", ")} WHERE id = ?`,
      valores
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Permiso no encontrado" });

    res.json({ mensaje: "Permiso actualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar permiso" });
  }
}

async function cambiarEstadoPermiso(req, res) {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    await pool.query("UPDATE permisos_supervisor SET activo = ? WHERE id = ?", [activo, id]);
    res.json({ mensaje: "Estado actualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar estado" });
  }
}

module.exports = { listarPermisos, otorgarPermiso, revocarPermiso, actualizarPermiso, cambiarEstadoPermiso };

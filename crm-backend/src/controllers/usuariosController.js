const bcrypt = require("bcrypt");
const pool = require("../config/db");

/**
 * Lista usuarios. Admin puede filtrar por rol y zona via query params
 * (?rol=vendedor&zona_id=1). No devuelve password_hash.
 */
async function listarUsuarios(req, res) {
  const { rol, zona_id } = req.query;
  const condiciones = [];
  const valores = [];

  if (rol) {
    condiciones.push("u.rol = ?");
    valores.push(rol);
  }
  if (zona_id) {
    condiciones.push("u.zona_id = ?");
    valores.push(zona_id);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const [usuarios] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.rol, u.activo,
              u.zona_id, z.nombre AS zona_nombre, z.distrito,
              (SELECT COUNT(*) FROM leads l WHERE l.vendedor_id = u.id AND l.estado IN ('asignado','contactado')) AS cartera_total
       FROM usuarios u
       LEFT JOIN zonas z ON z.id = u.zona_id
       ${where}
       ORDER BY u.rol, u.nombre`,
      valores
    );

    // Obtener desglose de distritos para todos los usuarios obtenidos
    if (usuarios.length > 0) {
      const userIds = usuarios.map(u => u.id);
      const [breakdowns] = await pool.query(
        `SELECT l.vendedor_id, lb.distrito, COUNT(*) as cantidad
         FROM leads l
         JOIN leads_base lb ON lb.id = l.lead_base_id
         WHERE l.vendedor_id IN (?) AND l.estado IN ('asignado', 'contactado')
         GROUP BY l.vendedor_id, lb.distrito`,
        [userIds]
      );

      // Mapear los desgloses a cada usuario
      usuarios.forEach(u => {
        u.desglose_distritos = breakdowns
          .filter(b => b.vendedor_id === u.id)
          .map(b => ({ distrito: b.distrito, cantidad: b.cantidad }));
      });
    }

    res.json(usuarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
}

/**
 * Crea un nuevo usuario (vendedor, supervisor o admin). Hashea la password
 * con bcrypt antes de guardarla -- nunca se guarda en texto plano.
 */
async function crearUsuario(req, res) {
  const { nombre, email, telefono, password, rol, zona_id } = req.body;

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "nombre, email, password y rol son requeridos" });
  }
  if (!["admin", "supervisor", "vendedor"].includes(rol)) {
    return res.status(400).json({ error: "rol invalido" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }

  try {
    const [existente] = await pool.query(`SELECT id FROM usuarios WHERE email = ?`, [email]);
    if (existente.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese email" });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, email, telefono, password_hash, rol, zona_id, activo)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [nombre, email, telefono || null, hash, rol, zona_id || null]
    );

    res.status(201).json({ id: result.insertId, nombre, email, rol, zona_id: zona_id || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el usuario" });
  }
}

/**
 * Actualiza datos de un usuario existente (no la password -- eso tiene su
 * propio endpoint para mantener el cambio de clave explicito y auditable).
 */
async function actualizarUsuario(req, res) {
  const { id } = req.params;
  const { nombre, telefono, rol, zona_id, activo } = req.body;

  try {
    const [existente] = await pool.query(`SELECT id FROM usuarios WHERE id = ?`, [id]);
    if (existente.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    if (rol && !["admin", "supervisor", "vendedor"].includes(rol)) {
      return res.status(400).json({ error: "rol invalido" });
    }

    await pool.query(
      `UPDATE usuarios SET
         nombre   = COALESCE(?, nombre),
         telefono = COALESCE(?, telefono),
         rol      = COALESCE(?, rol),
         zona_id  = ?,
         activo   = COALESCE(?, activo)
       WHERE id = ?`,
      [nombre ?? null, telefono ?? null, rol ?? null, zona_id ?? null, activo ?? null, id]
    );

    res.json({ mensaje: "Usuario actualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el usuario" });
  }
}

/**
 * Cambia la contraseña de un usuario (el admin puede resetear la de
 * cualquiera, por ejemplo si un vendedor la olvido).
 */
async function cambiarPassword(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(`UPDATE usuarios SET password_hash = ? WHERE id = ?`, [hash, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({ mensaje: "Contraseña actualizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
}

/**
 * Activa o desactiva un usuario sin tocar el resto de sus datos.
 * Endpoint separado del PUT general para que el switch de la tabla
 * pueda actualizar solo este campo sin arriesgar pisar otros (ej. zona_id).
 */
async function cambiarEstado(req, res) {
  const { id } = req.params;
  const { activo } = req.body;

  if (activo !== 0 && activo !== 1) {
    return res.status(400).json({ error: "activo debe ser 0 o 1" });
  }

  try {
    const [result] = await pool.query(`UPDATE usuarios SET activo = ? WHERE id = ?`, [activo, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ mensaje: activo ? "Usuario activado" : "Usuario desactivado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado del usuario" });
  }
}

/**
 * Elimina un usuario permanentemente. Si tiene datos asociados (leads,
 * visitas, jornadas, etc.) la base de datos rechaza el borrado por las
 * llaves foraneas -- en ese caso se sugiere desactivar en vez de eliminar,
 * para no perder el historial de lo que ya trabajo ese vendedor.
 */
async function eliminarUsuario(req, res) {
  const { id } = req.params;

  try {
    const [result] = await pool.query(`DELETE FROM usuarios WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ mensaje: "Usuario eliminado" });
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        error: "No se puede eliminar: este usuario tiene datos asociados (leads, visitas, jornadas). Desactivalo en su lugar para conservar el historial.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el usuario" });
  }
}

module.exports = {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  cambiarPassword,
  cambiarEstado,
  eliminarUsuario,
};

const pool = require("../config/db");
const { cerrarEventosPendientes } = require("../utils/cierreAutomatico");

/**
 * Marca el ingreso del vendedor.
 */
async function marcarIngreso(req, res) {
  const { lat, lng } = req.body;
  const vendedorId = req.usuario.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Red de seguridad: si por lo que sea (servidor dormido en Render a
    // medianoche) el cron de tasks/autoCloseTask.js no alcanzó a cerrar
    // una jornada/pausa de un día anterior de ESTE vendedor, se cierra
    // aquí mismo antes de abrir la de hoy -- ver utils/cierreAutomatico.js.
    await cerrarEventosPendientes(conn, { vendedorId });

    const [existente] = await conn.query(
      `SELECT id FROM jornadas WHERE vendedor_id = ? AND fecha = DATE(NOW())`,
      [vendedorId]
    );
    if (existente.length > 0) {
      await conn.rollback();
      return res.status(400).json({ mensaje: "Ya marcaste ingreso hoy" });
    }

    const [result] = await conn.query(
      `INSERT INTO jornadas (vendedor_id, fecha, hora_ingreso) VALUES (?, DATE(NOW()), NOW())`,
      [vendedorId]
    );
    const jornadaId = result.insertId;

    await conn.query(
      `INSERT INTO checkpoints_ubicacion (vendedor_id, jornada_id, tipo_evento, lat, lng)
       VALUES (?, ?, 'ingreso', ?, ?)`,
      [vendedorId, jornadaId, lat, lng]
    );

    await conn.commit();
    res.status(201).json({ success: true, mensaje: "Ingreso registrado", jornada_id: jornadaId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ mensaje: "Error al marcar ingreso" });
  } finally {
    conn.release();
  }
}

async function iniciarPausa(req, res) {
  const { pausa_id, lat, lng } = req.body;
  const vendedorId = req.usuario.id;

  try {
    const [[jornada]] = await pool.query(
      `SELECT id FROM jornadas WHERE vendedor_id = ? AND fecha = DATE(NOW()) AND hora_salida IS NULL`,
      [vendedorId]
    );
    if (!jornada) return res.status(400).json({ mensaje: "No tienes una jornada activa" });

    const [[pausaActiva]] = await pool.query(
      `SELECT id FROM registros_pausas WHERE jornada_id = ? AND hora_fin IS NULL`,
      [jornada.id]
    );
    if (pausaActiva) return res.status(400).json({ mensaje: "Ya tienes una pausa activa" });

    const [result] = await pool.query(
      `INSERT INTO registros_pausas (jornada_id, pausa_id, hora_inicio) VALUES (?, ?, NOW())`,
      [jornada.id, pausa_id]
    );

    if (lat && lng) {
      await pool.query(
        `INSERT INTO checkpoints_ubicacion (vendedor_id, jornada_id, tipo_evento, lat, lng)
         VALUES (?, ?, 'break_inicio', ?, ?)`,
        [vendedorId, jornada.id, lat, lng]
      );
    }

    res.status(201).json({ success: true, mensaje: "Pausa iniciada", registro_pausa_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: "Error al iniciar la pausa" });
  }
}

async function finalizarPausa(req, res) {
  const { lat, lng } = req.body;
  const vendedorId = req.usuario.id;

  try {
    const [[jornada]] = await pool.query(
      `SELECT id FROM jornadas WHERE vendedor_id = ? AND fecha = DATE(NOW())`,
      [vendedorId]
    );
    if (!jornada) return res.status(400).json({ mensaje: "No tienes una jornada activa" });

    const [result] = await pool.query(
      `UPDATE registros_pausas SET hora_fin = NOW()
       WHERE jornada_id = ? AND hora_fin IS NULL`,
      [jornada.id]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ mensaje: "No tienes ninguna pausa activa" });
    }

    if (lat && lng) {
      await pool.query(
        `INSERT INTO checkpoints_ubicacion (vendedor_id, jornada_id, tipo_evento, lat, lng)
         VALUES (?, ?, 'break_fin', ?, ?)`,
        [vendedorId, jornada.id, lat, lng]
      );
    }

    res.json({ success: true, mensaje: "Pausa finalizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: "Error al finalizar la pausa" });
  }
}

async function marcarSalida(req, res) {
  const { lat, lng } = req.body;
  const vendedorId = req.usuario.id;

  try {
    const [[jornada]] = await pool.query(
      `SELECT id, hora_ingreso FROM jornadas WHERE vendedor_id = ? AND fecha = DATE(NOW()) AND hora_salida IS NULL`,
      [vendedorId]
    );
    if (!jornada) return res.status(400).json({ mensaje: "No tienes una jornada activa" });

    const [[pausaActiva]] = await pool.query(
      `SELECT id FROM registros_pausas WHERE jornada_id = ? AND hora_fin IS NULL`,
      [jornada.id]
    );
    if (pausaActiva) {
      return res.status(400).json({ mensaje: "Debes finalizar tu pausa activa antes de marcar salida" });
    }

    const [[segundosPausas]] = await pool.query(
      `SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, hora_inicio, hora_fin)), 0) AS total
       FROM registros_pausas WHERE jornada_id = ?`,
      [jornada.id]
    );

    await pool.query(
      `UPDATE jornadas SET hora_salida = NOW(),
       tiempo_activo_total = ROUND((TIMESTAMPDIFF(SECOND, hora_ingreso, NOW()) - ?) / 60)
       WHERE id = ?`,
      [segundosPausas.total, jornada.id]
    );

    if (lat && lng) {
      await pool.query(
        `INSERT INTO checkpoints_ubicacion (vendedor_id, jornada_id, tipo_evento, lat, lng)
         VALUES (?, ?, 'salida', ?, ?)`,
        [vendedorId, jornada.id, lat, lng]
      );
    }

    res.json({ success: true, mensaje: "Salida registrada con éxito" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: "Error al marcar salida" });
  }
}

/**
 * Lista jornadas para el panel admin, con filtros opcionales de
 * vendedor y rango de fechas -- pantalla de "Corregir jornadas".
 */
async function listarJornadasAdmin(req, res) {
  const { vendedor_id, desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];

  if (vendedor_id) {
    condiciones.push("j.vendedor_id = ?");
    valores.push(vendedor_id);
  }
  if (desde) {
    condiciones.push("j.fecha >= ?");
    valores.push(desde);
  }
  if (hasta) {
    condiciones.push("j.fecha <= ?");
    valores.push(hasta);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const [jornadas] = await pool.query(
      `SELECT j.id, j.vendedor_id, u.nombre AS vendedor, j.fecha, j.hora_ingreso, j.hora_salida,
              j.tiempo_activo_total, j.editado_en, ea.nombre AS editado_por,
              (SELECT COUNT(*) FROM registros_pausas rp WHERE rp.jornada_id = j.id) AS total_pausas
       FROM jornadas j
       JOIN usuarios u ON u.id = j.vendedor_id
       LEFT JOIN usuarios ea ON ea.id = j.editado_por_admin_id
       ${where}
       ORDER BY j.fecha DESC, u.nombre
       LIMIT 200`,
      valores
    );
    res.json(jornadas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar jornadas" });
  }
}

/**
 * Corrige una jornada manualmente (admin). Pensado para el caso típico:
 * un vendedor marcó salida por error (antes de tiempo, o directamente
 * sin querer). Soporta dos usos con el mismo endpoint:
 *
 *   1. Corregir horas: { hora_ingreso, hora_salida } con los valores
 *      correctos -- recalcula tiempo_activo_total restando las pausas
 *      registradas en esa jornada.
 *   2. "Reabrir" la jornada: { hora_salida: null } -- la deja como si
 *      el vendedor nunca hubiera marcado salida, para que el flujo
 *      normal de la app siga funcionando (puede seguir marcando pausas
 *      y, cuando de verdad termine, marcar salida él mismo).
 *
 * Todo cambio queda registrado en editado_por_admin_id / editado_en.
 */
async function editarJornadaAdmin(req, res) {
  const { id } = req.params;
  const { hora_ingreso, hora_salida } = req.body;
  const adminId = req.usuario.id;

  try {
    const [[jornada]] = await pool.query(`SELECT id, fecha FROM jornadas WHERE id = ?`, [id]);
    if (!jornada) return res.status(404).json({ error: "Jornada no encontrada" });

    const nuevoIngreso = hora_ingreso || null;
    // hora_salida puede venir como string (corregir) o null explicito (reabrir).
    // Si la clave ni siquiera viene en el body, no se toca.
    const tocaSalida = Object.prototype.hasOwnProperty.call(req.body, "hora_salida");

    const sets = ["editado_por_admin_id = ?", "editado_en = NOW()"];
    const valores = [adminId];

    if (hora_ingreso) {
      sets.push("hora_ingreso = ?");
      valores.push(hora_ingreso);
    }

    if (tocaSalida) {
      if (hora_salida === null) {
        sets.push("hora_salida = NULL", "tiempo_activo_total = NULL");
      } else {
        // Recalcula el tiempo activo con la hora de ingreso nueva (si se
        // mandó) o la que ya tenía, restando las pausas de esa jornada.
        const [[segundosPausas]] = await pool.query(
          `SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, hora_inicio, hora_fin)), 0) AS total
           FROM registros_pausas WHERE jornada_id = ? AND hora_fin IS NOT NULL`,
          [id]
        );
        sets.push("hora_salida = ?");
        valores.push(hora_salida);
        sets.push(
          `tiempo_activo_total = ROUND((TIMESTAMPDIFF(SECOND, ${nuevoIngreso ? "?" : "hora_ingreso"}, ?) - ?) / 60)`
        );
        if (nuevoIngreso) valores.push(nuevoIngreso);
        valores.push(hora_salida, segundosPausas.total);
      }
    }

    valores.push(id);
    await pool.query(`UPDATE jornadas SET ${sets.join(", ")} WHERE id = ?`, valores);

    res.json({ success: true, mensaje: "Jornada actualizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al corregir la jornada" });
  }
}

/**
 * Obtiene el estado actual de la jornada del vendedor (Ingresado, Pausa, etc.)
 */
async function getEstadoJornada(req, res) {
  const vendedorId = req.usuario.id;

  try {
    const [[jornada]] = await pool.query(
      `SELECT id, hora_ingreso, hora_salida,
              UNIX_TIMESTAMP(hora_ingreso) * 1000 AS start_time_ms
       FROM jornadas WHERE vendedor_id = ? AND fecha = DATE(NOW())`,
      [vendedorId]
    );

    if (!jornada) {
      return res.json({ estado: "Desconectado" });
    }
    if (jornada.hora_salida) {
      return res.json({ estado: "Desconectado" });
    }

    const [[pausa]] = await pool.query(
      `SELECT rp.id, cp.nombre AS motivo
       FROM registros_pausas rp
       JOIN catalogo_pausas cp ON cp.id = rp.pausa_id
       WHERE rp.jornada_id = ? AND rp.hora_fin IS NULL`,
      [jornada.id]
    );

    if (pausa) {
      return res.json({
        estado: `Pausa (${pausa.motivo})`,
        start_time: jornada.start_time_ms
      });
    }

    res.json({
      estado: "Trabajando",
      start_time: jornada.start_time_ms
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado de jornada" });
  }
}

/**
 * Obtiene el historial completo de actividades del vendedor: jornadas, pausas y visitas por dia.
 * Limitado a los últimos 3 meses (mes vigente + 2 anteriores).
 */
async function getMisActividades(req, res) {
  const vendedorId = req.usuario.id;

  try {
    // 1. Obtener jornadas formateando fecha en SQL.
    // Filtro: Desde el primer dia de hace 2 meses (Ej: si hoy es Agosto, trae desde Junio 1)
    const [jornadas] = await pool.query(
      `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') as fecha_iso,
              hora_ingreso, hora_salida, tiempo_activo_total
       FROM jornadas
       WHERE vendedor_id = ?
         AND fecha >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-01')
       ORDER BY fecha DESC`,
      [vendedorId]
    );

    if (jornadas.length === 0) return res.json([]);

    const jornadaIds = jornadas.map(j => j.id);

    // 2. Obtener pausas de esas jornadas
    const [pausas] = await pool.query(
      `SELECT rp.jornada_id, cp.nombre as motivo, rp.hora_inicio, rp.hora_fin
       FROM registros_pausas rp
       JOIN catalogo_pausas cp ON cp.id = rp.pausa_id
       WHERE rp.jornada_id IN (?)`,
      [jornadaIds]
    );

    // 3. Obtener visitas filtrando por el mismo rango de 3 meses
    const [visitas] = await pool.query(
      `SELECT v.id, DATE_FORMAT(v.fecha, '%Y-%m-%d') as fecha_visita,
              v.fecha as hora_completa, v.resultado, lb.nombre as cliente, ve.monto
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE v.vendedor_id = ?
         AND v.fecha >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-01')
       ORDER BY v.fecha DESC`,
      [vendedorId]
    );

    // 4. Agrupar todo por jornada
    const resultado = jornadas.map(j => {
      const fechaStr = j.fecha_iso;
      const pausasDia = pausas.filter(p => String(p.jornada_id) === String(j.id));
      const visitasDia = visitas.filter(v => v.fecha_visita === fechaStr);

      return {
        id: j.id,
        fecha: fechaStr,
        ingreso: j.hora_ingreso,
        salida: j.hora_salida,
        tiempo_total_min: j.tiempo_activo_total || 0,
        pausas: pausasDia,
        visitas: visitasDia,
        kpis: {
          total_visitas: visitasDia.length,
          ventas: visitasDia.filter(v => v.resultado === 'venta_cerrada').length,
          monto_total: visitasDia.reduce((sum, v) => sum + (Number(v.monto) || 0), 0)
        }
      };
    });

    res.json(resultado);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial de actividades" });
  }
}

module.exports = {
  marcarIngreso,
  iniciarPausa,
  finalizarPausa,
  marcarSalida,
  getEstadoJornada,
  getMisActividades,
  listarJornadasAdmin,
  editarJornadaAdmin,
};

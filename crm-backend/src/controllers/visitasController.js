const pool = require("../config/db");
const { distanciaMetros } = require("../utils/geo");
const socket = require("../socket");
require("dotenv").config();

const RADIO_PERMITIDO = Number(process.env.CHECKIN_RADIO_METROS) || 150;

/**
 * Normaliza el resultado de la visita para que coincida con el ENUM de la base de datos.
 */
function normalizarResultado(resultado) {
  if (!resultado) return "contactado";
  const res = resultado.toLowerCase().trim();
  if (res.includes("venta")) return "venta_cerrada";
  if (res.includes("no interesado")) return "no_interesado";
  if (res.includes("ausente") || res.includes("no ubicado")) return "no_ubicado";
  return "reagendar"; // Valor por defecto para Interesado, Volver despues, etc.
}

/**
 * Registra una visita. Valida que el vendedor este dentro del radio permitido
 * respecto a la coordenada del cliente (geofencing) antes de aceptar el registro.
 * Si el resultado es 'venta_cerrada', tambien crea el registro en `ventas`.
 */
async function registrarVisita(req, res) {
  const { lead_id, lat, lng, resultado, notas, producto, monto, proxima_cita } = req.body;
  const vendedorId = req.usuario.id;

  if (!lead_id || !lat || !lng || !resultado) {
    return res.status(400).json({ error: "lead_id, lat, lng y resultado son requeridos" });
  }

  const conn = await pool.getConnection();
  try {
    const [[lead]] = await conn.query(
      `SELECT l.id, lb.lat AS cliente_lat, lb.lng AS cliente_lng
       FROM leads l JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE l.id = ? AND l.vendedor_id = ?`,
      [lead_id, vendedorId]
    );
    if (!lead) return res.status(404).json({ error: "Lead no encontrado o no te pertenece" });

    const distancia = distanciaMetros(lat, lng, lead.cliente_lat, lead.cliente_lng);
    if (distancia > RADIO_PERMITIDO) {
      return res.status(400).json({
        error: "Estas fuera del rango permitido para registrar esta visita",
        distancia_metros: Math.round(distancia),
        radio_permitido_metros: RADIO_PERMITIDO,
      });
    }

    await conn.beginTransaction();

    const resultadoDB = normalizarResultado(resultado);

    // Obtener URLs de imagen: Cloudinary devuelve .path (URL), Local devuelve .filename
    const getFileUrl = (files, field) => {
      if (!files || !files[field]) return null;
      const file = files[field][0];
      // Si el motor es Cloudinary, 'path' es la URL completa
      if (file.path && file.path.startsWith('http')) return file.path;
      // Si es Local, usamos el filename prefijado
      return `/uploads/${file.filename}`;
    };

    const fotoUrl = getFileUrl(req.files, 'foto');
    const firmaUrl = getFileUrl(req.files, 'firma');

    const [visitaResult] = await conn.query(
      `INSERT INTO visitas (lead_id, vendedor_id, resultado, lat_checkin, lng_checkin, distancia_al_cliente_m, notas, foto_url, firma_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id, vendedorId, resultadoDB, lat, lng, Math.round(distancia), notas || null, fotoUrl, firmaUrl]
    );

    // Si hay proxima_cita, actualizarla en el lead
    if (proxima_cita) {
      await conn.query(`UPDATE leads SET proxima_cita = ? WHERE id = ?`, [proxima_cita, lead_id]);
    }

    if (resultadoDB === "venta_cerrada") {
      if (!producto || !monto) {
        await conn.rollback();
        return res.status(400).json({ error: "producto y monto son requeridos para una venta cerrada" });
      }
      await conn.query(
        `INSERT INTO ventas (visita_id, producto, monto) VALUES (?, ?, ?)`,
        [visitaResult.insertId, producto, monto]
      );
      await conn.query(`UPDATE leads SET estado = 'vendido' WHERE id = ?`, [lead_id]);
    } else if (resultado === "no_interesado") {
      await conn.query(`UPDATE leads SET estado = 'descartado' WHERE id = ?`, [lead_id]);
    } else {
      await conn.query(`UPDATE leads SET estado = 'contactado' WHERE id = ?`, [lead_id]);
    }

    await conn.query(
      `INSERT INTO checkpoints_ubicacion (vendedor_id, tipo_evento, lat, lng, referencia_id)
       VALUES (?, 'visita', ?, ?, ?)`,
      [vendedorId, lat, lng, lead_id]
    );

    await conn.commit();

    // Enviar notificacion real-time si es venta
    if (resultadoDB === "venta_cerrada") {
      try {
        const io = socket.getIo();
        const msg = `${req.usuario.nombre} acaba de cerrar una venta de ${producto} por $${monto}.`;

        // 1. Guardar en DB
        await pool.query(
          "INSERT INTO notificaciones (tipo, mensaje, referencia_id) VALUES (?, ?, ?)",
          ["venta", msg, visitaResult.insertId]
        );

        // 2. Emitir a todos los admin/supervisores conectados
        io.emit("alerta_vendedor", {
          tipo: "venta",
          titulo: "¡Nueva Venta!",
          mensaje: msg,
          vendedor: req.usuario.nombre,
          monto: monto,
          fecha: new Date()
        });
      } catch (e) {
        console.error("Error al emitir notificacion socket:", e.message);
      }
    }

    res.status(201).json({
      success: true,
      mensaje: "Visita registrada con éxito",
      visita_id: visitaResult.insertId,
      distancia_metros: Math.round(distancia)
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al registrar la visita" });
  } finally {
    conn.release();
  }
}

/**
 * Historial de visitas para el administrador, con filtros opcionales y
 * paginacion. Incluye datos del cliente, del vendedor, la zona, y el
 * detalle de la venta si el resultado fue 'venta_cerrada'.
 *
 * Query params opcionales: vendedor_id, zona_id, resultado,
 * fecha_desde (YYYY-MM-DD), fecha_hasta (YYYY-MM-DD), page (default 1), limit (default 25)
 */
async function listarVisitasAdmin(req, res) {
  const { vendedor_id, zona_id, resultado, fecha_desde, fecha_hasta } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 25);
  const offset = (page - 1) * limit;

  const condiciones = [];
  const valores = [];

  if (vendedor_id) {
    condiciones.push("v.vendedor_id = ?");
    valores.push(vendedor_id);
  }
  if (zona_id) {
    condiciones.push("l.zona_id = ?");
    valores.push(zona_id);
  }
  if (resultado) {
    condiciones.push("v.resultado = ?");
    valores.push(resultado);
  }
  if (fecha_desde) {
    condiciones.push("DATE(v.fecha) >= ?");
    valores.push(fecha_desde);
  }
  if (fecha_hasta) {
    condiciones.push("DATE(v.fecha) <= ?");
    valores.push(fecha_hasta);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       ${where}`,
      valores
    );

    const [rows] = await pool.query(
      `SELECT v.id, v.lead_id, v.fecha, v.resultado, v.notas, v.distancia_al_cliente_m,
              lb.nombre AS cliente, lb.direccion,
              u.nombre AS vendedor, u.id AS vendedor_id,
              z.nombre AS zona,
              ve.producto, ve.monto,
              v.editado_en, ea.nombre AS editado_por
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN usuarios u ON u.id = v.vendedor_id
       LEFT JOIN zonas z ON z.id = l.zona_id
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       LEFT JOIN usuarios ea ON ea.id = v.editado_por_admin_id
       ${where}
       ORDER BY v.fecha DESC
       LIMIT ? OFFSET ?`,
      [...valores, limit, offset]
    );

    res.json({ total, page, limit, resultados: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar el historial de visitas" });
  }
}

/**
 * Obtiene el historial de visitas de un lead especifico.
 */
async function getVisitsByLead(req, res) {
  const { lead_id } = req.query;
  if (!lead_id) return res.status(400).json({ mensaje: "lead_id es requerido" });

  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.fecha, v.resultado, v.notas, v.foto_url, v.firma_url, ve.producto, ve.monto, u.nombre as vendedor_nombre
       FROM visitas v
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.lead_id = ?
       ORDER BY v.fecha DESC`,
      [lead_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: "Error al obtener historial de visitas" });
  }
}

/**
 * Recalcula el estado de un lead a partir de su visita más reciente.
 * Se usa después de que el admin corrige o reasigna una visita, para que
 * `leads.estado` (y por lo tanto los KPIs y el listado del vendedor)
 * siempre reflejen la última visita real, sin quedar desincronizados.
 */
async function recalcularEstadoLead(conn, leadId) {
  const [[ultimaVisita]] = await conn.query(
    `SELECT resultado FROM visitas WHERE lead_id = ? ORDER BY fecha DESC LIMIT 1`,
    [leadId]
  );

  let nuevoEstado;
  if (!ultimaVisita) {
    // Ya no le queda ninguna visita a este lead (por ejemplo, se le "quitó"
    // su única visita al reasignarla a otro cliente): vuelve a quedar
    // como asignado, disponible para que el vendedor lo visite de nuevo.
    nuevoEstado = "asignado";
  } else if (ultimaVisita.resultado === "venta_cerrada") {
    nuevoEstado = "vendido";
  } else if (ultimaVisita.resultado === "no_interesado") {
    nuevoEstado = "descartado";
  } else {
    nuevoEstado = "contactado";
  }

  await conn.query(`UPDATE leads SET estado = ? WHERE id = ?`, [nuevoEstado, leadId]);
}

/**
 * Corrige una visita ya registrada (admin). Cubre los errores típicos que
 * comete un vendedor en campo:
 *   - Resultado equivocado (ej. marcó "no interesado" y en realidad fue venta).
 *   - Producto/monto de la venta mal digitado.
 *   - Notas incompletas o con errores.
 *   - Visita registrada sobre el cliente/lead equivocado (reasignación).
 *
 * Si el resultado cambia hacia o desde 'venta_cerrada', ajusta la tabla
 * `ventas` (crea, actualiza o elimina el registro según corresponda) y
 * recalcula el estado del/los lead(s) afectados. Todo dentro de una
 * transacción para no dejar el estado de venta/lead inconsistente.
 */
async function editarVisitaAdmin(req, res) {
  const { id } = req.params;
  const { lead_id, resultado, producto, monto, notas } = req.body;
  const adminId = req.usuario.id;

  if (!resultado) return res.status(400).json({ error: "resultado es requerido" });

  const resultadoDB = normalizarResultado(resultado);
  if (resultadoDB === "venta_cerrada" && (!producto || !monto)) {
    return res.status(400).json({ error: "producto y monto son requeridos cuando el resultado es venta cerrada" });
  }

  const conn = await pool.getConnection();
  try {
    const [[visita]] = await conn.query(`SELECT id, lead_id, vendedor_id FROM visitas WHERE id = ?`, [id]);
    if (!visita) {
      conn.release();
      return res.status(404).json({ error: "Visita no encontrada" });
    }

    let leadIdFinal = visita.lead_id;
    const seReasigna = lead_id && String(lead_id) !== String(visita.lead_id);

    if (seReasigna) {
      // El nuevo lead debe pertenecer al MISMO vendedor que hizo la visita:
      // reasignar es para corregir "tocó el cliente equivocado en la app",
      // no para mover la visita a la cartera de otro vendedor.
      const [[nuevoLead]] = await conn.query(
        `SELECT id FROM leads WHERE id = ? AND vendedor_id = ?`,
        [lead_id, visita.vendedor_id]
      );
      if (!nuevoLead) {
        conn.release();
        return res.status(404).json({ error: "El cliente indicado no existe en la cartera de este vendedor" });
      }
      leadIdFinal = lead_id;
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE visitas SET
         lead_id = ?, resultado = ?, notas = ?,
         editado_por_admin_id = ?, editado_en = NOW()
       WHERE id = ?`,
      [leadIdFinal, resultadoDB, notas ?? null, adminId, id]
    );

    const [[ventaExistente]] = await conn.query(`SELECT id FROM ventas WHERE visita_id = ?`, [id]);

    if (resultadoDB === "venta_cerrada") {
      if (ventaExistente) {
        await conn.query(`UPDATE ventas SET producto = ?, monto = ? WHERE visita_id = ?`, [producto, monto, id]);
      } else {
        await conn.query(`INSERT INTO ventas (visita_id, producto, monto) VALUES (?, ?, ?)`, [id, producto, monto]);
      }
    } else if (ventaExistente) {
      // El resultado dejó de ser venta cerrada: ya no debe quedar un
      // registro de venta huérfano.
      await conn.query(`DELETE FROM ventas WHERE visita_id = ?`, [id]);
    }

    await recalcularEstadoLead(conn, leadIdFinal);
    if (seReasigna) {
      // El lead original se queda sin esta visita: su estado también
      // puede cambiar (ej. si era su única visita, vuelve a "asignado").
      await recalcularEstadoLead(conn, visita.lead_id);
    }

    await conn.commit();
    res.json({ success: true, mensaje: "Visita corregida" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al corregir la visita" });
  } finally {
    conn.release();
  }
}

/**
 * Elimina por completo una visita duplicada o mal registrada (ej. el
 * vendedor registró la misma visita dos veces por mala señal). Borra
 * también la venta asociada si la había, y recalcula el estado del
 * lead para que quede reflejando la visita real restante (o vuelva a
 * "asignado" si esa era su única visita).
 */
async function eliminarVisitaAdmin(req, res) {
  const { id } = req.params;

  const conn = await pool.getConnection();
  try {
    const [[visita]] = await conn.query(`SELECT id, lead_id FROM visitas WHERE id = ?`, [id]);
    if (!visita) {
      conn.release();
      return res.status(404).json({ error: "Visita no encontrada" });
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM ventas WHERE visita_id = ?`, [id]);
    await conn.query(`DELETE FROM visitas WHERE id = ?`, [id]);
    await recalcularEstadoLead(conn, visita.lead_id);
    await conn.commit();

    res.json({ success: true, mensaje: "Visita eliminada" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la visita" });
  } finally {
    conn.release();
  }
}

module.exports = { registrarVisita, listarVisitasAdmin, getVisitsByLead, editarVisitaAdmin, eliminarVisitaAdmin };

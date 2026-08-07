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
  const { lead_id, lat, lng, resultado, notas, producto, monto } = req.body;
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
    const fotoUrl = req.files && req.files['foto'] ? `/uploads/${req.files['foto'][0].filename}` : null;
    const firmaUrl = req.files && req.files['firma'] ? `/uploads/${req.files['firma'][0].filename}` : null;

    const [visitaResult] = await conn.query(
      `INSERT INTO visitas (lead_id, vendedor_id, resultado, lat_checkin, lng_checkin, distancia_al_cliente_m, notas, foto_url, firma_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id, vendedorId, resultadoDB, lat, lng, Math.round(distancia), notas || null, fotoUrl, firmaUrl]
    );

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
      `SELECT v.id, v.fecha, v.resultado, v.notas, v.distancia_al_cliente_m,
              lb.nombre AS cliente, lb.direccion,
              u.nombre AS vendedor, u.id AS vendedor_id,
              z.nombre AS zona,
              ve.producto, ve.monto
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN usuarios u ON u.id = v.vendedor_id
       LEFT JOIN zonas z ON z.id = l.zona_id
       LEFT JOIN ventas ve ON ve.visita_id = v.id
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

module.exports = { registrarVisita, listarVisitasAdmin, getVisitsByLead };

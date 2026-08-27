const pool = require("../config/db");
const socket = require("../socket");

const TITULO_POR_DEFECTO = "Mensaje del Administrador";

/**
 * Envía un mensaje a un vendedor específico (vendedor_id en el body) o,
 * si no se envía vendedor_id, a todos los vendedores activos.
 * Emite el evento "admin_message" por socket con { titulo, contenido },
 * que es exactamente lo que el buzón de la app espera (ver MainActivity.kt).
 * Además guarda un registro en mensajes_admin como historial/auditoría.
 */
async function enviarMensaje(req, res) {
  const { vendedor_id, titulo, contenido } = req.body;
  const adminId = req.usuario.id;

  if (!contenido || !contenido.trim()) {
    return res.status(400).json({ error: "El contenido del mensaje es requerido" });
  }

  const tituloFinal = titulo && titulo.trim() ? titulo.trim() : TITULO_POR_DEFECTO;
  const contenidoFinal = contenido.trim();

  const conn = await pool.getConnection();
  try {
    let destinatarios = [];

    if (vendedor_id) {
      const [[vendedor]] = await conn.query(
        `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor' AND activo = 1`,
        [vendedor_id]
      );
      if (!vendedor) {
        conn.release();
        return res.status(404).json({ error: "Vendedor no encontrado o inactivo" });
      }
      destinatarios = [vendedor.id];
    } else {
      const [rows] = await conn.query(
        `SELECT id FROM usuarios WHERE rol = 'vendedor' AND activo = 1`
      );
      destinatarios = rows.map((r) => r.id);
    }

    if (destinatarios.length === 0) {
      conn.release();
      return res.status(404).json({ error: "No hay vendedores activos para notificar" });
    }

    await conn.beginTransaction();

    const [mensajeResult] = await conn.query(
      `INSERT INTO mensajes_admin (admin_id, vendedor_id, titulo, contenido)
       VALUES (?, ?, ?, ?)`,
      [adminId, vendedor_id || null, tituloFinal, contenidoFinal]
    );
    const mensajeId = mensajeResult.insertId;

    // Una fila de "entrega pendiente" por cada destinatario -- así, si estaba
    // desconectado cuando se emitió el socket, puede recuperarlo despues via
    // GET /pendientes al reconectar, y confirmarlo con PATCH /pendientes/confirmar.
    const valoresEntregas = destinatarios.map((id) => [mensajeId, id]);
    await conn.query(
      `INSERT INTO mensajes_admin_entregas (mensaje_id, vendedor_id) VALUES ?`,
      [valoresEntregas]
    );

    await conn.commit();

    try {
      const io = socket.getIo();
      destinatarios.forEach((id) => {
        io.to(`user_${id}`).emit("admin_message", {
          titulo: tituloFinal,
          contenido: contenidoFinal,
        });
      });
    } catch (e) {
      console.error("Error al emitir socket de admin_message:", e.message);
    }

    res.json({
      mensaje: "Mensaje enviado correctamente",
      destinatarios: destinatarios.length,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al enviar el mensaje" });
  } finally {
    conn.release();
  }
}

/**
 * Historial de mensajes enviados (más recientes primero), con el nombre
 * del vendedor destinatario (o "Todos" si fue masivo), quién lo envió, y
 * cuántos de los destinatarios ya confirmaron haberlo recibido (total_entregados
 * de total_destinatarios) -- un vendedor que estaba desconectado en el momento
 * del envío cuenta como pendiente hasta que se reconecta y hace el catch-up.
 */
async function listarHistorial(req, res) {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.titulo, m.contenido, m.enviado_en, m.vendedor_id,
              v.nombre AS vendedor_nombre,
              a.nombre AS admin_nombre,
              COUNT(e.id) AS total_destinatarios,
              SUM(CASE WHEN e.entregado = 1 THEN 1 ELSE 0 END) AS total_entregados
       FROM mensajes_admin m
       LEFT JOIN usuarios v ON v.id = m.vendedor_id
       LEFT JOIN usuarios a ON a.id = m.admin_id
       LEFT JOIN mensajes_admin_entregas e ON e.mensaje_id = m.id
       GROUP BY m.id, m.titulo, m.contenido, m.enviado_en, m.vendedor_id, v.nombre, a.nombre
       ORDER BY m.enviado_en DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar el historial de mensajes" });
  }
}

/**
 * Para que la app consulte al conectar/reconectar: mensajes que le
 * corresponden a este vendedor y que aún no confirmó haber recibido.
 * Requiere auth de vendedor (usa el usuario del token, no un id en la URL,
 * para que un vendedor no pueda leer los pendientes de otro).
 */
async function listarPendientes(req, res) {
  const vendedorId = req.usuario.id;
  try {
    const [rows] = await pool.query(
      `SELECT e.id AS entrega_id, m.titulo, m.contenido, m.enviado_en
       FROM mensajes_admin_entregas e
       JOIN mensajes_admin m ON m.id = e.mensaje_id
       WHERE e.vendedor_id = ? AND e.entregado = 0
       ORDER BY m.enviado_en ASC`,
      [vendedorId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar mensajes pendientes" });
  }
}

/**
 * La app llama esto después de guardar cada mensaje pendiente en su buzón
 * local, para que no se lo vuelva a devolver la próxima vez que pregunte.
 * Body: { entrega_ids: [1, 2, 3] } -- los "entrega_id" que vinieron en /pendientes.
 */
async function confirmarEntrega(req, res) {
  const vendedorId = req.usuario.id;
  const { entrega_ids } = req.body;

  if (!Array.isArray(entrega_ids) || entrega_ids.length === 0) {
    return res.status(400).json({ error: "entrega_ids debe ser un arreglo con al menos un id" });
  }

  try {
    await pool.query(
      `UPDATE mensajes_admin_entregas
       SET entregado = 1, entregado_en = NOW()
       WHERE vendedor_id = ? AND id IN (?)`,
      [vendedorId, entrega_ids]
    );
    res.json({ mensaje: "Entregas confirmadas" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al confirmar la entrega de mensajes" });
  }
}

module.exports = { enviarMensaje, listarHistorial, listarPendientes, confirmarEntrega };

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

  try {
    let destinatarios = [];

    if (vendedor_id) {
      const [[vendedor]] = await pool.query(
        `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor' AND activo = 1`,
        [vendedor_id]
      );
      if (!vendedor) {
        return res.status(404).json({ error: "Vendedor no encontrado o inactivo" });
      }
      destinatarios = [vendedor.id];
    } else {
      const [rows] = await pool.query(
        `SELECT id FROM usuarios WHERE rol = 'vendedor' AND activo = 1`
      );
      destinatarios = rows.map((r) => r.id);
    }

    if (destinatarios.length === 0) {
      return res.status(404).json({ error: "No hay vendedores activos para notificar" });
    }

    await pool.query(
      `INSERT INTO mensajes_admin (admin_id, vendedor_id, titulo, contenido)
       VALUES (?, ?, ?, ?)`,
      [adminId, vendedor_id || null, tituloFinal, contenidoFinal]
    );

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
    console.error(err);
    res.status(500).json({ error: "Error al enviar el mensaje" });
  }
}

/**
 * Historial de mensajes enviados (más recientes primero), con el nombre
 * del vendedor destinatario (o "Todos" si fue masivo) y del admin que lo envió.
 */
async function listarHistorial(req, res) {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.titulo, m.contenido, m.enviado_en, m.vendedor_id,
              v.nombre AS vendedor_nombre,
              a.nombre AS admin_nombre
       FROM mensajes_admin m
       LEFT JOIN usuarios v ON v.id = m.vendedor_id
       LEFT JOIN usuarios a ON a.id = m.admin_id
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

module.exports = { enviarMensaje, listarHistorial };

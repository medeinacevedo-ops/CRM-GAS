const pool = require("../config/db");
const socket = require("../socket");

/**
 * Registra una alerta SOS de un vendedor y notifica a los administradores vía Socket.
 */
async function enviarAlertaSos(req, res) {
  const { lat, lng } = req.body;
  const vendedorId = req.usuario.id;
  const nombreVendedor = req.usuario.nombre;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Coordenadas GPS requeridas para SOS" });
  }

  try {
    // 1. Guardar en Base de Datos
    const [result] = await pool.query(
      "INSERT INTO alertas_sos (vendedor_id, lat, lng) VALUES (?, ?, ?)",
      [vendedorId, lat, lng]
    );

    // 2. Notificar por Socket a todos (Admins/Supervisores conectados)
    try {
      const io = socket.getIo();
      io.emit("alerta_sos", {
        id: result.insertId,
        vendedor_id: vendedorId,
        vendedor: nombreVendedor,
        lat,
        lng,
        fecha: new Date(),
        mensaje: `⚠️ ¡ALERTA SOS! El vendedor ${nombreVendedor} ha activado el botón de pánico.`
      });
    } catch (e) {
      console.error("Error al emitir socket SOS:", e.message);
    }

    res.status(201).json({
      success: true,
      mensaje: "Alerta SOS enviada. El equipo de seguridad ha sido notificado."
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al procesar la alerta SOS" });
  }
}

/**
 * Lista alertas SOS recientes para el panel administrativo.
 */
async function listarAlertasSos(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, u.nombre AS vendedor, z.nombre AS zona
      FROM alertas_sos s
      JOIN usuarios u ON u.id = s.vendedor_id
      LEFT JOIN zonas z ON z.id = u.zona_id
      ORDER BY s.fecha DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al listar alertas" });
  }
}

module.exports = { enviarAlertaSos, listarAlertasSos };

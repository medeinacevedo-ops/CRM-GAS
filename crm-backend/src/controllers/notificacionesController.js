const pool = require("../config/db");

/**
 * Lista las notificaciones mas recientes (para el desplegable de la campana).
 * Ajustado a la estructura real de la tabla: id, tipo, mensaje, leida, referencia_id, creado_en
 * (sin columnas titulo ni vendedor_id -- esas no existen en la tabla que ya crearon).
 */
async function listarNotificaciones(req, res) {
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  try {
    const [rows] = await pool.query(
      `SELECT id, tipo, mensaje, referencia_id, leida, creado_en
       FROM notificaciones
       ORDER BY creado_en DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar notificaciones" });
  }
}

/**
 * Cuenta cuantas notificaciones no leidas hay -- alimenta el numero rojo
 * de la campana al cargar la pagina (el aviso en vivo llega por Socket.IO,
 * esto es solo para el conteo inicial al iniciar sesion o refrescar).
 */
async function contarNoLeidas(req, res) {
  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM notificaciones WHERE leida = 0`
    );
    res.json({ total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al contar notificaciones" });
  }
}

/**
 * Marca todas las notificaciones como leidas (se llama cuando el admin
 * abre el desplegable de la campana).
 */
async function marcarTodasLeidas(req, res) {
  try {
    await pool.query(`UPDATE notificaciones SET leida = 1 WHERE leida = 0`);
    res.json({ mensaje: "Notificaciones marcadas como leídas" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al marcar notificaciones" });
  }
}

module.exports = { listarNotificaciones, contarNoLeidas, marcarTodasLeidas };

const jwt = require("jsonwebtoken");
const pool = require("../config/db");
require("dotenv").config();

/**
 * Verifica el token JWT enviado en el header Authorization: Bearer <token>
 * y agrega el usuario decodificado a req.usuario.
 * Enforce Single-Device: Verifica que el device_id del token sea el activo en DB.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Verificación de dispositivo activo (Single Device Policy)
    if (payload.device_id) {
        const [rows] = await pool.query("SELECT session_device_id FROM usuarios WHERE id = ?", [payload.id]);
        if (rows.length > 0 && rows[0].session_device_id !== payload.device_id) {
            return res.status(401).json({ error: "Tu sesión ha expirado porque ingresaste en otro dispositivo" });
        }
    }

    req.usuario = payload; // { id, rol, zona_id, nombre, device_id }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalido o expirado" });
  }
}

/**
 * Middleware factory: restringe una ruta a ciertos roles.
 * Uso: router.get("/x", requireAuth, requireRole("admin"), handler)
 */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permisos para esta accion" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

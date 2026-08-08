const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const socket = require("../socket");
require("dotenv").config();

async function login(req, res) {
  const { email, password, device_id, force } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email y password son requeridos" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.zona_id, u.activo, u.session_device_id,
              z.nombre AS zona_nombre, z.distrito
       FROM usuarios u
       LEFT JOIN zonas z ON z.id = u.zona_id
       WHERE u.email = ?`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    const usuario = rows[0];
    if (!usuario.activo) {
      return res.status(403).json({ error: "Usuario inactivo, contacta al administrador" });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    // POLITICA DE DISPOSITIVO UNICO
    // Si tiene una sesion en otro dispositivo y no se envio la bandera 'force'
    if (device_id && usuario.session_device_id && usuario.session_device_id !== device_id && !force) {
      return res.status(409).json({
        error: "session_exists",
        mensaje: "Este usuario ya tiene una sesión activa en otro dispositivo. ¿Deseas cerrar la otra sesión e ingresar aquí?"
      });
    }

    // Si llegamos aqui, el login es exitoso o se forzo el cierre de la anterior
    if (device_id) {
      // Notificar al dispositivo anterior (si existe) para que cierre sesion inmediatamente
      if (usuario.session_device_id && usuario.session_device_id !== device_id) {
          const io = socket.getIo();
          io.to(`user_${usuario.id}`).emit("force_logout", {
              mensaje: "Tu sesión ha sido abierta en otro dispositivo."
          });
      }
      await pool.query("UPDATE usuarios SET session_device_id = ? WHERE id = ?", [device_id, usuario.id]);
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        zona_id: usuario.zona_id,
        device_id: device_id || null // Incluimos el device_id en el token
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        zona_id: usuario.zona_id,
        zona_nombre: usuario.zona_nombre,
        distrito: usuario.distrito
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesion" });
  }
}

module.exports = { login };

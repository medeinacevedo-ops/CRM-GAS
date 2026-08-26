const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  enviarMensaje,
  listarHistorial,
  listarPendientes,
  confirmarEntrega,
} = require("../controllers/mensajesController");

router.get("/", requireAuth, requireRole("admin"), listarHistorial);
router.post("/", requireAuth, requireRole("admin"), enviarMensaje);

// Consumidas por la app del vendedor para el catch-up de mensajes offline.
router.get("/pendientes", requireAuth, requireRole("vendedor"), listarPendientes);
router.patch("/pendientes/confirmar", requireAuth, requireRole("vendedor"), confirmarEntrega);

module.exports = router;

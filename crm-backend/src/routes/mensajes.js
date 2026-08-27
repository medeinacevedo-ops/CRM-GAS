const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  enviarMensaje,
  listarHistorial,
  detalleMensaje,
  listarPendientes,
  confirmarEntrega,
} = require("../controllers/mensajesController");

router.get("/", requireAuth, requireRole("admin"), listarHistorial);
router.post("/", requireAuth, requireRole("admin"), enviarMensaje);

// Consumidas por la app del vendedor para el catch-up de mensajes offline.
router.get("/pendientes", requireAuth, requireRole("vendedor"), listarPendientes);
router.patch("/pendientes/confirmar", requireAuth, requireRole("vendedor"), confirmarEntrega);

// Detalle de a quién le falta un mensaje puntual (va después de "/pendientes"
// para que Express no confunda "pendientes" con un :id).
router.get("/:id/detalle", requireAuth, requireRole("admin"), detalleMensaje);

module.exports = router;

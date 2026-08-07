const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  solicitarIntercambio,
  misIntercambios,
  confirmarIntercambio,
  rechazarIntercambio,
  listarTodosIntercambios,
} = require("../controllers/intercambiosController");

router.post("/", requireAuth, requireRole("vendedor"), solicitarIntercambio);
router.get("/", requireAuth, requireRole("vendedor"), misIntercambios);
router.post("/:id/confirmar", requireAuth, requireRole("vendedor"), confirmarIntercambio);
router.post("/:id/rechazar", requireAuth, requireRole("vendedor"), rechazarIntercambio);

// Visibilidad para el administrador: ve todos los intercambios, no puede accionar sobre ellos.
router.get("/todos", requireAuth, requireRole("admin"), listarTodosIntercambios);

module.exports = router;

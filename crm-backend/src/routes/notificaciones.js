const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarNotificaciones,
  contarNoLeidas,
  marcarTodasLeidas,
} = require("../controllers/notificacionesController");

router.get("/", requireAuth, requireRole("admin"), listarNotificaciones);
router.get("/no-leidas", requireAuth, requireRole("admin"), contarNoLeidas);
router.patch("/marcar-leidas", requireAuth, requireRole("admin"), marcarTodasLeidas);

module.exports = router;

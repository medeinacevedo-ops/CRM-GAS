const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  marcarIngreso,
  iniciarPausa,
  finalizarPausa,
  marcarSalida,
  getEstadoJornada,
  getMisActividades
} = require("../controllers/jornadaController");

router.get("/estado", requireAuth, requireRole("vendedor"), getEstadoJornada);
router.get("/mis-actividades", requireAuth, requireRole("vendedor"), getMisActividades);
router.post("/ingreso", requireAuth, requireRole("vendedor"), marcarIngreso);
router.post("/pausa/iniciar", requireAuth, requireRole("vendedor"), iniciarPausa);
router.post("/pausa/finalizar", requireAuth, requireRole("vendedor"), finalizarPausa);
router.post("/salida", requireAuth, requireRole("vendedor"), marcarSalida);

module.exports = router;

const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  marcarIngreso,
  iniciarPausa,
  finalizarPausa,
  marcarSalida,
  getEstadoJornada,
  getMisActividades,
  listarJornadasAdmin,
  editarJornadaAdmin,
} = require("../controllers/jornadaController");

router.get("/estado", requireAuth, requireRole("vendedor", "admin"), getEstadoJornada);
router.get("/mis-actividades", requireAuth, requireRole("vendedor", "admin"), getMisActividades);
router.post("/ingreso", requireAuth, requireRole("vendedor", "admin"), marcarIngreso);
router.post("/pausa/iniciar", requireAuth, requireRole("vendedor", "admin"), iniciarPausa);
router.post("/pausa/finalizar", requireAuth, requireRole("vendedor", "admin"), finalizarPausa);
router.post("/salida", requireAuth, requireRole("vendedor", "admin"), marcarSalida);

// Corrección manual de jornadas (admin) -- ver jornadaController.editarJornadaAdmin
router.get("/admin", requireAuth, requireRole("admin"), listarJornadasAdmin);
router.patch("/admin/:id", requireAuth, requireRole("admin"), editarJornadaAdmin);

module.exports = router;

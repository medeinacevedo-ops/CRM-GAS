const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarPermisos,
  otorgarPermiso,
  revocarPermiso,
  actualizarPermiso,
  cambiarEstadoPermiso,
} = require("../controllers/permisosSupervisorController");

router.get("/", requireAuth, requireRole("admin"), listarPermisos);
router.post("/", requireAuth, requireRole("admin"), otorgarPermiso);
router.put("/:id", requireAuth, requireRole("admin"), actualizarPermiso);
router.patch("/:id/estado", requireAuth, requireRole("admin"), cambiarEstadoPermiso);
router.delete("/:id", requireAuth, requireRole("admin"), revocarPermiso);

module.exports = router;

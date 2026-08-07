const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarZonas,
  crearZona,
  actualizarZona,
  cambiarEstadoZona,
  eliminarZona,
} = require("../controllers/zonasController");

router.get("/", requireAuth, requireRole("admin"), listarZonas);
router.post("/", requireAuth, requireRole("admin"), crearZona);
router.put("/:id", requireAuth, requireRole("admin"), actualizarZona);
router.patch("/:id/estado", requireAuth, requireRole("admin"), cambiarEstadoZona);
router.delete("/:id", requireAuth, requireRole("admin"), eliminarZona);

module.exports = router;

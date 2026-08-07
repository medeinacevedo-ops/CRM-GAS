const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarDepartamentos,
  listarProvincias,
  listarDistritos,
  buscarPorDistrito,
} = require("../controllers/ubigeoController");

router.get("/departamentos", requireAuth, requireRole("admin"), listarDepartamentos);
router.get("/provincias", requireAuth, requireRole("admin"), listarProvincias);
router.get("/distritos", requireAuth, requireRole("admin"), listarDistritos);
router.get("/buscar-por-distrito", requireAuth, requireRole("admin"), buscarPorDistrito);

module.exports = router;

const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { exportMasterLeads, exportConsolidadoVentas, exportControlTiempos } = require("../controllers/reportsController");

router.get("/leads", requireAuth, requireRole("admin"), exportMasterLeads);
router.get("/ventas", requireAuth, requireRole("admin"), exportConsolidadoVentas);
router.get("/tiempos", requireAuth, requireRole("admin"), exportControlTiempos);

module.exports = router;

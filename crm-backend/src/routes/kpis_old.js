const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { kpisVendedor, dashboardAdmin, serieDiariaMes, dashboardSupervisor, rankingVendedores, kpisBase, resumenIndicadores } = require("../controllers/kpisController");

router.get("/vendedor", requireAuth, requireRole("vendedor", "admin"), kpisVendedor);
router.get("/ranking", requireAuth, requireRole("vendedor", "admin"), rankingVendedores);
router.get("/base", requireAuth, requireRole("admin"), kpisBase);
router.get("/resumen", requireAuth, requireRole("admin"), resumenIndicadores);
router.get("/dashboard", requireAuth, requireRole("admin"), dashboardAdmin);
router.get("/serie-diaria", requireAuth, requireRole("admin"), serieDiariaMes);
router.get("/supervisor", requireAuth, requireRole("supervisor"), dashboardSupervisor);

module.exports = router;

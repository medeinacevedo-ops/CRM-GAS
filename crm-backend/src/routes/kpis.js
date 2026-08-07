const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { kpisVendedor, dashboardAdmin, serieDiariaMes, dashboardSupervisor, rankingVendedores, kpisBase } = require("../controllers/kpisController");

router.get("/vendedor", requireAuth, requireRole("vendedor"), kpisVendedor);
router.get("/ranking", requireAuth, requireRole("vendedor"), rankingVendedores);
router.get("/base", requireAuth, requireRole("admin"), kpisBase);
router.get("/dashboard", requireAuth, requireRole("admin"), dashboardAdmin);
router.get("/serie-diaria", requireAuth, requireRole("admin"), serieDiariaMes);
router.get("/supervisor", requireAuth, requireRole("supervisor"), dashboardSupervisor);

module.exports = router;

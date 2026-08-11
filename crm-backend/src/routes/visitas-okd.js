const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { registrarVisita, listarVisitasAdmin, getVisitsByLead } = require("../controllers/visitasController");
const upload = require("../middleware/upload");

router.post("/", requireAuth, requireRole("vendedor", "admin"), upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'firma', maxCount: 1 }]), registrarVisita);
router.get("/", requireAuth, getVisitsByLead);
router.get("/admin", requireAuth, requireRole("admin"), listarVisitasAdmin);

module.exports = router;

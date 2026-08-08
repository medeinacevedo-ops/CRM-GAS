const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { registrarHeartbeat, obtenerUbicacionesEnVivo } = require("../controllers/ubicacionController");

router.post("/heartbeat", requireAuth, requireRole("vendedor", "admin"), registrarHeartbeat);
router.get("/en-vivo", requireAuth, requireRole("admin", "supervisor"), obtenerUbicacionesEnVivo);

module.exports = router;

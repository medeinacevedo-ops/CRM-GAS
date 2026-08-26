const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { enviarMensaje, listarHistorial } = require("../controllers/mensajesController");

router.get("/", requireAuth, requireRole("admin"), listarHistorial);
router.post("/", requireAuth, requireRole("admin"), enviarMensaje);

module.exports = router;

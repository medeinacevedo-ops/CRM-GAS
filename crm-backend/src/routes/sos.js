const express = require("express");
const router = express.Router();
const controller = require("../controllers/sosController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Los vendedores envían la alerta
router.post("/enviar", requireAuth, controller.enviarAlertaSos);

// Los administradores listan las alertas
router.get("/lista", [requireAuth, requireRole("admin", "supervisor")], controller.listarAlertasSos);

module.exports = router;

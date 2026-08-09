const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  exportarVentas,
  exportarBaseLeads,
  exportarConexion,
  exportarPausas,
  exportarVisitas,
} = require("../controllers/reportesController");

// Todos admin-only: el panel administrativo ya rechaza el login de
// cualquier rol distinto a "admin" (ver app.js), pero se refuerza aquí
// también a nivel de API por si el token se usa directo.
router.get("/ventas", requireAuth, requireRole("admin"), exportarVentas);
router.get("/base-leads", requireAuth, requireRole("admin"), exportarBaseLeads);
router.get("/conexion", requireAuth, requireRole("admin"), exportarConexion);
router.get("/pausas", requireAuth, requireRole("admin"), exportarPausas);
router.get("/visitas", requireAuth, requireRole("admin"), exportarVisitas);

module.exports = router;

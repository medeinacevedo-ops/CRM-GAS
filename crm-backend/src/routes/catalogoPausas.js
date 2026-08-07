const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarCatalogoPausas,
  crearPausa,
  actualizarPausa,
  cambiarEstadoPausa,
  eliminarPausa,
} = require("../controllers/catalogoPausasController");

// Cualquier usuario autenticado puede leer el catalogo (el vendedor lo necesita
// para elegir el motivo al marcar una pausa en la app).
router.get("/", requireAuth, listarCatalogoPausas);

// Solo el administrador puede modificar el catalogo.
router.post("/", requireAuth, requireRole("admin"), crearPausa);
router.put("/:id", requireAuth, requireRole("admin"), actualizarPausa);
router.patch("/:id/estado", requireAuth, requireRole("admin"), cambiarEstadoPausa);
router.delete("/:id", requireAuth, requireRole("admin"), eliminarPausa);

module.exports = router;

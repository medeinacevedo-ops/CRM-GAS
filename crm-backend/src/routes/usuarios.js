const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  cambiarPassword,
  cambiarEstado,
  eliminarUsuario,
} = require("../controllers/usuariosController");

router.get("/", requireAuth, requireRole("admin"), listarUsuarios);
router.get("/vendedores", requireAuth, requireRole("vendedor"), listarUsuarios);
router.post("/", requireAuth, requireRole("admin"), crearUsuario);
router.put("/:id", requireAuth, requireRole("admin"), actualizarUsuario);
router.put("/:id/password", requireAuth, requireRole("admin"), cambiarPassword);
router.patch("/:id/estado", requireAuth, requireRole("admin"), cambiarEstado);
router.delete("/:id", requireAuth, requireRole("admin"), eliminarUsuario);

module.exports = router;

const express = require("express");
const router = express.Router();
const controller = require("../controllers/catalogoController");
const { requireAuth, requireRole } = require("../middleware/auth");
const upload = require("../middleware/upload");

// Rutas para Vendedores (Lectura)
router.get("/productos", requireAuth, controller.listarProductos);
router.get("/categorias", requireAuth, controller.listarCategorias);
router.get("/productos/:id", requireAuth, controller.detalleProducto);

// Rutas para Admin (Gestión)
router.post("/importar", [requireAuth, requireRole("admin"), upload.single("archivo")], controller.importarProductos);

module.exports = router;

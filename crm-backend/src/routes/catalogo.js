const express = require("express");
const router = express.Router();
const controller = require("../controllers/catalogoController");
const auth = require("../middlewares/auth");
const upload = require("../middlewares/upload");

// Rutas para Vendedores (Lectura)
router.get("/productos", auth.verificarToken, controller.listarProductos);
router.get("/categorias", auth.verificarToken, controller.listarCategorias);
router.get("/productos/:id", auth.verificarToken, controller.detalleProducto);

// Rutas para Admin (Gestión)
router.post("/importar", [auth.verificarToken, auth.esAdmin, upload.single("archivo")], controller.importarProductos);

module.exports = router;

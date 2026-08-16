const express = require("express");
const router = express.Router();
const multer = require("multer");
const controller = require("../controllers/catalogoController");
const { requireAuth, requireRole } = require("../middleware/auth");
const upload = require("../middleware/upload");

// Multer dedicado a disco local para el CSV de importación -- el
// middleware `upload` compartido usa Cloudinary cuando está configurado,
// que solo acepta jpg/png/jpeg y rompería la subida de un .csv.
const uploadCsv = multer({ dest: "uploads/" });

// Rutas para Vendedores (Lectura)
router.get("/productos", requireAuth, controller.listarProductos);
router.get("/categorias", requireAuth, controller.listarCategorias);
router.get("/productos/:id", requireAuth, controller.detalleProducto);

// Rutas para Admin (Gestión)
router.post("/importar", [requireAuth, requireRole("admin"), uploadCsv.single("archivo")], controller.importarProductos);
router.get("/cargas", requireAuth, requireRole("admin"), controller.historialCargasProductos);

router.post("/productos", requireAuth, requireRole("admin"), controller.crearProducto);
router.put("/productos/:id", requireAuth, requireRole("admin"), controller.actualizarProducto);
router.patch("/productos/:id/estado", requireAuth, requireRole("admin"), controller.cambiarEstadoProducto);
router.delete("/productos/:id", requireAuth, requireRole("admin"), controller.eliminarProducto);

router.post(
  "/productos/:id/imagenes",
  [requireAuth, requireRole("admin"), upload.single("imagen")],
  controller.subirImagenProducto
);
router.delete("/productos/:id/imagenes/:imagenId", requireAuth, requireRole("admin"), controller.eliminarImagenProducto);
router.patch(
  "/productos/:id/imagenes/:imagenId/principal",
  requireAuth,
  requireRole("admin"),
  controller.marcarImagenPrincipal
);

module.exports = router;

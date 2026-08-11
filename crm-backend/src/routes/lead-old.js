const express = require("express");
const multer = require("multer");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  cargarBase,
  listarCargas,
  generarLeadsOperativos,
  repartirAutomatico,
  misLeads,
  resumenCarga,
  zonasConDisponiblesDeCarga,
  vendedoresDeZonaParaAsignar,
  asignarIndividual,
  resumenZonasCarga,
  crearLeadProspecto,
  actualizarLead,
  leadsDeVendedor,
} = require("../controllers/leadsController");

const upload = multer({ dest: "uploads/" });

// Solo administrador puede cargar y repartir la base
router.post("/cargar-base", requireAuth, requireRole("admin"), upload.single("archivo"), cargarBase);
router.get("/cargas", requireAuth, requireRole("admin"), listarCargas);
router.post("/generar-operativos", requireAuth, requireRole("admin"), generarLeadsOperativos);
router.post("/repartir-automatico", requireAuth, requireRole("admin"), repartirAutomatico);

// Gestion operativa: seleccionar base -> ver resumen -> elegir zona -> asignar por vendedor
router.get("/cargas/:id/resumen", requireAuth, requireRole("admin"), resumenCarga);
router.get("/cargas/:id/zonas", requireAuth, requireRole("admin"), zonasConDisponiblesDeCarga);
router.get("/cargas/:id/zonas/:zonaId/vendedores", requireAuth, requireRole("admin"), vendedoresDeZonaParaAsignar);
router.post("/asignar-individual", requireAuth, requireRole("admin"), asignarIndividual);
router.get("/cargas/:id/resumen-zonas", requireAuth, requireRole("admin"), resumenZonasCarga);

// Cartera de un vendedor especifico -- usado para reasignar una visita mal registrada
router.get("/de-vendedor/:vendedorId", requireAuth, requireRole("admin"), leadsDeVendedor);

// El vendedor consulta su propia cartera y prospecta nuevos clientes
router.get("/mis-leads", requireAuth, requireRole("vendedor", "admin"), misLeads);
router.post("/prospectar", requireAuth, requireRole("vendedor", "admin"), crearLeadProspecto);
router.put("/:id", requireAuth, requireRole("vendedor", "admin"), actualizarLead);

module.exports = router;

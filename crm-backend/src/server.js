const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
require("dotenv").config();

const socket = require("./socket");

const authRoutes = require("./routes/auth");
const leadsRoutes = require("./routes/leads");
const jornadaRoutes = require("./routes/jornada");
const visitasRoutes = require("./routes/visitas");
const zonasRoutes = require("./routes/zonas");
const kpisRoutes = require("./routes/kpis");
const intercambiosRoutes = require("./routes/intercambios");
const usuariosRoutes = require("./routes/usuarios");
const catalogoPausasRoutes = require("./routes/catalogoPausas");
const ubigeoRoutes = require("./routes/ubigeo");
const permisosSupervisorRoutes = require("./routes/permisosSupervisor");
const checkpointsRoutes = require("./routes/checkpoints");
const notificacionesRoutes = require("./routes/notificaciones");
const ubicacionRoutes = require("./routes/ubicacion");
const reportesRoutes = require("./routes/reportes");
const catalogoRoutes = require("./routes/catalogo");

// Registra el cron de cierre automatico a medianoche (tasks/autoCloseTask.js).
// Antes este archivo no se requeria en ningun lado del proyecto, asi que
// el cron nunca llegaba a programarse -- ver la nota de robustez en
// jornadaController.marcarIngreso para la red de seguridad complementaria.
require("./tasks/autoCloseTask");

const app = express();

app.use(cors());
app.use(express.json());

// Servir archivos estaticos (fotos y firmas)
app.use(express.static(path.join(__dirname, "..")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/jornada", jornadaRoutes);
app.use("/api/visitas", visitasRoutes);
app.use("/api/zonas", zonasRoutes);
app.use("/api/kpis", kpisRoutes);
app.use("/api/intercambios", intercambiosRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/catalogo-pausas", catalogoPausasRoutes);
app.use("/api/ubigeo", ubigeoRoutes);
app.use("/api/permisos-supervisor", permisosSupervisorRoutes);
app.use("/api/checkpoints", checkpointsRoutes);
app.use("/api/notificaciones", notificacionesRoutes);
app.use("/api/ubicacion", ubicacionRoutes);
app.use("/api/reportes", reportesRoutes);
// Motor de Catálogo Digital activado
app.use("/api/catalogo", catalogoRoutes);

// Manejo de errores no controlados
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 3000;

// IMPORTANTE: Socket.IO necesita un servidor HTTP explicito para "engancharse" encima
// de Express -- por eso ya no se usa app.listen() directo, sino http.createServer(app)
// y luego socket.init(server) antes de poner el servidor a escuchar.
const server = http.createServer(app);
socket.init(server);

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Socket.IO listo para notificaciones en tiempo real`);
});

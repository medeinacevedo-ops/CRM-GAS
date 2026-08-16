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
const sosRoutes = require("./routes/sos");

// Intento de carga segura de tareas automáticas
try {
  require("./tasks/autoCloseTask");
  console.log("Tareas automáticas cargadas.");
} catch (e) {
  console.warn("Advertencia: No se pudieron cargar las tareas automáticas, el servidor continuará arrancando.");
}

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "..")));

app.get("/health", (req, res) => res.json({ status: "A3 PULSE ONLINE", time: new Date() }));

// ENDPOINTS DE LA API
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
app.use("/api/catalogo", catalogoRoutes);
app.use("/api/sos", sosRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
socket.init(server);

server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

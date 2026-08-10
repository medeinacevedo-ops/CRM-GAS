// Si estamos en local (localhost) usamos el puerto 3000, si no, la URL de Render
const API_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000/api"
    : "https://crm-gas-backend-2aj8.onrender.com/api";

let token = localStorage.getItem("crm_token") || null;
let usuario = JSON.parse(localStorage.getItem("crm_usuario") || "null");

// ---------------------------------------------------------------------
// Helper central para llamar al backend con el token ya incluido
// ---------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Ocurrio un error inesperado");
  }
  return data;
}

// ---------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------
const vistaLogin = document.getElementById("vista-login");
const vistaApp = document.getElementById("vista-app");
const formLogin = document.getElementById("form-login");
const loginError = document.getElementById("login-error");

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (data.usuario.rol !== "admin") {
      loginError.textContent = "Este panel es solo para administradores";
      return;
    }

    token = data.token;
    usuario = data.usuario;
    localStorage.setItem("crm_token", token);
    localStorage.setItem("crm_usuario", JSON.stringify(usuario));

    mostrarApp();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => {
  token = null;
  usuario = null;
  localStorage.removeItem("crm_token");
  localStorage.removeItem("crm_usuario");
  vistaApp.classList.add("oculto");
  vistaLogin.classList.remove("oculto");
  detenerSocketNotificaciones();
  if (mapaVivo) {
    Object.values(marcadoresVivo).forEach((m) => mapaVivo.removeLayer(m));
  }
  ubicacionesVivo = {};
  marcadoresVivo = {};
});

function mostrarApp() {
  vistaLogin.classList.add("oculto");
  vistaApp.classList.remove("oculto");
  document.getElementById("usuario-nombre").textContent = usuario.nombre;
  cargarZonasEnSelectores();
  cargarHistorial();
  cargarDashboard();
  iniciarSocketNotificaciones();
}

// (la conexion automatica si ya habia sesion guardada se dispara al final
// del archivo, despues de que todos los listeners de la UI ya se registraron
// -- asi un fallo ahi no bloquea el resto del panel, como el acordeon del menu)

// ---------------------------------------------------------------------
// ACORDEON DE GRUPOS DEL SIDEBAR
// ---------------------------------------------------------------------
document.querySelectorAll(".nav-grupo-header").forEach((header) => {
  header.addEventListener("click", () => {
    header.closest(".nav-grupo").classList.toggle("abierto");
  });
});

// ---------------------------------------------------------------------
// NAVEGACION ENTRE PANELES
// ---------------------------------------------------------------------
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("activo"));
    btn.classList.add("activo");

    document.querySelectorAll(".panel").forEach((p) => p.classList.add("oculto"));
    document.getElementById(`panel-${btn.dataset.vista}`).classList.remove("oculto");

    if (btn.dataset.vista === "historial") cargarHistorial();
    if (btn.dataset.vista === "operativos") inicializarPantallaOperativos();
    if (btn.dataset.vista === "reparto") inicializarPantallaReparto();
    if (btn.dataset.vista === "dashboard") cargarDashboard();
    if (btn.dataset.vista === "usuarios") cargarUsuarios();
    if (btn.dataset.vista === "pausas") cargarPausas();
    if (btn.dataset.vista === "intercambios") cargarIntercambios();
    if (btn.dataset.vista === "zonas") cargarZonas();
    if (btn.dataset.vista === "visitas") cargarPantallaVisitas();
    if (btn.dataset.vista === "permisos") cargarPermisos();
    if (btn.dataset.vista === "ubicacion") cargarPantallaUbicacion();
    if (btn.dataset.vista === "reportes-export") cargarPantallaReportesExport();
    if (btn.dataset.vista === "jornadas-admin") cargarPantallaJornadasAdmin();
  });
});

// ---------------------------------------------------------------------
// ZONAS (para los selectores)
// ---------------------------------------------------------------------
async function cargarZonasEnSelectores() {
  try {
    const zonas = await apiFetch("/zonas");
    const zonasActivas = zonas.filter((z) => z.activo);
    const opciones = zonasActivas
      .map((z) => `<option value="${z.id}">${z.nombre} — ${z.distrito}</option>`)
      .join("");

    const selectUsuario = document.getElementById("usuario-zona-input");
    selectUsuario.innerHTML = `<option value="">— Sin zona —</option>` + opciones;
  } catch (err) {
    console.error("No se pudieron cargar las zonas:", err.message);
  }
}

// ---------------------------------------------------------------------
// CARGAR BASE (CSV)
// ---------------------------------------------------------------------
document.getElementById("form-cargar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("archivo-csv");
  const mensaje = document.getElementById("cargar-mensaje");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  if (!input.files[0]) return;

  const formData = new FormData();
  formData.append("archivo", input.files[0]);

  try {
    const data = await apiFetch("/leads/cargar-base", { method: "POST", body: formData });
    mensaje.textContent = `Carga exitosa — ID ${data.carga_id}, ${data.total_registros} registros.`;
    input.value = "";
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

// ---------------------------------------------------------------------
// HISTORIAL DE CARGAS
// ---------------------------------------------------------------------
async function cargarHistorial() {
  const tbody = document.getElementById("tabla-historial");
  try {
    const cargas = await apiFetch("/leads/cargas");
    tbody.innerHTML = cargas
      .map(
        (c) => `
        <tr>
          <td>${c.id}</td>
          <td>${c.nombre_archivo}</td>
          <td>${c.total_registros}</td>
          <td><span class="badge ${c.estado}">${c.estado}</span></td>
          <td>${c.cargado_por}</td>
          <td>${new Date(c.fecha_carga).toLocaleString("es-PE")}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Error al cargar el historial: ${err.message}</td></tr>`;
  }
}
document.getElementById("btn-refrescar-historial").addEventListener("click", cargarHistorial);

// ---------------------------------------------------------------------
// GESTION OPERATIVA: seleccionar base -> resumen -> zona -> asignar
// ---------------------------------------------------------------------
let opCargaSeleccionada = null;
let opZonaSeleccionada = null;

async function inicializarPantallaOperativos() {
  const select = document.getElementById("op-select-base");
  select.innerHTML = `<option value="">Cargando cargas...</option>`;
  resetearPasosOperativos();

  try {
    const cargas = await apiFetch("/leads/cargas");
    if (cargas.length === 0) {
      select.innerHTML = `<option value="">No hay bases cargadas todavía</option>`;
      return;
    }
    select.innerHTML =
      `<option value="">— Elige una base —</option>` +
      cargas
        .map(
          (c) =>
            `<option value="${c.id}">${c.nombre_archivo} — ${new Date(c.fecha_carga).toLocaleDateString("es-PE")} (${c.total_registros} registros)</option>`
        )
        .join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error al cargar</option>`;
    console.error("Error al listar cargas:", err.message);
  }
}

function resetearPasosOperativos() {
  document.getElementById("op-tarjeta-resumen").classList.add("oculto");
  document.getElementById("op-paso-zona").classList.add("oculto");
  document.getElementById("op-tabla-vendedores-wrap").classList.add("oculto");
  document.getElementById("op-mensaje-asignacion").textContent = "";
  opCargaSeleccionada = null;
  opZonaSeleccionada = null;
}

document.getElementById("op-select-base").addEventListener("change", async (e) => {
  const cargaId = e.target.value;
  document.getElementById("op-paso-zona").classList.add("oculto");
  document.getElementById("op-tabla-vendedores-wrap").classList.add("oculto");
  document.getElementById("op-mensaje-asignacion").textContent = "";

  if (!cargaId) {
    document.getElementById("op-tarjeta-resumen").classList.add("oculto");
    return;
  }

  opCargaSeleccionada = cargaId;

  try {
    const resumen = await apiFetch(`/leads/cargas/${cargaId}/resumen`);
    document.getElementById("op-total-leads").textContent = resumen.total_leads;
    document.getElementById("op-leads-disponibles").textContent = resumen.leads_disponibles;

    const sinZonaWrap = document.getElementById("op-sin-zona-wrap");
    if (resumen.sin_zona > 0) {
      document.getElementById("op-sin-zona").textContent = resumen.sin_zona;
      sinZonaWrap.classList.remove("oculto");
    } else {
      sinZonaWrap.classList.add("oculto");
    }

    document.getElementById("op-tarjeta-resumen").classList.remove("oculto");

    await cargarZonasDisponiblesOperativo(cargaId);
    document.getElementById("op-paso-zona").classList.remove("oculto");
  } catch (err) {
    alert(`Error al cargar el resumen: ${err.message}`);
  }
});

async function cargarZonasDisponiblesOperativo(cargaId) {
  const select = document.getElementById("op-select-zona");
  select.innerHTML = `<option value="">Cargando zonas...</option>`;
  try {
    const zonas = await apiFetch(`/leads/cargas/${cargaId}/zonas`);
    if (zonas.length === 0) {
      select.innerHTML = `<option value="">No hay zonas con leads disponibles de esta base</option>`;
      return;
    }
    select.innerHTML =
      `<option value="">— Elige una zona —</option>` +
      zonas.map((z) => `<option value="${z.id}">${z.nombre} — ${z.disponibles} disponibles</option>`).join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error al cargar</option>`;
  }
}

document.getElementById("op-select-zona").addEventListener("change", async (e) => {
  const zonaId = e.target.value;
  document.getElementById("op-mensaje-asignacion").textContent = "";

  if (!zonaId) {
    document.getElementById("op-tabla-vendedores-wrap").classList.add("oculto");
    return;
  }

  opZonaSeleccionada = zonaId;

  try {
    const data = await apiFetch(`/leads/cargas/${opCargaSeleccionada}/zonas/${zonaId}/vendedores`);

    document.getElementById("op-disponibles-zona-texto").textContent =
      `${data.disponibles_en_zona} leads disponibles para repartir en esta zona.`;

    const tbody = document.getElementById("op-tabla-vendedores");
    if (data.vendedores.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);">No hay vendedores activos en esta zona.</td></tr>`;
    } else {
      tbody.innerHTML = data.vendedores
        .map(
          (v) => `
          <tr>
            <td>${v.nombre}</td>
            <td>${v.cartera_total}</td>
            <td><input type="number" min="0" value="0" data-vendedor-id="${v.id}" class="op-input-cantidad"></td>
          </tr>`
        )
        .join("");
    }

    document.getElementById("op-tabla-vendedores-wrap").classList.remove("oculto");
  } catch (err) {
    alert(`Error al cargar vendedores: ${err.message}`);
  }
});

document.getElementById("op-btn-asignar").addEventListener("click", async () => {
  const mensaje = document.getElementById("op-mensaje-asignacion");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  const asignaciones = Array.from(document.querySelectorAll(".op-input-cantidad"))
    .map((input) => ({ vendedor_id: input.dataset.vendedorId, cantidad: Number(input.value) }))
    .filter((a) => a.cantidad > 0);

  if (asignaciones.length === 0) {
    mensaje.textContent = "Escribe al menos una cantidad mayor a 0 para asignar.";
    mensaje.classList.add("error");
    return;
  }

  try {
    const data = await apiFetch("/leads/asignar-individual", {
      method: "POST",
      body: JSON.stringify({ carga_id: opCargaSeleccionada, zona_id: opZonaSeleccionada, asignaciones }),
    });

    const totalAsignados = data.resultados.reduce((sum, r) => sum + r.asignados, 0);
    mensaje.textContent = `${totalAsignados} leads asignados correctamente.`;

    // Refresca el resumen y la lista de vendedores para reflejar lo ya asignado
    document.getElementById("op-select-base").dispatchEvent(new Event("change"));
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

// ---------------------------------------------------------------------
// REPARTO AUTOMATICO
// ---------------------------------------------------------------------
let repCargaSeleccionada = null;

async function inicializarPantallaReparto() {
  const select = document.getElementById("rep-select-base");
  select.innerHTML = `<option value="">Cargando cargas...</option>`;
  document.getElementById("rep-desglose-wrap").classList.add("oculto");
  document.getElementById("rep-paso-zona").classList.add("oculto");
  document.getElementById("reparto-mensaje").textContent = "";
  document.getElementById("reparto-resumen").innerHTML = "";
  repCargaSeleccionada = null;

  try {
    const cargas = await apiFetch("/leads/cargas");
    if (cargas.length === 0) {
      select.innerHTML = `<option value="">No hay bases cargadas todavía</option>`;
      return;
    }
    select.innerHTML =
      `<option value="">— Elige una base —</option>` +
      cargas
        .map(
          (c) =>
            `<option value="${c.id}">${c.nombre_archivo} — ${new Date(c.fecha_carga).toLocaleDateString("es-PE")} (${c.total_registros} registros)</option>`
        )
        .join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error al cargar</option>`;
  }
}

document.getElementById("rep-select-base").addEventListener("change", async (e) => {
  const cargaId = e.target.value;
  document.getElementById("reparto-mensaje").textContent = "";
  document.getElementById("reparto-resumen").innerHTML = "";

  if (!cargaId) {
    document.getElementById("rep-desglose-wrap").classList.add("oculto");
    document.getElementById("rep-paso-zona").classList.add("oculto");
    return;
  }

  repCargaSeleccionada = cargaId;
  await cargarDesgloseReparto(cargaId);
});

async function cargarDesgloseReparto(cargaId) {
  try {
    const data = await apiFetch(`/leads/cargas/${cargaId}/resumen-zonas`);
    const tbody = document.getElementById("rep-tabla-desglose");

    if (data.zonas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Esta base no tiene leads emparejados con ninguna zona todavía.</td></tr>`;
    } else {
      tbody.innerHTML = data.zonas
        .map(
          (z) => `
          <tr>
            <td>${z.nombre}</td>
            <td>${z.distrito}</td>
            <td>${z.total_leads}</td>
            <td>${z.leads_disponibles}</td>
            <td>${z.vendedores}</td>
          </tr>`
        )
        .join("");
    }
    document.getElementById("rep-desglose-wrap").classList.remove("oculto");

    const sinZonaTexto = document.getElementById("rep-sin-zona-texto");
    if (data.sin_zona > 0) {
      sinZonaTexto.textContent = `${data.sin_zona} leads de esta base no coinciden con ninguna zona registrada.`;
      sinZonaTexto.classList.remove("oculto");
    } else {
      sinZonaTexto.classList.add("oculto");
    }

    const selectZona = document.getElementById("rep-select-zona");
    const zonasConDisponibles = data.zonas.filter((z) => z.leads_disponibles > 0);
    if (zonasConDisponibles.length === 0) {
      selectZona.innerHTML = `<option value="">No hay zonas con leads disponibles</option>`;
    } else {
      selectZona.innerHTML =
        `<option value="">— Elige una zona —</option>` +
        zonasConDisponibles
          .map((z) => `<option value="${z.id}">${z.nombre} — ${z.leads_disponibles} disponibles, ${z.vendedores} vendedores</option>`)
          .join("");
    }
    document.getElementById("rep-paso-zona").classList.remove("oculto");
  } catch (err) {
    console.error("Error al cargar el desglose:", err.message);
    document.getElementById("reparto-mensaje").textContent = `Error al cargar el desglose: ${err.message}`;
    document.getElementById("reparto-mensaje").classList.add("error");
  }
}

document.getElementById("rep-btn-repartir").addEventListener("click", async () => {
  const mensaje = document.getElementById("reparto-mensaje");
  const resumen = document.getElementById("reparto-resumen");
  mensaje.textContent = "";
  mensaje.classList.remove("error");
  resumen.innerHTML = "";

  const zona_id = document.getElementById("rep-select-zona").value;
  if (!zona_id) {
    mensaje.textContent = "Elige una zona primero.";
    mensaje.classList.add("error");
    return;
  }

  try {
    const data = await apiFetch("/leads/repartir-automatico", {
      method: "POST",
      body: JSON.stringify({ zona_id, carga_id: repCargaSeleccionada }),
    });

    const r = data.resultados[0];
    if (r.motivo === "sin_vendedores_activos") {
      mensaje.textContent = "No hay vendedores activos en esta zona.";
      mensaje.classList.add("error");
    } else if (r.motivo === "sin_leads_disponibles") {
      mensaje.textContent = "Ya no quedan leads disponibles en esta zona para esta base.";
      mensaje.classList.add("error");
    } else {
      mensaje.textContent = `${r.leads_asignados} leads repartidos parejo entre ${r.vendedores} vendedores.`;
    }

    // Refresca el desglose para reflejar los nuevos disponibles
    await cargarDesgloseReparto(repCargaSeleccionada);
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

// ---------------------------------------------------------------------
// DASHBOARD GENERAL
// ---------------------------------------------------------------------
function formatoMoneda(valor) {
  return `S/ ${Number(valor).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

let dashFiltrosInicializados = false;

/**
 * Convierte un contenedor <div class="multiselect" id="..."> (con un
 * boton y un panel adentro) en un dropdown de checkboxes con opcion
 * "Todas las bases" -- reemplaza el <select multiple> nativo, que se
 * veia como una caja de lista siempre abierta ocupando espacio fijo en
 * vez de un desplegable real. Reutilizado por el filtro del Dashboard y
 * el de Reportes.
 */
function crearMultiSelect(idContenedor) {
  const contenedor = document.getElementById(idContenedor);
  const boton = contenedor.querySelector(".multiselect-boton");
  const panel = contenedor.querySelector(".multiselect-panel");
  let opciones = []; // [{ value, label }]
  let seleccionados = new Set();

  function actualizarBoton() {
    if (seleccionados.size === 0) {
      boton.textContent = "Todas las bases";
    } else if (seleccionados.size === 1) {
      const op = opciones.find((o) => seleccionados.has(o.value));
      boton.textContent = op ? op.label : "1 base seleccionada";
    } else {
      boton.textContent = `${seleccionados.size} bases seleccionadas`;
    }
  }

  function render() {
    const filaTodas = `
      <label class="multiselect-opcion">
        <input type="checkbox" data-todas ${seleccionados.size === 0 ? "checked" : ""}>
        <span>Todas las bases</span>
      </label>`;
    const filasOpciones = opciones
      .map(
        (o) => `
      <label class="multiselect-opcion">
        <input type="checkbox" value="${o.value}" ${seleccionados.has(o.value) ? "checked" : ""}>
        <span>${o.label}</span>
      </label>`
      )
      .join("");
    panel.innerHTML = filaTodas + filasOpciones;

    panel.querySelector("input[data-todas]").addEventListener("change", (e) => {
      if (e.target.checked) {
        seleccionados.clear();
        render();
        actualizarBoton();
        contenedor.dispatchEvent(new Event("change"));
      } else {
        e.target.checked = true; // "Todas" solo se desmarca eligiendo otra opcion, no sola
      }
    });

    panel.querySelectorAll('input[type="checkbox"]:not([data-todas])').forEach((chk) => {
      chk.addEventListener("change", (e) => {
        if (e.target.checked) seleccionados.add(e.target.value);
        else seleccionados.delete(e.target.value);
        render();
        actualizarBoton();
        contenedor.dispatchEvent(new Event("change"));
      });
    });
  }

  boton.addEventListener("click", (e) => {
    e.stopPropagation();
    const abierto = !panel.classList.contains("oculto");
    document.querySelectorAll(".multiselect-panel").forEach((p) => p.classList.add("oculto"));
    if (!abierto) panel.classList.remove("oculto");
  });

  document.addEventListener("click", (e) => {
    if (!contenedor.contains(e.target)) panel.classList.add("oculto");
  });

  return {
    setOpciones(nuevasOpciones) {
      opciones = nuevasOpciones;
      seleccionados = new Set();
      render();
      actualizarBoton();
    },
    getSeleccionados() {
      return Array.from(seleccionados);
    },
  };
}

let dashMultiSelectBases = null;

async function inicializarFiltrosDashboard() {
  const inputMes = document.getElementById("dash-filtro-mes");
  const hoy = new Date();
  inputMes.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;

  try {
    const cargas = await apiFetch("/leads/cargas");
    if (!dashMultiSelectBases) dashMultiSelectBases = crearMultiSelect("dash-filtro-bases");
    dashMultiSelectBases.setOpciones(cargas.map((c) => ({ value: String(c.id), label: `${c.nombre_archivo} (${c.total_registros})` })));
  } catch (err) {
    console.error("Error al cargar bases para el dashboard:", err.message);
  }

  inputMes.addEventListener("change", cargarDashboard);
  document.getElementById("dash-filtro-bases").addEventListener("change", cargarDashboard);
}

/** Arma "?mes=...&base_ids=..." a partir de los filtros actuales del dashboard. */
function paramsFiltrosDashboard() {
  const params = new URLSearchParams();
  const mes = document.getElementById("dash-filtro-mes").value;
  if (mes) params.set("mes", mes);

  const basesSeleccionadas = dashMultiSelectBases ? dashMultiSelectBases.getSeleccionados() : [];
  if (basesSeleccionadas.length > 0) params.set("base_ids", basesSeleccionadas.join(","));

  return params;
}

async function cargarDashboard() {
  if (!dashFiltrosInicializados) {
    await inicializarFiltrosDashboard();
    dashFiltrosInicializados = true;
  }

  const params = paramsFiltrosDashboard();

  try {
    const data = await apiFetch(`/kpis/dashboard?${params.toString()}`);

    document.getElementById("kpi-ventas-mes").textContent = formatoMoneda(data.ventas_mes);
    document.getElementById("kpi-convertidos").textContent = data.leads_convertidos_mes;
    document.getElementById("kpi-activos").textContent = `${data.vendedores_activos_hoy} / ${data.total_vendedores}`;
    document.getElementById("kpi-conversion").textContent = `${data.conversion_promedio_pct}%`;

    // Cobertura por zona
    const coberturaDiv = document.getElementById("cobertura-lista");
    coberturaDiv.innerHTML = data.cobertura_por_zona
      .map((z) => {
        const nivel = z.porcentaje >= 60 ? "" : z.porcentaje >= 35 ? "medio" : "bajo";
        return `
          <div class="zona-barra">
            <div class="zona-barra-top">
              <span>${z.zona}</span>
              <span style="color:var(--text-muted);">${z.porcentaje}% (${z.trabajados}/${z.total_leads})</span>
            </div>
            <div class="zona-barra-fondo">
              <div class="zona-barra-relleno ${nivel}" style="width:${z.porcentaje}%;"></div>
            </div>
          </div>`;
      })
      .join("") || "<p class='descripcion'>Aún no hay leads generados en ninguna zona.</p>";

    // Ventas por semana
    const tbodySemana = document.querySelector("#tabla-ventas-semana tbody");
    tbodySemana.innerHTML =
      data.ventas_por_semana
        .map((s) => `<tr><td>Semana ${s.semana}</td><td>${formatoMoneda(s.monto)}</td></tr>`)
        .join("") || `<tr><td colspan="2">Sin ventas registradas este mes</td></tr>`;

    // Ranking de vendedores
    const tbodyRanking = document.getElementById("tabla-ranking");
    tbodyRanking.innerHTML =
      data.ranking_vendedores
        .map(
          (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${r.vendedor}</td>
          <td>${r.zona || "—"}</td>
          <td>${formatoMoneda(r.ventas_monto)}</td>
          <td>${r.conversion_pct}%</td>
        </tr>`
        )
        .join("") || `<tr><td colspan="5">Sin datos de ventas todavía</td></tr>`;
  } catch (err) {
    console.error("Error al cargar el dashboard:", err.message);
  }

  cargarResumenIndicadores(params);
  cargarSerieDiaria(params);
}

document.getElementById("btn-refrescar-dashboard").addEventListener("click", cargarDashboard);

/**
 * Mini-resumen con tendencia (LEADS / COBERTURA / CONTACTOS / PEDIDOS /
 * VENTAS / CONVERSIÓN), debajo de "Resumen general". Usa los mismos
 * filtros de mes/base que el resto del dashboard.
 */
async function cargarResumenIndicadores(params) {
  const cont = document.getElementById("indicadores-scroll");
  try {
    const { actual, cambios } = await apiFetch(`/kpis/resumen?${params.toString()}`);

    const items = [
      { icono: "👥", etiqueta: "Leads", valor: actual.leads_total, cambio: cambios.leads_total },
      { icono: "🚶", etiqueta: "Cobertura", valor: `${actual.cobertura_pct}%`, cambio: cambios.cobertura_pct },
      { icono: "💬", etiqueta: "Contactos", valor: actual.contactos_total, cambio: cambios.contactos_total },
      { icono: "🧾", etiqueta: "Pedidos", valor: actual.pedidos_total, cambio: cambios.pedidos_total },
      { icono: "💰", etiqueta: "Ventas", valor: formatoMoneda(actual.ventas_monto), cambio: cambios.ventas_monto },
      { icono: "📈", etiqueta: "Conversión", valor: `${actual.conversion_pct}%`, cambio: cambios.conversion_pct },
    ];

    cont.innerHTML = items.map((it) => `
      <div class="indicador-item">
        <div class="indicador-top">${it.icono} ${it.etiqueta}</div>
        <p class="indicador-valor">${it.valor}</p>
        ${renderTendencia(it.cambio)}
      </div>
    `).join("");
  } catch (err) {
    console.error("Error al cargar el resumen de indicadores:", err.message);
    cont.innerHTML = `<div class="indicador-item"><p class="descripcion">No se pudo cargar el resumen.</p></div>`;
  }
}

/** cambio null = periodo anterior en 0, no hay porcentaje matematicamente valido. */
function renderTendencia(cambio) {
  if (cambio === null) {
    return `<span class="indicador-tendencia sin-dato">Sin dato del mes anterior</span>`;
  }
  if (cambio === 0) {
    return `<span class="indicador-tendencia sin-dato">Sin cambio</span>`;
  }
  const clase = cambio > 0 ? "subio" : "bajo";
  const flecha = cambio > 0 ? "↑" : "↓";
  return `<span class="indicador-tendencia ${clase}">${cambio > 0 ? "+" : ""}${cambio}% ${flecha}</span>`;
}

let graficoDiarioInstancia = null;

async function cargarSerieDiaria(params) {
  try {
    const qs = params ? params.toString() : paramsFiltrosDashboard().toString();
    const serie = await apiFetch(`/kpis/serie-diaria?${qs}`);

    const labels = serie.map((d) => d.dia);
    const visitas = serie.map((d) => d.visitas);
    const ventas = serie.map((d) => d.ventas);

    if (typeof Chart === "undefined") {
      console.error("La librería Chart.js no cargó (revisa tu conexión a internet o el bloqueo de CDN).");
      return;
    }

    const ctx = document.getElementById("graficoDiario");

    if (graficoDiarioInstancia) {
      graficoDiarioInstancia.destroy();
    }

    graficoDiarioInstancia = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Visitas",
            data: visitas,
            backgroundColor: "#2b7a78",
            borderRadius: 4,
            yAxisID: "yVisitas",
            order: 2,
          },
          {
            type: "line",
            label: "Ventas",
            data: ventas,
            borderColor: "#c9962c",
            backgroundColor: "#c9962c",
            tension: 0.3,
            pointRadius: 3,
            yAxisID: "yVentas",
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 12, font: { size: 11.5 } } },
        },
        scales: {
          x: {
            title: { display: true, text: "Día del mes", font: { size: 11 } },
            grid: { display: false },
          },
          yVisitas: {
            position: "left",
            beginAtZero: true,
            title: { display: true, text: "Visitas", font: { size: 11 } },
            grid: { color: "#eef1f4" },
          },
          yVentas: {
            position: "right",
            beginAtZero: true,
            title: { display: true, text: "Ventas", font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  } catch (err) {
    console.error("Error al cargar la serie diaria:", err.message);
  }
}

// ---------------------------------------------------------------------
// GESTION DE USUARIOS
// ---------------------------------------------------------------------
const modalUsuario = document.getElementById("modal-usuario");
const formUsuario = document.getElementById("form-usuario");
const campoPassword = document.getElementById("campo-password");

let usuariosCache = [];

async function cargarUsuarios() {
  const tbody = document.getElementById("tabla-usuarios");
  try {
    usuariosCache = await apiFetch("/usuarios");
    aplicarFiltrosUsuarios();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">Error al cargar usuarios: ${err.message}</td></tr>`;
  }
}

function aplicarFiltrosUsuarios() {
  const texto = document.getElementById("buscar-usuarios").value.trim().toLowerCase();
  const rol = document.getElementById("filtro-rol-usuarios").value;

  const filtrados = usuariosCache.filter((u) => {
    const coincideTexto = !texto || u.nombre.toLowerCase().includes(texto) || u.email.toLowerCase().includes(texto);
    const coincideRol = !rol || u.rol === rol;
    return coincideTexto && coincideRol;
  });

  document.getElementById("contador-usuarios").textContent =
    `${filtrados.length} de ${usuariosCache.length} usuarios`;

  renderTablaUsuarios(filtrados);
}

document.getElementById("buscar-usuarios").addEventListener("input", aplicarFiltrosUsuarios);
document.getElementById("filtro-rol-usuarios").addEventListener("change", aplicarFiltrosUsuarios);

function renderTablaUsuarios(usuarios) {
  const tbody = document.getElementById("tabla-usuarios");

  if (usuarios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);">No se encontraron usuarios con ese criterio.</td></tr>`;
    return;
  }

  tbody.innerHTML = usuarios
    .map(
      (u) => `
      <tr data-id="${u.id}">
        <td>${u.nombre}</td>
        <td>${u.email}</td>
        <td><span class="badge ${u.rol}">${u.rol}</span></td>
        <td>${u.zona_nombre ? `${u.zona_nombre} — ${u.distrito}` : "—"}</td>
        <td>${u.rol === "vendedor" ? u.cartera_total : "—"}</td>
        <td>
          <label class="switch">
            <input type="checkbox" class="switch-activo" data-id="${u.id}" ${u.activo ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </td>
        <td>
          <div class="acciones-fila">
            <button class="btn-icono" data-accion="editar" data-id="${u.id}" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn-icono" data-accion="password" data-id="${u.id}" title="Cambiar contraseña" aria-label="Cambiar contraseña">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8"/><path d="M15.5 7.5 18 10"/><path d="M18.5 6.5 21 9"/></svg>
            </button>
            <button class="btn-icono peligro" data-accion="eliminar" data-id="${u.id}" title="Eliminar" aria-label="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-accion='editar']").forEach((btn) => {
    btn.addEventListener("click", () => abrirModalEditar(usuariosCache.find((u) => u.id == btn.dataset.id)));
  });
  tbody.querySelectorAll("[data-accion='password']").forEach((btn) => {
    btn.addEventListener("click", () => cambiarPasswordUsuario(btn.dataset.id));
  });
  tbody.querySelectorAll("[data-accion='eliminar']").forEach((btn) => {
    btn.addEventListener("click", () => eliminarUsuarioConfirmar(btn.dataset.id, btn));
  });
  tbody.querySelectorAll(".switch-activo").forEach((chk) => {
    chk.addEventListener("change", () => toggleActivoUsuario(chk.dataset.id, chk.checked, chk));
  });
}

async function toggleActivoUsuario(id, activo, checkboxEl) {
  try {
    await apiFetch(`/usuarios/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activo: activo ? 1 : 0 }),
    });
  } catch (err) {
    checkboxEl.checked = !activo; // revierte el switch si fallo
    alert(`Error: ${err.message}`);
  }
}

async function eliminarUsuarioConfirmar(id, btnEl) {
  const fila = btnEl.closest("tr");
  const nombre = fila.children[0].textContent;
  if (!confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return;

  try {
    await apiFetch(`/usuarios/${id}`, { method: "DELETE" });
    cargarUsuarios();
  } catch (err) {
    alert(`No se pudo eliminar: ${err.message}`);
  }
}

function abrirModalNuevo() {
  formUsuario.reset();
  document.getElementById("usuario-id").value = "";
  document.getElementById("modal-usuario-titulo").textContent = "Nuevo usuario";
  document.getElementById("usuario-mensaje").textContent = "";
  campoPassword.classList.remove("oculto");
  document.getElementById("usuario-password-input").required = true;
  modalUsuario.classList.remove("oculto");
}

function abrirModalEditar(usuario) {
  document.getElementById("usuario-id").value = usuario.id;
  document.getElementById("usuario-nombre-input").value = usuario.nombre;
  document.getElementById("usuario-email-input").value = usuario.email;
  document.getElementById("usuario-telefono-input").value = usuario.telefono || "";
  document.getElementById("usuario-rol-input").value = usuario.rol;
  document.getElementById("usuario-zona-input").value = usuario.zona_id || "";
  document.getElementById("usuario-activo-input").checked = !!usuario.activo;
  document.getElementById("modal-usuario-titulo").textContent = `Editar: ${usuario.nombre}`;
  document.getElementById("usuario-mensaje").textContent = "";
  // El email no se edita aqui para mantenerlo simple (es el identificador de login)
  document.getElementById("usuario-email-input").disabled = true;
  campoPassword.classList.add("oculto"); // password se cambia aparte
  document.getElementById("usuario-password-input").required = false;
  modalUsuario.classList.remove("oculto");
}

document.getElementById("btn-nuevo-usuario").addEventListener("click", () => {
  document.getElementById("usuario-email-input").disabled = false;
  abrirModalNuevo();
});
document.getElementById("btn-cancelar-usuario").addEventListener("click", () => {
  modalUsuario.classList.add("oculto");
});

formUsuario.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("usuario-mensaje");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  const id = document.getElementById("usuario-id").value;
  const payload = {
    nombre: document.getElementById("usuario-nombre-input").value,
    telefono: document.getElementById("usuario-telefono-input").value,
    rol: document.getElementById("usuario-rol-input").value,
    zona_id: document.getElementById("usuario-zona-input").value || null,
    activo: document.getElementById("usuario-activo-input").checked ? 1 : 0,
  };

  try {
    if (id) {
      await apiFetch(`/usuarios/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      payload.email = document.getElementById("usuario-email-input").value;
      payload.password = document.getElementById("usuario-password-input").value;
      await apiFetch("/usuarios", { method: "POST", body: JSON.stringify(payload) });
    }
    modalUsuario.classList.add("oculto");
    cargarUsuarios();
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

async function cambiarPasswordUsuario(id) {
  const nueva = prompt("Nueva contraseña (mínimo 8 caracteres):");
  if (!nueva) return;
  try {
    await apiFetch(`/usuarios/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password: nueva }),
    });
    alert("Contraseña actualizada correctamente.");
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// CATALOGO DE PAUSAS
// ---------------------------------------------------------------------
const modalPausa = document.getElementById("modal-pausa");
const formPausa = document.getElementById("form-pausa");
let pausasCache = [];

async function cargarPausas() {
  const tbody = document.getElementById("tabla-pausas");
  try {
    pausasCache = await apiFetch("/catalogo-pausas");
    renderTablaPausas();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error al cargar el catálogo: ${err.message}</td></tr>`;
  }
}

function renderTablaPausas() {
  const tbody = document.getElementById("tabla-pausas");

  if (pausasCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Aún no hay motivos creados.</td></tr>`;
    return;
  }

  tbody.innerHTML = pausasCache
    .map(
      (p) => `
      <tr>
        <td>${p.nombre}</td>
        <td><span class="badge ${p.tipo === "desconexion" ? "vendedor" : "admin"}">${p.tipo}</span></td>
        <td>${p.tiempo_max_minutos ? `${p.tiempo_max_minutos} min` : "—"}</td>
        <td>
          <label class="switch">
            <input type="checkbox" class="switch-pausa-activo" data-id="${p.id}" ${p.activo ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </td>
        <td>
          <div class="acciones-fila">
            <button class="btn-icono" data-accion="editar-pausa" data-id="${p.id}" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn-icono peligro" data-accion="eliminar-pausa" data-id="${p.id}" title="Eliminar" aria-label="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-accion='editar-pausa']").forEach((btn) => {
    btn.addEventListener("click", () => abrirModalEditarPausa(pausasCache.find((p) => p.id == btn.dataset.id)));
  });
  tbody.querySelectorAll("[data-accion='eliminar-pausa']").forEach((btn) => {
    btn.addEventListener("click", () => eliminarPausaConfirmar(btn.dataset.id, btn));
  });
  tbody.querySelectorAll(".switch-pausa-activo").forEach((chk) => {
    chk.addEventListener("change", () => toggleActivoPausa(chk.dataset.id, chk.checked, chk));
  });
}

function abrirModalNuevaPausa() {
  formPausa.reset();
  document.getElementById("pausa-id").value = "";
  document.getElementById("modal-pausa-titulo").textContent = "Nuevo motivo";
  document.getElementById("pausa-mensaje").textContent = "";
  modalPausa.classList.remove("oculto");
}

function abrirModalEditarPausa(pausa) {
  document.getElementById("pausa-id").value = pausa.id;
  document.getElementById("pausa-nombre-input").value = pausa.nombre;
  document.getElementById("pausa-tipo-input").value = pausa.tipo;
  document.getElementById("pausa-tiempo-input").value = pausa.tiempo_max_minutos || "";
  document.getElementById("modal-pausa-titulo").textContent = `Editar: ${pausa.nombre}`;
  document.getElementById("pausa-mensaje").textContent = "";
  modalPausa.classList.remove("oculto");
}

document.getElementById("btn-nueva-pausa").addEventListener("click", abrirModalNuevaPausa);
document.getElementById("btn-cancelar-pausa").addEventListener("click", () => {
  modalPausa.classList.add("oculto");
});

formPausa.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("pausa-mensaje");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  const id = document.getElementById("pausa-id").value;
  const tiempoInput = document.getElementById("pausa-tiempo-input").value;
  const payload = {
    nombre: document.getElementById("pausa-nombre-input").value,
    tipo: document.getElementById("pausa-tipo-input").value,
    tiempo_max_minutos: tiempoInput ? Number(tiempoInput) : null,
  };

  try {
    if (id) {
      await apiFetch(`/catalogo-pausas/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/catalogo-pausas", { method: "POST", body: JSON.stringify(payload) });
    }
    modalPausa.classList.add("oculto");
    cargarPausas();
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

async function toggleActivoPausa(id, activo, checkboxEl) {
  try {
    await apiFetch(`/catalogo-pausas/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activo: activo ? 1 : 0 }),
    });
  } catch (err) {
    checkboxEl.checked = !activo;
    alert(`Error: ${err.message}`);
  }
}

async function eliminarPausaConfirmar(id, btnEl) {
  const fila = btnEl.closest("tr");
  const nombre = fila.children[0].textContent;
  if (!confirm(`¿Eliminar el motivo "${nombre}"? Esta acción no se puede deshacer.`)) return;

  try {
    await apiFetch(`/catalogo-pausas/${id}`, { method: "DELETE" });
    cargarPausas();
  } catch (err) {
    alert(`No se pudo eliminar: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// INTERCAMBIOS DE LEADS (SOLO LECTURA PARA EL ADMIN)
// ---------------------------------------------------------------------
async function cargarIntercambios() {
  const tbody = document.getElementById("tabla-intercambios");
  try {
    const intercambios = await apiFetch("/intercambios/todos");

    if (intercambios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Aún no se ha propuesto ningún intercambio.</td></tr>`;
      return;
    }

    tbody.innerHTML = intercambios
      .map(
        (i) => `
        <tr>
          <td>${i.vendedor_origen}</td>
          <td>${i.vendedor_destino}</td>
          <td>${i.cantidad}</td>
          <td><span class="badge ${i.estado}">${i.estado}</span></td>
          <td>${new Date(i.fecha).toLocaleString("es-PE")}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error al cargar los intercambios: ${err.message}</td></tr>`;
  }
}
document.getElementById("btn-refrescar-intercambios").addEventListener("click", cargarIntercambios);

// ---------------------------------------------------------------------
// GESTION DE ZONAS
// ---------------------------------------------------------------------
const modalZona = document.getElementById("modal-zona");
const formZona = document.getElementById("form-zona");

async function cargarZonas() {
  const tbody = document.getElementById("tabla-zonas");
  try {
    const zonas = await apiFetch("/zonas");
    renderTablaZonas(zonas);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Error al cargar zonas: ${err.message}</td></tr>`;
  }
}

function renderTablaZonas(zonas) {
  const tbody = document.getElementById("tabla-zonas");

  if (zonas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);">Aún no hay zonas creadas.</td></tr>`;
    return;
  }

  tbody.innerHTML = zonas
    .map(
      (z) => `
      <tr>
        <td>${z.nombre}</td>
        <td>${z.distrito}</td>
        <td>${z.vendedores}</td>
        <td>${z.leads_totales}</td>
        <td>
          <label class="switch">
            <input type="checkbox" class="switch-zona-activo" data-id="${z.id}" ${z.activo ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </td>
        <td>
          <div class="acciones-fila">
            <button class="btn-icono" data-accion="editar-zona" data-id="${z.id}" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn-icono peligro" data-accion="eliminar-zona" data-id="${z.id}" title="Eliminar" aria-label="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-accion='editar-zona']").forEach((btn) => {
    btn.addEventListener("click", () => abrirModalEditarZona(zonas.find((z) => z.id == btn.dataset.id)));
  });
  tbody.querySelectorAll("[data-accion='eliminar-zona']").forEach((btn) => {
    btn.addEventListener("click", () => eliminarZonaConfirmar(btn.dataset.id, btn));
  });
  tbody.querySelectorAll(".switch-zona-activo").forEach((chk) => {
    chk.addEventListener("change", () => toggleActivoZona(chk.dataset.id, chk.checked, chk));
  });
}

async function cargarDepartamentos() {
  const select = document.getElementById("zona-departamento-input");
  try {
    const departamentos = await apiFetch("/ubigeo/departamentos");
    select.innerHTML =
      `<option value="">— Elige un departamento —</option>` +
      departamentos.map((d) => `<option value="${d}">${d}</option>`).join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error: ${err.message}</option>`;
    console.error("Error al cargar departamentos:", err.message);
  }
}

async function cargarProvincias(departamento) {
  const select = document.getElementById("zona-provincia-input");
  select.disabled = true;
  select.innerHTML = `<option value="">Cargando...</option>`;
  if (!departamento) {
    select.innerHTML = `<option value="">— Elige un departamento primero —</option>`;
    return;
  }
  try {
    const provincias = await apiFetch(`/ubigeo/provincias?departamento=${encodeURIComponent(departamento)}`);
    select.innerHTML =
      `<option value="">— Elige una provincia —</option>` +
      provincias.map((p) => `<option value="${p}">${p}</option>`).join("");
    select.disabled = false;
  } catch (err) {
    select.innerHTML = `<option value="">Error: ${err.message}</option>`;
    console.error("Error al cargar provincias:", err.message);
  }
}

async function cargarDistritos(departamento, provincia) {
  const select = document.getElementById("zona-distrito-input");
  select.disabled = true;
  select.innerHTML = `<option value="">Cargando...</option>`;
  if (!departamento || !provincia) {
    select.innerHTML = `<option value="">— Elige una provincia primero —</option>`;
    return;
  }
  try {
    const distritos = await apiFetch(
      `/ubigeo/distritos?departamento=${encodeURIComponent(departamento)}&provincia=${encodeURIComponent(provincia)}`
    );
    select.innerHTML =
      `<option value="">— Elige un distrito —</option>` +
      distritos.map((d) => `<option value="${d}">${d}</option>`).join("");
    select.disabled = false;
  } catch (err) {
    select.innerHTML = `<option value="">Error: ${err.message}</option>`;
    console.error("Error al cargar distritos:", err.message);
  }
}

document.getElementById("zona-departamento-input").addEventListener("change", (e) => {
  cargarProvincias(e.target.value);
  document.getElementById("zona-distrito-input").innerHTML = `<option value="">— Elige una provincia primero —</option>`;
  document.getElementById("zona-distrito-input").disabled = true;
});
document.getElementById("zona-provincia-input").addEventListener("change", (e) => {
  const departamento = document.getElementById("zona-departamento-input").value;
  cargarDistritos(departamento, e.target.value);
});

function abrirModalNuevaZona() {
  formZona.reset();
  document.getElementById("zona-id").value = "";
  document.getElementById("modal-zona-titulo").textContent = "Nueva zona";
  document.getElementById("zona-mensaje").textContent = "";
  cargarDepartamentos();
  document.getElementById("zona-provincia-input").innerHTML = `<option value="">— Elige un departamento primero —</option>`;
  document.getElementById("zona-provincia-input").disabled = true;
  document.getElementById("zona-distrito-input").innerHTML = `<option value="">— Elige una provincia primero —</option>`;
  document.getElementById("zona-distrito-input").disabled = true;
  modalZona.classList.remove("oculto");
}

async function abrirModalEditarZona(zona) {
  document.getElementById("zona-id").value = zona.id;
  document.getElementById("zona-nombre-input").value = zona.nombre;
  document.getElementById("modal-zona-titulo").textContent = `Editar: ${zona.nombre}`;
  document.getElementById("zona-mensaje").textContent = "";

  const selectDep = document.getElementById("zona-departamento-input");
  const selectProv = document.getElementById("zona-provincia-input");
  const selectDist = document.getElementById("zona-distrito-input");

  // El distrito SI se puede editar: los leads ya asignados quedan ligados
  // a la zona por su ID, no por el texto del distrito, asi que cambiarlo
  // no rompe nada existente -- solo afecta el emparejamiento de proximas cargas.
  selectDep.disabled = false;
  selectProv.disabled = false;
  selectDist.disabled = false;

  await cargarDepartamentos();

  try {
    const ubicacion = await apiFetch(`/ubigeo/buscar-por-distrito?distrito=${encodeURIComponent(zona.distrito)}`);

    selectDep.value = ubicacion.departamento;
    await cargarProvincias(ubicacion.departamento);

    selectProv.value = ubicacion.provincia;
    await cargarDistritos(ubicacion.departamento, ubicacion.provincia);

    selectDist.value = ubicacion.distrito;
  } catch (err) {
    // Si el distrito guardado no coincide exactamente con el ubigeo (ej. se
    // escribio a mano antes de tener este selector), dejamos los selectores
    // vacios y listos para que el admin elija de nuevo sin bloquear el modal.
    console.warn("No se pudo pre-seleccionar la ubicación actual de la zona:", err.message);
  }

  modalZona.classList.remove("oculto");
}

document.getElementById("btn-nueva-zona").addEventListener("click", abrirModalNuevaZona);
document.getElementById("btn-cancelar-zona").addEventListener("click", () => {
  modalZona.classList.add("oculto");
});

formZona.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("zona-mensaje");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  const id = document.getElementById("zona-id").value;
  const payload = {
    nombre: document.getElementById("zona-nombre-input").value,
    distrito: document.getElementById("zona-distrito-input").value,
  };

  try {
    if (id) {
      await apiFetch(`/zonas/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/zonas", { method: "POST", body: JSON.stringify(payload) });
    }
    modalZona.classList.add("oculto");
    cargarZonas();
    cargarZonasEnSelectores(); // refresca los selects de reparto/usuarios tambien
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

async function toggleActivoZona(id, activo, checkboxEl) {
  try {
    await apiFetch(`/zonas/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activo: activo ? 1 : 0 }),
    });
    cargarZonasEnSelectores();
  } catch (err) {
    checkboxEl.checked = !activo;
    alert(`Error: ${err.message}`);
  }
}

async function eliminarZonaConfirmar(id, btnEl) {
  const fila = btnEl.closest("tr");
  const nombre = fila.children[0].textContent;
  if (!confirm(`¿Eliminar la zona "${nombre}"? Esta acción no se puede deshacer.`)) return;

  try {
    await apiFetch(`/zonas/${id}`, { method: "DELETE" });
    cargarZonas();
    cargarZonasEnSelectores();
  } catch (err) {
    alert(`No se pudo eliminar: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// HISTORIAL DE VISITAS (ADMIN)
// ---------------------------------------------------------------------
let paginaVisitasActual = 1;
let filtrosVisitasInicializados = false;

async function cargarPantallaVisitas() {
  if (!filtrosVisitasInicializados) {
    await inicializarFiltrosVisitas();
    filtrosVisitasInicializados = true;
  }
  paginaVisitasActual = 1;
  cargarVisitas();
}

async function inicializarFiltrosVisitas() {
  try {
    const [usuarios, zonas] = await Promise.all([
      apiFetch("/usuarios?rol=vendedor"),
      apiFetch("/zonas"),
    ]);

    document.getElementById("filtro-visitas-vendedor").innerHTML =
      `<option value="">Todos los vendedores</option>` +
      usuarios.map((u) => `<option value="${u.id}">${u.nombre}</option>`).join("");

    document.getElementById("filtro-visitas-zona").innerHTML =
      `<option value="">Todas las zonas</option>` +
      zonas.map((z) => `<option value="${z.id}">${z.nombre}</option>`).join("");
  } catch (err) {
    console.error("Error al cargar filtros de visitas:", err.message);
  }
}

function construirQueryVisitas() {
  const params = new URLSearchParams();
  const vendedor = document.getElementById("filtro-visitas-vendedor").value;
  const zona = document.getElementById("filtro-visitas-zona").value;
  const resultado = document.getElementById("filtro-visitas-resultado").value;
  const desde = document.getElementById("filtro-visitas-desde").value;
  const hasta = document.getElementById("filtro-visitas-hasta").value;

  if (vendedor) params.set("vendedor_id", vendedor);
  if (zona) params.set("zona_id", zona);
  if (resultado) params.set("resultado", resultado);
  if (desde) params.set("fecha_desde", desde);
  if (hasta) params.set("fecha_hasta", hasta);
  params.set("page", paginaVisitasActual);
  params.set("limit", 25);

  return params.toString();
}

async function cargarVisitas() {
  const tbody = document.getElementById("tabla-visitas");
  try {
    const query = construirQueryVisitas();
    const data = await apiFetch(`/visitas/admin?${query}`);

    if (data.resultados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);">No hay visitas que coincidan con estos filtros.</td></tr>`;
    } else {
      tbody.innerHTML = data.resultados
        .map(
          (v) => `
          <tr>
            <td>${new Date(v.fecha).toLocaleString("es-PE")}</td>
            <td>${v.vendedor}</td>
            <td>${v.cliente}</td>
            <td>${v.zona || "—"}</td>
            <td><span class="badge ${v.resultado}">${v.resultado.replace("_", " ")}</span></td>
            <td>${v.producto || "—"}</td>
            <td>${v.monto ? formatoMoneda(v.monto) : "—"}</td>
          </tr>`
        )
        .join("");
    }

    const totalPaginas = Math.max(1, Math.ceil(data.total / data.limit));
    document.getElementById("info-paginacion").textContent =
      `Página ${data.page} de ${totalPaginas} — ${data.total} visitas en total`;
    document.getElementById("btn-pagina-anterior").disabled = data.page <= 1;
    document.getElementById("btn-pagina-siguiente").disabled = data.page >= totalPaginas;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">Error al cargar el historial: ${err.message}</td></tr>`;
  }
}

document.getElementById("btn-refrescar-visitas").addEventListener("click", () => {
  paginaVisitasActual = 1;
  cargarVisitas();
});
document.getElementById("btn-aplicar-filtros-visitas").addEventListener("click", () => {
  paginaVisitasActual = 1;
  cargarVisitas();
});
document.getElementById("btn-pagina-anterior").addEventListener("click", () => {
  if (paginaVisitasActual > 1) {
    paginaVisitasActual--;
    cargarVisitas();
  }
});
document.getElementById("btn-pagina-siguiente").addEventListener("click", () => {
  paginaVisitasActual++;
  cargarVisitas();
});

// ---------------------------------------------------------------------
// PERMISOS DE SUPERVISOR
// ---------------------------------------------------------------------
const modalPermiso = document.getElementById("modal-permiso");
const formPermiso = document.getElementById("form-permiso");

async function cargarPermisos() {
  const tbody = document.getElementById("tabla-permisos");
  try {
    const permisos = await apiFetch("/permisos-supervisor");

    if (permisos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);">Aún no se ha otorgado ningún permiso.</td></tr>`;
      return;
    }

    tbody.innerHTML = permisos
      .map(
        (p) => `
        <tr>
          <td>${p.supervisor}</td>
          <td>${p.zona ? `Zona: ${p.zona}` : `Vendedor: ${p.vendedor}`}</td>
          <td>${p.puede_ver_kpis ? "Sí" : "No"}</td>
          <td>${p.puede_ver_ubicacion ? "Sí" : "No"}</td>
          <td>${p.otorgado_por || "—"}</td>
          <td>
            <button class="btn-icono" data-accion="editar" data-id="${p.id}" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn-icono peligro" data-accion="revocar" data-id="${p.id}" title="Revocar" aria-label="Revocar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-accion='revocar']").forEach((btn) => {
      btn.addEventListener("click", () => revocarPermisoConfirmar(btn.dataset.id, btn));
    });
    tbody.querySelectorAll("[data-accion='editar']").forEach((btn) => {
      const permiso = permisos.find((p) => String(p.id) === btn.dataset.id);
      btn.addEventListener("click", () => abrirModalPermiso(permiso));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Error al cargar permisos: ${err.message}</td></tr>`;
  }
}

async function abrirModalPermiso(permisoExistente) {
  formPermiso.reset();
  document.getElementById("permiso-mensaje").textContent = "";
  document.getElementById("campo-permiso-zona").classList.remove("oculto");
  document.getElementById("campo-permiso-vendedor").classList.add("oculto");

  // Modo edición: guardamos el id en el form y bloqueamos el cambio de supervisor
  // (el supervisor titular del permiso no cambia; lo que se corrige es su alcance).
  formPermiso.dataset.editandoId = permisoExistente ? permisoExistente.id : "";

  const modalTitulo = document.querySelector("#modal-permiso h3");
  const botonSubmit = formPermiso.querySelector("button[type='submit']");
  const selectSup = document.getElementById("permiso-supervisor-input");
  const selectZona = document.getElementById("permiso-zona-input");
  const selectVendedor = document.getElementById("permiso-vendedor-input");
  const selectAlcance = document.getElementById("permiso-alcance-tipo");

  if (modalTitulo) modalTitulo.textContent = permisoExistente ? "Editar permiso" : "Otorgar permiso";
  if (botonSubmit) botonSubmit.textContent = permisoExistente ? "Guardar cambios" : "Otorgar";

  selectSup.innerHTML = `<option value="">Cargando...</option>`;
  selectZona.innerHTML = `<option value="">Cargando...</option>`;
  selectVendedor.innerHTML = `<option value="">Cargando...</option>`;

  modalPermiso.classList.remove("oculto");

  try {
    const [supervisores, zonas, vendedores] = await Promise.all([
      apiFetch("/usuarios?rol=supervisor"),
      apiFetch("/zonas"),
      apiFetch("/usuarios?rol=vendedor"),
    ]);

    selectSup.innerHTML = supervisores.length
      ? supervisores.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join("")
      : `<option value="">No hay supervisores creados — crea uno primero en Usuarios</option>`;

    selectZona.innerHTML = zonas.map((z) => `<option value="${z.id}">${z.nombre}</option>`).join("");
    selectVendedor.innerHTML = vendedores.map((v) => `<option value="${v.id}">${v.nombre}</option>`).join("");

    if (permisoExistente) {
      selectSup.value = permisoExistente.supervisor_id;
      selectSup.disabled = true;

      const esVendedor = !!permisoExistente.vendedor_id;
      selectAlcance.value = esVendedor ? "vendedor" : "zona";
      document.getElementById("campo-permiso-zona").classList.toggle("oculto", esVendedor);
      document.getElementById("campo-permiso-vendedor").classList.toggle("oculto", !esVendedor);
      if (esVendedor) selectVendedor.value = permisoExistente.vendedor_id;
      else selectZona.value = permisoExistente.zona_id;

      document.getElementById("permiso-kpis-input").checked = !!permisoExistente.puede_ver_kpis;
      document.getElementById("permiso-ubicacion-input").checked = !!permisoExistente.puede_ver_ubicacion;
    } else {
      selectSup.disabled = false;
    }
  } catch (err) {
    console.error("Error al preparar el formulario de permisos:", err.message);
  }
}

document.getElementById("btn-nuevo-permiso").addEventListener("click", () => abrirModalPermiso());
document.getElementById("btn-cancelar-permiso").addEventListener("click", () => {
  modalPermiso.classList.add("oculto");
  document.getElementById("permiso-supervisor-input").disabled = false;
});

document.getElementById("permiso-alcance-tipo").addEventListener("change", (e) => {
  const esZona = e.target.value === "zona";
  document.getElementById("campo-permiso-zona").classList.toggle("oculto", !esZona);
  document.getElementById("campo-permiso-vendedor").classList.toggle("oculto", esZona);
});

formPermiso.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("permiso-mensaje");
  mensaje.textContent = "";
  mensaje.classList.remove("error");

  const esZona = document.getElementById("permiso-alcance-tipo").value === "zona";
  const editandoId = formPermiso.dataset.editandoId;
  const payload = {
    supervisor_id: document.getElementById("permiso-supervisor-input").value,
    zona_id: esZona ? document.getElementById("permiso-zona-input").value : null,
    vendedor_id: esZona ? null : document.getElementById("permiso-vendedor-input").value,
    puede_ver_kpis: document.getElementById("permiso-kpis-input").checked,
    puede_ver_ubicacion: document.getElementById("permiso-ubicacion-input").checked,
  };

  try {
    if (editandoId) {
      // En edición no se reenvía supervisor_id (el backend no lo usa en el PUT).
      await apiFetch(`/permisos-supervisor/${editandoId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/permisos-supervisor", { method: "POST", body: JSON.stringify(payload) });
    }
    modalPermiso.classList.add("oculto");
    cargarPermisos();
  } catch (err) {
    mensaje.textContent = err.message;
    mensaje.classList.add("error");
  }
});

async function revocarPermisoConfirmar(id, btnEl) {
  const fila = btnEl.closest("tr");
  const descripcion = `${fila.children[0].textContent} sobre ${fila.children[1].textContent}`;
  if (!confirm(`¿Revocar el permiso de ${descripcion}?`)) return;

  try {
    await apiFetch(`/permisos-supervisor/${id}`, { method: "DELETE" });
    cargarPermisos();
  } catch (err) {
    alert(`No se pudo revocar: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// HISTORIAL DE UBICACION (CHECKPOINTS)
// ---------------------------------------------------------------------
let paginaUbicacionActual = 1;
let filtrosUbicacionInicializados = false;

async function cargarPantallaUbicacion() {
  if (!filtrosUbicacionInicializados) {
    await inicializarFiltrosUbicacion();
    filtrosUbicacionInicializados = true;
  }
  paginaUbicacionActual = 1;
  cargarUbicacion();
  iniciarMapaEnVivo();
}

async function inicializarFiltrosUbicacion() {
  try {
    const usuarios = await apiFetch("/usuarios?rol=vendedor");
    document.getElementById("filtro-ubicacion-vendedor").innerHTML =
      `<option value="">Todos los vendedores</option>` +
      usuarios.map((u) => `<option value="${u.id}">${u.nombre}</option>`).join("");
    usuarios.forEach((u) => { nombresVendedores[u.id] = u.nombre; });
  } catch (err) {
    console.error("Error al cargar filtros de ubicación:", err.message);
  }
}

async function cargarUbicacion() {
  const tbody = document.getElementById("tabla-ubicacion");
  try {
    const params = new URLSearchParams();
    const vendedor = document.getElementById("filtro-ubicacion-vendedor").value;
    const tipo = document.getElementById("filtro-ubicacion-tipo").value;
    const fecha = document.getElementById("filtro-ubicacion-fecha").value;
    if (vendedor) params.set("vendedor_id", vendedor);
    if (tipo) params.set("tipo_evento", tipo);
    if (fecha) params.set("fecha", fecha);
    params.set("page", paginaUbicacionActual);
    params.set("limit", 50);

    const data = await apiFetch(`/checkpoints?${params.toString()}`);

    if (data.resultados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);">No hay registros de ubicación con estos filtros.</td></tr>`;
    } else {
      tbody.innerHTML = data.resultados
        .map(
          (c) => `
          <tr>
            <td>${new Date(c.hora).toLocaleString("es-PE")}</td>
            <td>${c.vendedor}</td>
            <td><span class="badge ${c.tipo_evento}">${c.tipo_evento.replace("_", " ")}</span></td>
            <td>${c.cliente || "—"}</td>
            <td>${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}</td>
            <td><a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="enlace-accion">Ver en mapa</a></td>
          </tr>`
        )
        .join("");
    }

    const totalPaginas = Math.max(1, Math.ceil(data.total / data.limit));
    document.getElementById("info-paginacion-ubicacion").textContent =
      `Página ${data.page} de ${totalPaginas} — ${data.total} registros`;
    document.getElementById("btn-ubicacion-pagina-anterior").disabled = data.page <= 1;
    document.getElementById("btn-ubicacion-pagina-siguiente").disabled = data.page >= totalPaginas;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">${err.message}</td></tr>`;
  }
}

document.getElementById("btn-refrescar-ubicacion").addEventListener("click", () => {
  paginaUbicacionActual = 1;
  cargarUbicacion();
});
document.getElementById("btn-aplicar-filtros-ubicacion").addEventListener("click", () => {
  paginaUbicacionActual = 1;
  cargarUbicacion();
});
document.getElementById("btn-ubicacion-pagina-anterior").addEventListener("click", () => {
  if (paginaUbicacionActual > 1) {
    paginaUbicacionActual--;
    cargarUbicacion();
  }
});
document.getElementById("btn-ubicacion-pagina-siguiente").addEventListener("click", () => {
  paginaUbicacionActual++;
  cargarUbicacion();
});

// ---------------------------------------------------------------------
// MAPA EN VIVO (heartbeat de ubicación) — dentro del panel de ubicación
// ---------------------------------------------------------------------
let mapaVivo = null;
let mapaVivoInicializado = false;
let marcadoresVivo = {}; // vendedor_id -> L.CircleMarker
let ubicacionesVivo = {}; // vendedor_id -> { nombre, lat, lng, hora }
let nombresVendedores = {}; // vendedor_id -> nombre (se llena en inicializarFiltrosUbicacion)
let barridoVivoIniciado = false;

const CENTRO_MAPA_DEFECTO = [-12.0464, -77.0428]; // Lima, Perú
const MINUTOS_INACTIVO_VIVO = 5; // pasado esto sin heartbeat, se retira del mapa

async function iniciarMapaEnVivo() {
  if (!mapaVivoInicializado) {
    mapaVivo = L.map("mapa-ubicacion-vivo").setView(CENTRO_MAPA_DEFECTO, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(mapaVivo);
    mapaVivoInicializado = true;
    iniciarBarridoVivo();
  } else {
    // El contenedor estuvo oculto (otro panel activo); Leaflet necesita
    // recalcular su tamaño al volver a mostrarse o el mapa se ve cortado.
    setTimeout(() => mapaVivo.invalidateSize(), 0);
  }

  const estadoEl = document.getElementById("mapa-vivo-estado");
  try {
    const data = await apiFetch("/ubicacion/en-vivo");
    data.resultados.forEach((item) => {
      actualizarPosicionVivo({
        vendedor_id: item.vendedor_id,
        nombre: item.vendedor,
        lat: Number(item.lat),
        lng: Number(item.lng),
        hora: item.hora,
      });
    });
    refrescarPanelVivo();
  } catch (err) {
    // Un supervisor sin permiso de ubicación otorgado recibe 403 — se
    // muestra el mensaje del backend en vez de una tabla vacía confusa.
    estadoEl.textContent = err.message;
  }
}

// Alimentado tanto por la carga inicial (GET /ubicacion/en-vivo) como por
// cada evento 'ubicacion:heartbeat' que llega por socket en tiempo real.
function actualizarPosicionVivo({ vendedor_id, nombre, lat, lng, hora }) {
  const nombreFinal = nombre || nombresVendedores[vendedor_id] || `Vendedor #${vendedor_id}`;
  ubicacionesVivo[vendedor_id] = { nombre: nombreFinal, lat, lng, hora };

  if (!mapaVivo) return; // aun no se abrio el panel de ubicación esta sesión

  const popup = `<b>${nombreFinal}</b><br>${new Date(hora).toLocaleTimeString("es-PE")}`;
  if (marcadoresVivo[vendedor_id]) {
    marcadoresVivo[vendedor_id].setLatLng([lat, lng]).setPopupContent(popup);
  } else {
    marcadoresVivo[vendedor_id] = L.circleMarker([lat, lng], {
      radius: 8,
      color: "#2b7a78",
      fillColor: "#2b7a78",
      fillOpacity: 0.85,
      weight: 2,
    })
      .addTo(mapaVivo)
      .bindPopup(popup);
  }
}

function refrescarPanelVivo() {
  const total = Object.keys(ubicacionesVivo).length;
  const punto = document.getElementById("mapa-vivo-punto");
  const estado = document.getElementById("mapa-vivo-estado");
  const lista = document.getElementById("lista-vivo");

  punto.classList.toggle("activo", total > 0);
  estado.textContent = total > 0
    ? `${total} vendedor${total === 1 ? "" : "es"} en línea`
    : "Sin vendedores conectados ahora mismo";

  if (total === 0) {
    lista.innerHTML = `<span class="lista-vivo-vacio">Aparecerán aquí cuando un vendedor con jornada activa envíe su ubicación.</span>`;
    return;
  }

  lista.innerHTML = Object.entries(ubicacionesVivo)
    .map(([id, u]) => `
      <span class="lista-vivo-item">
        ${u.nombre}
        <span class="lista-vivo-hora">${tiempoRelativo(u.hora)}</span>
      </span>`)
    .join("");
}

function tiempoRelativo(fechaIso) {
  const segundos = Math.max(0, Math.round((Date.now() - new Date(fechaIso).getTime()) / 1000));
  if (segundos < 60) return `hace ${segundos}s`;
  const minutos = Math.round(segundos / 60);
  return `hace ${minutos} min`;
}

// Retira del mapa a quien no manda heartbeat hace rato (jornada cerrada,
// app cerrada, sin señal) para que el mapa no acumule posiciones muertas.
function iniciarBarridoVivo() {
  if (barridoVivoIniciado) return;
  barridoVivoIniciado = true;

  setInterval(() => {
    const limiteMs = MINUTOS_INACTIVO_VIVO * 60 * 1000;
    let huboCambios = false;

    Object.entries(ubicacionesVivo).forEach(([id, u]) => {
      if (Date.now() - new Date(u.hora).getTime() > limiteMs) {
        delete ubicacionesVivo[id];
        if (marcadoresVivo[id]) {
          mapaVivo.removeLayer(marcadoresVivo[id]);
          delete marcadoresVivo[id];
        }
        huboCambios = true;
      }
    });

    if (huboCambios) refrescarPanelVivo();
    else if (Object.keys(ubicacionesVivo).length > 0) {
      // Aunque nadie se haya caído, refresca los "hace Xs/min" de la lista.
      refrescarPanelVivo();
    }
  }, 30000);
}

// ---------------------------------------------------------------------
// REPORTES EXPORTABLES (CSV) — filtros compartidos por fecha y vendedor
// ---------------------------------------------------------------------
let filtrosReportesInicializados = false;

async function cargarPantallaReportesExport() {
  if (!filtrosReportesInicializados) {
    await Promise.all([inicializarFiltroVendedorReportes(), inicializarFiltroBasesReportes()]);
    filtrosReportesInicializados = true;
  }
}

let reportesMultiSelectBases = null;

async function inicializarFiltroBasesReportes() {
  try {
    const cargas = await apiFetch("/leads/cargas");
    if (!reportesMultiSelectBases) reportesMultiSelectBases = crearMultiSelect("reportes-filtro-bases");
    reportesMultiSelectBases.setOpciones(cargas.map((c) => ({ value: String(c.id), label: `${c.nombre_archivo} (${c.total_registros})` })));
  } catch (err) {
    console.error("Error al cargar bases para reportes:", err.message);
  }
}

async function inicializarFiltroVendedorReportes() {
  try {
    const usuarios = await apiFetch("/usuarios?rol=vendedor");
    document.getElementById("reportes-filtro-vendedor").innerHTML =
      `<option value="">Todos los vendedores</option>` +
      usuarios.map((u) => `<option value="${u.id}">${u.nombre}</option>`).join("");
  } catch (err) {
    console.error("Error al cargar vendedores para reportes:", err.message);
  }
}

document.querySelectorAll(".btn-exportar").forEach((btn) => {
  btn.addEventListener("click", () => descargarReporteCsv(btn));
});

/**
 * Descarga un reporte CSV con los filtros actuales. No se puede usar un
 * <a href> simple porque el endpoint requiere el token en el header
 * Authorization — se pide el archivo por fetch, se recibe como blob, y
 * se dispara la descarga con un <a> temporal.
 */
async function descargarReporteCsv(btn) {
  const tipo = btn.dataset.reporte;
  const textoOriginal = btn.textContent;

  const params = new URLSearchParams();
  const desde = document.getElementById("reportes-filtro-desde").value;
  const hasta = document.getElementById("reportes-filtro-hasta").value;
  const vendedorId = document.getElementById("reportes-filtro-vendedor").value;
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (vendedorId) params.set("vendedor_id", vendedorId);

  if (tipo === "ventas" || tipo === "base-leads") {
    const basesSeleccionadas = reportesMultiSelectBases ? reportesMultiSelectBases.getSeleccionados() : [];
    if (basesSeleccionadas.length > 0) params.set("base_ids", basesSeleccionadas.join(","));
  }

  btn.disabled = true;
  btn.textContent = "Generando…";

  try {
    const res = await fetch(`${API_URL}/reportes/${tipo}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "No se pudo generar el reporte");
    }

    const blob = await res.blob();
    const nombreArchivo =
      res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `${tipo}.csv`;

    const urlTemporal = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = urlTemporal;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(urlTemporal);
  } catch (err) {
    alert(`Error al exportar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------------------------------------------------------------------
// CORREGIR JORNADAS (admin) -- ingreso/salida marcados por error
// ---------------------------------------------------------------------
let filtrosJornadasInicializados = false;

async function cargarPantallaJornadasAdmin() {
  if (!filtrosJornadasInicializados) {
    try {
      const usuarios = await apiFetch("/usuarios?rol=vendedor");
      document.getElementById("jor-filtro-vendedor").innerHTML =
        `<option value="">Todos los vendedores</option>` +
        usuarios.map((u) => `<option value="${u.id}">${u.nombre}</option>`).join("");
    } catch (err) {
      console.error("Error al cargar vendedores para jornadas:", err.message);
    }
    filtrosJornadasInicializados = true;
  }
  cargarTablaJornadas();
}

document.getElementById("btn-jor-filtrar").addEventListener("click", cargarTablaJornadas);

/** "2026-08-09 14:32:10" (MySQL) -> "14:32" solo hora, para la tabla. */
function soloHora(fechaHoraMysql) {
  if (!fechaHoraMysql) return "—";
  return fechaHoraMysql.slice(11, 16);
}

/** minutos -> "7h 32m", igual criterio visual que el resto del panel. */
function formatoDuracionMin(minutos) {
  if (minutos === null || minutos === undefined) return "En curso";
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return `${h}h ${m}m`;
}

/** "2026-08-09 14:32:10" (MySQL) -> "2026-08-09T14:32" (input datetime-local). */
function mysqlADatetimeLocal(fechaHoraMysql) {
  if (!fechaHoraMysql) return "";
  return fechaHoraMysql.slice(0, 16).replace(" ", "T");
}

/** "2026-08-09T14:32" (input datetime-local) -> "2026-08-09 14:32:00" (MySQL). */
function datetimeLocalAMysql(valor) {
  if (!valor) return null;
  return valor.replace("T", " ") + ":00";
}

async function cargarTablaJornadas() {
  const params = new URLSearchParams();
  const vendedorId = document.getElementById("jor-filtro-vendedor").value;
  const desde = document.getElementById("jor-filtro-desde").value;
  const hasta = document.getElementById("jor-filtro-hasta").value;
  if (vendedorId) params.set("vendedor_id", vendedorId);
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  const tbody = document.getElementById("tabla-jornadas-admin");
  try {
    const jornadas = await apiFetch(`/jornada/admin?${params.toString()}`);
    tbody.innerHTML =
      jornadas
        .map(
          (j) => `
      <tr data-jornada='${JSON.stringify(j).replace(/'/g, "&apos;")}'>
        <td>${j.fecha}</td>
        <td>${j.vendedor}</td>
        <td>${soloHora(j.hora_ingreso)}</td>
        <td>${j.hora_salida ? soloHora(j.hora_salida) : "En curso"}</td>
        <td>${formatoDuracionMin(j.tiempo_activo_total)}</td>
        <td>${j.total_pausas}</td>
        <td>${j.editado_por ? `<span class="badge editado">Editado por ${j.editado_por}</span>` : "—"}</td>
        <td>
          <button class="btn-icono btn-editar-jornada" title="Corregir">✏️</button>
          ${j.hora_salida ? `<button class="btn-icono btn-reabrir-jornada" title="Reabrir (deshacer marcar salida)">↺</button>` : ""}
        </td>
      </tr>`
        )
        .join("") || `<tr><td colspan="8">Sin jornadas para este filtro</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8">Error al cargar: ${err.message}</td></tr>`;
  }
}

document.getElementById("tabla-jornadas-admin").addEventListener("click", async (e) => {
  const fila = e.target.closest("tr");
  if (!fila) return;
  const jornada = JSON.parse(fila.dataset.jornada.replace(/&apos;/g, "'"));

  if (e.target.classList.contains("btn-editar-jornada")) {
    abrirModalJornada(jornada);
  }

  if (e.target.classList.contains("btn-reabrir-jornada")) {
    if (!confirm(`¿Reabrir la jornada de ${jornada.vendedor} del ${jornada.fecha}? Se borrará la hora de salida.`)) return;
    try {
      await apiFetch(`/jornada/admin/${jornada.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hora_salida: null }),
      });
      cargarTablaJornadas();
    } catch (err) {
      alert(`Error al reabrir: ${err.message}`);
    }
  }
});

function abrirModalJornada(jornada) {
  document.getElementById("jor-id").value = jornada.id;
  document.getElementById("jor-modal-contexto").textContent = `${jornada.vendedor} — ${jornada.fecha}`;
  document.getElementById("jor-ingreso-input").value = mysqlADatetimeLocal(jornada.hora_ingreso);
  document.getElementById("jor-salida-input").value = mysqlADatetimeLocal(jornada.hora_salida);
  document.getElementById("jor-reabrir-check").checked = false;
  document.getElementById("jor-mensaje").textContent = "";
  document.getElementById("modal-jornada").classList.remove("oculto");
}

document.getElementById("btn-cancelar-jornada").addEventListener("click", () => {
  document.getElementById("modal-jornada").classList.add("oculto");
});

document.getElementById("jor-reabrir-check").addEventListener("change", (e) => {
  document.getElementById("jor-salida-input").disabled = e.target.checked;
});

document.getElementById("form-jornada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("jor-id").value;
  const reabrir = document.getElementById("jor-reabrir-check").checked;
  const mensajeEl = document.getElementById("jor-mensaje");

  const body = {
    hora_ingreso: datetimeLocalAMysql(document.getElementById("jor-ingreso-input").value),
    hora_salida: reabrir ? null : datetimeLocalAMysql(document.getElementById("jor-salida-input").value),
  };

  try {
    await apiFetch(`/jornada/admin/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    document.getElementById("modal-jornada").classList.add("oculto");
    cargarTablaJornadas();
  } catch (err) {
    mensajeEl.textContent = err.message;
    mensajeEl.classList.add("error");
  }
});

// ---------------------------------------------------------------------
// NOTIFICACIONES: campana con contador + toast en vivo via Socket.IO
// ---------------------------------------------------------------------
let conteoNotificacionesNoLeidas = 0;
let socketNotificaciones = null;

// El backend sirve la API en /api sobre este mismo host:puerto -- el socket
// se conecta directo a la raiz (sin /api), que es donde Socket.IO escucha.
const SOCKET_URL = API_URL.replace(/\/api\/?$/, "");

function iniciarSocketNotificaciones() {
  if (socketNotificaciones) return; // evita conexiones duplicadas

  cargarConteoInicialNotificaciones();

  try {
    if (typeof io === "undefined") {
      console.error("La librería de Socket.IO no cargó (revisa tu conexión a internet o el bloqueo de CDN).");
      return;
    }

    socketNotificaciones = io(SOCKET_URL, { transports: ["websocket", "polling"] });

    socketNotificaciones.on("connect", () => {
      console.log("Conectado al servidor de notificaciones en vivo");
      // Misma conexión sirve para el mapa en vivo del panel de ubicación,
      // en vez de abrir un segundo socket solo para eso.
      socketNotificaciones.emit("join_monitoreo");
    });

    socketNotificaciones.on("ubicacion:heartbeat", (data) => {
      actualizarPosicionVivo(data);
      refrescarPanelVivo();
    });

    socketNotificaciones.on("alerta_vendedor", (data) => {
      conteoNotificacionesNoLeidas++;
      actualizarBadgeNotificaciones(conteoNotificacionesNoLeidas);
      mostrarToastNotificacion(data);
    });

    socketNotificaciones.on("disconnect", () => {
      console.log("Desconectado del servidor de notificaciones en vivo");
    });

    socketNotificaciones.on("connect_error", (err) => {
      console.error("Error al conectar al socket de notificaciones:", err.message);
    });
  } catch (err) {
    console.error("No se pudo iniciar el socket de notificaciones:", err.message);
  }
}

function detenerSocketNotificaciones() {
  if (socketNotificaciones) {
    socketNotificaciones.disconnect();
    socketNotificaciones = null;
  }
}

async function cargarConteoInicialNotificaciones() {
  try {
    const data = await apiFetch("/notificaciones/no-leidas");
    conteoNotificacionesNoLeidas = data.total;
    actualizarBadgeNotificaciones(conteoNotificacionesNoLeidas);
  } catch (err) {
    console.error("Error al cargar conteo de notificaciones:", err.message);
  }
}

function actualizarBadgeNotificaciones(total) {
  const badge = document.getElementById("notif-badge");
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : total;
    badge.classList.remove("oculto");
  } else {
    badge.classList.add("oculto");
  }
}

function tituloParaTipo(tipo) {
  const titulos = { venta: "¡Nueva venta!", venta_cerrada: "¡Nueva venta!", sistema: "Aviso del sistema" };
  return titulos[tipo] || "Notificación";
}

function mostrarToastNotificacion(data) {
  const contenedor = document.getElementById("notif-toast-contenedor");
  const toast = document.createElement("div");
  toast.className = "notif-toast";
  const titulo = data.titulo || tituloParaTipo(data.tipo);
  toast.innerHTML = `
    <div class="notif-toast-icono">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="m4.9 10.1 4.2 1.4"/><path d="m19.1 10.1-4.2 1.4"/><circle cx="12" cy="16" r="6"/></svg>
    </div>
    <div class="notif-toast-texto">
      <p class="notif-toast-titulo">${titulo}</p>
      <p class="notif-toast-mensaje">${data.mensaje}</p>
    </div>`;
  contenedor.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Desplegable de la campana
const notifDropdown = document.getElementById("notif-dropdown");
document.getElementById("notif-campana-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  const abriendo = notifDropdown.classList.contains("oculto");
  notifDropdown.classList.toggle("oculto");
  if (abriendo) {
    await cargarListaNotificaciones();
    try {
      await apiFetch("/notificaciones/marcar-leidas", { method: "PATCH" });
      conteoNotificacionesNoLeidas = 0;
      actualizarBadgeNotificaciones(0);
    } catch (err) {
      console.error("Error al marcar notificaciones como leídas:", err.message);
    }
  }
});

document.addEventListener("click", (e) => {
  if (!document.getElementById("notif-campana-wrap").contains(e.target)) {
    notifDropdown.classList.add("oculto");
  }
});

async function cargarListaNotificaciones() {
  const lista = document.getElementById("notif-lista");
  lista.innerHTML = `<p class="notif-vacio">Cargando...</p>`;
  try {
    const notificaciones = await apiFetch("/notificaciones?limit=20");
    if (notificaciones.length === 0) {
      lista.innerHTML = `<p class="notif-vacio">Sin notificaciones todavía.</p>`;
      return;
    }
    lista.innerHTML = notificaciones
      .map(
        (n) => `
        <div class="notif-item ${n.leida ? "" : "no-leida"}">
          <p class="notif-titulo">${tituloParaTipo(n.tipo)}</p>
          <p class="notif-mensaje">${n.mensaje}</p>
          <p class="notif-hora">${new Date(n.creado_en).toLocaleString("es-PE")}</p>
        </div>`
      )
      .join("");
  } catch (err) {
    lista.innerHTML = `<p class="notif-vacio">Error al cargar: ${err.message}</p>`;
  }
}

// ---------------------------------------------------------------------
// AUTO-LOGIN: se ejecuta AL FINAL, cuando ya todos los listeners de la
// UI (menu, modales, botones) quedaron registrados. Asi, si algo falla
// aqui adentro (ej. el socket de notificaciones), no bloquea el resto
// del panel -- por eso ya no esta arriba del archivo.
// ---------------------------------------------------------------------
if (token && usuario) {
  mostrarApp();
}

const pool = require("../config/db");
const { enviarCsv } = require("../utils/csv");

/**
 * Todos los reportes comparten el mismo par de filtros opcionales:
 *   ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedor_id=123
 *
 * Se centraliza aquí la construcción de la condición SQL + sus valores
 * para no repetir la misma lógica de validación en las 5 funciones.
 *
 * @param {string} columnaFecha Columna (con alias de tabla) a la que aplica el rango de fechas.
 * @param {string} columnaVendedor Columna (con alias de tabla) a la que aplica el filtro de vendedor.
 */
function construirFiltros(req, columnaFecha, columnaVendedor) {
  const condiciones = [];
  const valores = [];

  const { desde, hasta, vendedor_id } = req.query;

  if (desde) {
    condiciones.push(`DATE(${columnaFecha}) >= ?`);
    valores.push(desde);
  }
  if (hasta) {
    condiciones.push(`DATE(${columnaFecha}) <= ?`);
    valores.push(hasta);
  }
  if (vendedor_id) {
    condiciones.push(`${columnaVendedor} = ?`);
    valores.push(vendedor_id);
  }

  const sql = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  return { sql, valores };
}

function nombreConFecha(base) {
  const hoy = new Date().toISOString().slice(0, 10);
  return `${base}_${hoy}.csv`;
}

/**
 * Reporte de ventas cerradas: quién vendió, a quién, qué producto y por
 * cuánto, con la zona de origen del lead.
 */
async function exportarVentas(req, res) {
  try {
    const { sql, valores } = construirFiltros(req, "v.fecha", "vi.vendedor_id");

    const [filas] = await pool.query(
      `SELECT v.fecha, u.nombre AS vendedor, lb.nombre AS cliente, lb.telefono,
              lb.direccion, z.nombre AS zona, v.producto, v.monto
       FROM ventas v
       JOIN visitas vi ON vi.id = v.visita_id
       JOIN usuarios u ON u.id = vi.vendedor_id
       JOIN leads l ON l.id = vi.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN zonas z ON z.id = l.zona_id
       ${sql}
       ORDER BY v.fecha DESC`,
      valores
    );

    enviarCsv(res, nombreConFecha("ventas"), [
      { clave: "fecha", titulo: "Fecha" },
      { clave: "vendedor", titulo: "Vendedor" },
      { clave: "cliente", titulo: "Cliente" },
      { clave: "telefono", titulo: "Teléfono" },
      { clave: "direccion", titulo: "Dirección" },
      { clave: "zona", titulo: "Zona" },
      { clave: "producto", titulo: "Producto" },
      { clave: "monto", titulo: "Monto" },
    ], filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar el reporte de ventas" });
  }
}

/**
 * Foto completa de la base de leads con su último resultado/interacción
 * (la visita más reciente registrada para cada lead, si tiene alguna).
 * El filtro de fecha aquí aplica sobre la fecha de esa última interacción
 * -- un lead sin visitas todavía no tiene fecha de interacción, así que
 * si se manda `desde`/`hasta` esos leads no van a salir en el CSV
 * (siguen apareciendo si no se manda ningún filtro de fecha).
 */
async function exportarBaseLeads(req, res) {
  try {
    const { sql, valores } = construirFiltros(req, "ultima.fecha", "l.vendedor_id");

    const [filas] = await pool.query(
      `SELECT lb.nombre AS cliente, lb.telefono, lb.direccion, lb.distrito,
              z.nombre AS zona, u.nombre AS vendedor_asignado, l.estado,
              ultima.resultado AS ultimo_resultado, ultima.fecha AS ultima_interaccion,
              ultima.notas
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN zonas z ON z.id = l.zona_id
       LEFT JOIN usuarios u ON u.id = l.vendedor_id
       LEFT JOIN (
         SELECT v1.lead_id, v1.resultado, v1.fecha, v1.notas
         FROM visitas v1
         INNER JOIN (
           SELECT lead_id, MAX(fecha) AS max_fecha FROM visitas GROUP BY lead_id
         ) v2 ON v2.lead_id = v1.lead_id AND v2.max_fecha = v1.fecha
       ) ultima ON ultima.lead_id = l.id
       ${sql}
       ORDER BY ultima.fecha DESC`,
      valores
    );

    enviarCsv(res, nombreConFecha("base_leads"), [
      { clave: "cliente", titulo: "Cliente" },
      { clave: "telefono", titulo: "Teléfono" },
      { clave: "direccion", titulo: "Dirección" },
      { clave: "distrito", titulo: "Distrito" },
      { clave: "zona", titulo: "Zona" },
      { clave: "vendedor_asignado", titulo: "Vendedor asignado" },
      { clave: "estado", titulo: "Estado del lead" },
      { clave: "ultimo_resultado", titulo: "Último resultado" },
      { clave: "ultima_interaccion", titulo: "Fecha de última interacción" },
      { clave: "notas", titulo: "Notas" },
    ], filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar la base de leads" });
  }
}

/**
 * Horas de conexión (jornada laboral): ingreso, salida y tiempo activo
 * total por vendedor y día.
 */
async function exportarConexion(req, res) {
  try {
    const { sql, valores } = construirFiltros(req, "j.fecha", "j.vendedor_id");

    const [filas] = await pool.query(
      `SELECT j.fecha, u.nombre AS vendedor, j.hora_ingreso, j.hora_salida,
              j.tiempo_activo_total AS minutos_activos,
              CONCAT(FLOOR(j.tiempo_activo_total / 60), 'h ', MOD(j.tiempo_activo_total, 60), 'm') AS tiempo_activo_formato
       FROM jornadas j
       JOIN usuarios u ON u.id = j.vendedor_id
       ${sql}
       ORDER BY j.fecha DESC, u.nombre`,
      valores
    );

    enviarCsv(res, nombreConFecha("horas_conexion"), [
      { clave: "fecha", titulo: "Fecha" },
      { clave: "vendedor", titulo: "Vendedor" },
      { clave: "hora_ingreso", titulo: "Hora de ingreso" },
      { clave: "hora_salida", titulo: "Hora de salida" },
      { clave: "minutos_activos", titulo: "Minutos activos" },
      { clave: "tiempo_activo_formato", titulo: "Tiempo activo" },
    ], filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar las horas de conexión" });
  }
}

/**
 * Horas de auxiliar (pausas): cada pausa tomada, su tipo (desconexión o
 * reductor) y duración. Si una pausa sigue abierta (hora_fin NULL), la
 * duración se calcula contra el momento actual, dejando explícito en el
 * CSV que sigue en curso.
 */
async function exportarPausas(req, res) {
  try {
    const { sql, valores } = construirFiltros(req, "j.fecha", "j.vendedor_id");

    const [filas] = await pool.query(
      `SELECT j.fecha, u.nombre AS vendedor, cp.nombre AS pausa, cp.tipo,
              rp.hora_inicio, rp.hora_fin,
              TIMESTAMPDIFF(MINUTE, rp.hora_inicio, COALESCE(rp.hora_fin, NOW())) AS duracion_minutos,
              IF(rp.hora_fin IS NULL, 'En curso', 'Finalizada') AS estado
       FROM registros_pausas rp
       JOIN jornadas j ON j.id = rp.jornada_id
       JOIN usuarios u ON u.id = j.vendedor_id
       JOIN catalogo_pausas cp ON cp.id = rp.pausa_id
       ${sql}
       ORDER BY rp.hora_inicio DESC`,
      valores
    );

    enviarCsv(res, nombreConFecha("horas_pausas"), [
      { clave: "fecha", titulo: "Fecha" },
      { clave: "vendedor", titulo: "Vendedor" },
      { clave: "pausa", titulo: "Pausa" },
      { clave: "tipo", titulo: "Tipo" },
      { clave: "hora_inicio", titulo: "Hora de inicio" },
      { clave: "hora_fin", titulo: "Hora de fin" },
      { clave: "duracion_minutos", titulo: "Duración (min)" },
      { clave: "estado", titulo: "Estado" },
    ], filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar las horas de pausas" });
  }
}

/**
 * Reporte de visitas: el log completo de actividad en campo, incluyendo
 * resultados que no terminaron en venta (no_interesado, reagendar,
 * no_ubicado) -- complementa al reporte de Ventas, que solo muestra las
 * cerradas. Útil para medir esfuerzo real, no solo resultado.
 */
async function exportarVisitas(req, res) {
  try {
    const { sql, valores } = construirFiltros(req, "vi.fecha", "vi.vendedor_id");

    const [filas] = await pool.query(
      `SELECT vi.fecha, u.nombre AS vendedor, lb.nombre AS cliente, lb.telefono,
              z.nombre AS zona, vi.resultado, vi.distancia_al_cliente_m, vi.notas
       FROM visitas vi
       JOIN usuarios u ON u.id = vi.vendedor_id
       JOIN leads l ON l.id = vi.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN zonas z ON z.id = l.zona_id
       ${sql}
       ORDER BY vi.fecha DESC`,
      valores
    );

    enviarCsv(res, nombreConFecha("visitas"), [
      { clave: "fecha", titulo: "Fecha" },
      { clave: "vendedor", titulo: "Vendedor" },
      { clave: "cliente", titulo: "Cliente" },
      { clave: "telefono", titulo: "Teléfono" },
      { clave: "zona", titulo: "Zona" },
      { clave: "resultado", titulo: "Resultado" },
      { clave: "distancia_al_cliente_m", titulo: "Distancia al cliente (m)" },
      { clave: "notas", titulo: "Notas" },
    ], filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar el reporte de visitas" });
  }
}

module.exports = {
  exportarVentas,
  exportarBaseLeads,
  exportarConexion,
  exportarPausas,
  exportarVisitas,
};

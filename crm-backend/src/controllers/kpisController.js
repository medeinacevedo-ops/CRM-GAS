const pool = require("../config/db");

/**
 * Resuelve un parametro ?mes=YYYY-MM (formato nativo de <input type="month">)
 * a { anio, mes }. Sin parametro (o invalido), cae al mes actual -- asi el
 * comportamiento por defecto del dashboard no cambia para nadie que no
 * use el filtro todavia.
 */
function resolverMes(mesParam) {
  const hoy = new Date();
  let anio = hoy.getFullYear();
  let mes = hoy.getMonth() + 1;

  if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
    const [a, m] = mesParam.split("-").map(Number);
    anio = a;
    mes = m;
  }
  return { anio, mes };
}

function mesAnterior({ anio, mes }) {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/** ?base_ids=3,5,8 -> [3,5,8] | null si no se mando (= sin filtro, todas las bases) */
function parsearBaseIds(baseIdsParam) {
  if (!baseIdsParam) return null;
  const ids = baseIdsParam
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter(Number.isInteger);
  return ids.length > 0 ? ids : null;
}

/**
 * Calcula el cambio porcentual entre dos periodos para las flechas de
 * tendencia ("+12% ↑"). Si el periodo anterior fue 0, no hay porcentaje
 * matematicamente valido -- se devuelve null y el frontend lo oculta en
 * vez de mostrar "Infinity%".
 */
function calcularCambioPct(actual, anterior) {
  if (anterior === 0) return actual > 0 ? null : 0;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/**
 * KPIs del vendedor autenticado: avance del dia y del mes vigente.
 * Pensado para la pantalla principal de la app (ver mockup "prototipo_app_vendedor_campo").
 */
async function kpisVendedor(req, res) {
  const vendedorId = req.usuario.id;

  try {
    const [[hoy]] = await pool.query(
      `SELECT
         COUNT(*) AS visitados,
         SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN 1 ELSE 0 END) AS ventas,
         COALESCE(SUM(ve.monto), 0) AS monto
       FROM visitas v
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE v.vendedor_id = ? AND DATE(v.fecha) = DATE(NOW())`,
      [vendedorId]
    );

    const [[asignadosHoy]] = await pool.query(
      `SELECT COUNT(*) AS total FROM leads
       WHERE vendedor_id = ? AND estado IN ('asignado', 'contactado')`,
      [vendedorId]
    );

    const [[mes]] = await pool.query(
      `SELECT
         COUNT(*) AS visitados,
         SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN 1 ELSE 0 END) AS ventas,
         COALESCE(SUM(ve.monto), 0) AS monto
       FROM visitas v
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE v.vendedor_id = ?
         AND YEAR(v.fecha) = YEAR(NOW()) AND MONTH(v.fecha) = MONTH(NOW())`,
      [vendedorId]
    );

    const conversionHoy = hoy.visitados > 0 ? Math.round((hoy.ventas / hoy.visitados) * 100) : 0;
    const conversionMes = mes.visitados > 0 ? Math.round((mes.ventas / mes.visitados) * 100) : 0;

    res.json({
      hoy: {
        visitados: hoy.visitados,
        pendientes: asignadosHoy.total,
        ventas: hoy.ventas || 0,
        monto: hoy.monto,
        conversion_pct: conversionHoy,
      },
      mes: {
        visitados: mes.visitados,
        ventas: mes.ventas || 0,
        monto: mes.monto,
        conversion_pct: conversionMes,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular los KPIs del vendedor" });
  }
}

/**
 * Dashboard general del administrador: ventas del mes, conversion, cobertura
 * por zona, ventas por semana y ranking de vendedores.
 */
async function dashboardAdmin(req, res) {
  try {
    const { anio, mes } = resolverMes(req.query.mes);
    const baseIds = parsearBaseIds(req.query.base_ids);
    const filtroBase = baseIds ? `AND lb.carga_id IN (${baseIds.map(() => "?").join(",")})` : "";
    const valoresBase = baseIds || [];

    const [[resumen]] = await pool.query(
      `SELECT
         COALESCE(SUM(ve.monto), 0) AS ventas_mes,
         COUNT(DISTINCT ve.id) AS leads_convertidos_mes
       FROM ventas ve
       JOIN visitas v ON v.id = ve.visita_id
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE YEAR(ve.fecha) = ? AND MONTH(ve.fecha) = ? ${filtroBase}`,
      [anio, mes, ...valoresBase]
    );

    // "Activos hoy" y "total vendedores" son estados operativos del
    // momento actual, no algo que tenga sentido re-calcular para un mes
    // pasado -- quedan siempre sobre el dia de hoy, sin filtro.
    const [[activosHoy]] = await pool.query(
      `SELECT COUNT(*) AS total FROM jornadas WHERE fecha = CURDATE() AND hora_ingreso IS NOT NULL`
    );

    const [[totalVendedores]] = await pool.query(
      `SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'vendedor' AND activo = 1`
    );

    const [[conversion]] = await pool.query(
      `SELECT
         COUNT(*) AS total_visitas,
         SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN 1 ELSE 0 END) AS total_ventas
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE YEAR(v.fecha) = ? AND MONTH(v.fecha) = ? ${filtroBase}`,
      [anio, mes, ...valoresBase]
    );
    const conversionPromedio =
      conversion.total_visitas > 0
        ? Math.round((conversion.total_ventas / conversion.total_visitas) * 100)
        : 0;

    const [ventasPorSemana] = await pool.query(
      `SELECT WEEK(ve.fecha, 3) AS semana, COALESCE(SUM(ve.monto), 0) AS monto
       FROM ventas ve
       JOIN visitas v ON v.id = ve.visita_id
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE YEAR(ve.fecha) = ? AND MONTH(ve.fecha) = ? ${filtroBase}
       GROUP BY semana
       ORDER BY semana`,
      [anio, mes, ...valoresBase]
    );

    // Cobertura por zona queda deliberadamente sin filtro de mes/base:
    // es una foto de cobertura operativa acumulada por zona, no una
    // metrica de desempeño de un periodo o una base en particular.
    const [coberturaPorZona] = await pool.query(
      `SELECT z.nombre AS zona, z.distrito,
              COUNT(l.id) AS total_leads,
              SUM(CASE WHEN l.estado IN ('contactado', 'vendido', 'descartado') THEN 1 ELSE 0 END) AS trabajados
       FROM zonas z
       LEFT JOIN leads l ON l.zona_id = z.id
       GROUP BY z.id`
    );
    const cobertura = coberturaPorZona.map((z) => ({
      zona: z.zona,
      distrito: z.distrito,
      total_leads: z.total_leads,
      trabajados: z.trabajados || 0,
      porcentaje: z.total_leads > 0 ? Math.round(((z.trabajados || 0) / z.total_leads) * 100) : 0,
    }));

    const [ranking] = await pool.query(
      `SELECT u.nombre AS vendedor, z.nombre AS zona,
              COALESCE(SUM(ve.monto), 0) AS ventas_monto,
              COUNT(DISTINCT v.id) AS total_visitas,
              SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN 1 ELSE 0 END) AS total_ventas
       FROM usuarios u
       LEFT JOIN zonas z ON z.id = u.zona_id
       LEFT JOIN visitas v ON v.vendedor_id = u.id
         AND YEAR(v.fecha) = ? AND MONTH(v.fecha) = ?
       LEFT JOIN leads l ON l.id = v.lead_id
       LEFT JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE u.rol = 'vendedor' AND u.activo = 1
         ${baseIds ? `AND (v.id IS NULL OR lb.carga_id IN (${baseIds.map(() => "?").join(",")}))` : ""}
       GROUP BY u.id
       ORDER BY ventas_monto DESC
       LIMIT 10`,
      [anio, mes, ...valoresBase]
    );
    const rankingConConversion = ranking.map((r) => ({
      vendedor: r.vendedor,
      zona: r.zona,
      ventas_monto: r.ventas_monto,
      conversion_pct: r.total_visitas > 0 ? Math.round((r.total_ventas / r.total_visitas) * 100) : 0,
    }));

    res.json({
      ventas_mes: resumen.ventas_mes,
      leads_convertidos_mes: resumen.leads_convertidos_mes,
      vendedores_activos_hoy: activosHoy.total,
      total_vendedores: totalVendedores.total,
      conversion_promedio_pct: conversionPromedio,
      ventas_por_semana: ventasPorSemana,
      cobertura_por_zona: cobertura,
      ranking_vendedores: rankingConConversion,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular el dashboard" });
  }
}

/**
 * Serie diaria del mes vigente: cantidad de visitas y de ventas por cada
 * dia del mes (desde el dia 1 hasta hoy), para graficar barras (visitas)
 * y linea (ventas) en el dashboard.
 */
async function serieDiariaMes(req, res) {
  try {
    const { anio, mes } = resolverMes(req.query.mes);
    const baseIds = parsearBaseIds(req.query.base_ids);
    const filtroBase = baseIds ? `AND lb.carga_id IN (${baseIds.map(() => "?").join(",")})` : "";
    const valoresBase = baseIds || [];

    const [visitasPorDia] = await pool.query(
      `SELECT DAY(v.fecha) AS dia, COUNT(*) AS total
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE YEAR(v.fecha) = ? AND MONTH(v.fecha) = ? ${filtroBase}
       GROUP BY DAY(v.fecha)`,
      [anio, mes, ...valoresBase]
    );
    const [ventasPorDia] = await pool.query(
      `SELECT DAY(ve.fecha) AS dia, COUNT(*) AS total
       FROM ventas ve
       JOIN visitas v ON v.id = ve.visita_id
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE YEAR(ve.fecha) = ? AND MONTH(ve.fecha) = ? ${filtroBase}
       GROUP BY DAY(ve.fecha)`,
      [anio, mes, ...valoresBase]
    );

    const mapaVisitas = Object.fromEntries(visitasPorDia.map((v) => [v.dia, v.total]));
    const mapaVentas = Object.fromEntries(ventasPorDia.map((v) => [v.dia, v.total]));

    const hoy = new Date();
    const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
    // Mes actual: hasta hoy (como antes). Mes pasado: el mes completo.
    const ultimoDia = esMesActual ? hoy.getDate() : new Date(anio, mes, 0).getDate();

    const serie = [];
    for (let dia = 1; dia <= ultimoDia; dia++) {
      serie.push({
        dia,
        visitas: mapaVisitas[dia] || 0,
        ventas: mapaVentas[dia] || 0,
      });
    }

    res.json(serie);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular la serie diaria" });
  }
}

/**
 * Dashboard del supervisor: igual de espiritu que el del admin, pero
 * limitado SOLO a los vendedores que el admin le habilito via
 * permisos_supervisor (por zona completa o por vendedor especifico),
 * y solo si ese permiso tiene puede_ver_kpis = 1.
 */
async function dashboardSupervisor(req, res) {
  const supervisorId = req.usuario.id;

  try {
    const [permisos] = await pool.query(
      `SELECT zona_id, vendedor_id FROM permisos_supervisor
       WHERE supervisor_id = ? AND puede_ver_kpis = 1`,
      [supervisorId]
    );

    if (permisos.length === 0) {
      return res.status(403).json({
        error: "No tienes permisos de visibilidad otorgados todavia. Pide al administrador que te habilite acceso a una zona o vendedor.",
      });
    }

    const zonaIds = permisos.filter((p) => p.zona_id).map((p) => p.zona_id);
    const vendedorIdsDirectos = permisos.filter((p) => p.vendedor_id).map((p) => p.vendedor_id);

    // Construye el set de vendedores visibles: los de las zonas otorgadas + los otorgados individualmente
    const condiciones = [];
    const valores = [];
    if (zonaIds.length > 0) {
      condiciones.push(`zona_id IN (${zonaIds.map(() => "?").join(",")})`);
      valores.push(...zonaIds);
    }
    if (vendedorIdsDirectos.length > 0) {
      condiciones.push(`id IN (${vendedorIdsDirectos.map(() => "?").join(",")})`);
      valores.push(...vendedorIdsDirectos);
    }

    const [vendedoresVisibles] = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE rol = 'vendedor' AND (${condiciones.join(" OR ")})`,
      valores
    );

    if (vendedoresVisibles.length === 0) {
      return res.json({ vendedores_visibles: [], ventas_mes: 0, ranking_vendedores: [] });
    }

    const idsVisibles = vendedoresVisibles.map((v) => v.id);
    const placeholders = idsVisibles.map(() => "?").join(",");

    const [[resumen]] = await pool.query(
      `SELECT COALESCE(SUM(ve.monto), 0) AS ventas_mes, COUNT(DISTINCT ve.id) AS leads_convertidos_mes
       FROM ventas ve
       JOIN visitas v ON v.id = ve.visita_id
       WHERE v.vendedor_id IN (${placeholders})
         AND YEAR(ve.fecha) = YEAR(CURDATE()) AND MONTH(ve.fecha) = MONTH(CURDATE())`,
      idsVisibles
    );

    const [ranking] = await pool.query(
      `SELECT u.nombre AS vendedor,
              COALESCE(SUM(ve.monto), 0) AS ventas_monto,
              COUNT(DISTINCT v.id) AS total_visitas,
              SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN 1 ELSE 0 END) AS total_ventas
       FROM usuarios u
       LEFT JOIN visitas v ON v.vendedor_id = u.id
         AND YEAR(v.fecha) = YEAR(CURDATE()) AND MONTH(v.fecha) = MONTH(CURDATE())
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE u.id IN (${placeholders})
       GROUP BY u.id
       ORDER BY ventas_monto DESC`,
      idsVisibles
    );

    res.json({
      vendedores_visibles: vendedoresVisibles,
      ventas_mes: resumen.ventas_mes,
      leads_convertidos_mes: resumen.leads_convertidos_mes,
      ranking_vendedores: ranking.map((r) => ({
        vendedor: r.vendedor,
        ventas_monto: r.ventas_monto,
        conversion_pct: r.total_visitas > 0 ? Math.round((r.total_ventas / r.total_visitas) * 100) : 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular el dashboard del supervisor" });
  }
}

/**
 * Ranking de los mejores vendedores del mes para motivacion (Gamificacion).
 */
async function rankingVendedores(req, res) {
  try {
    const [ranking] = await pool.query(
      `SELECT u.nombre AS vendedor, z.nombre AS zona,
              COALESCE(SUM(ve.monto), 0) AS ventas_monto,
              COUNT(DISTINCT ve.id) AS total_ventas
       FROM usuarios u
       LEFT JOIN zonas z ON z.id = u.zona_id
       LEFT JOIN visitas v ON v.vendedor_id = u.id
         AND YEAR(v.fecha) = YEAR(CURDATE()) AND MONTH(v.fecha) = MONTH(CURDATE())
       LEFT JOIN ventas ve ON ve.visita_id = v.id
       WHERE u.rol = 'vendedor' AND u.activo = 1
       GROUP BY u.id
       ORDER BY total_ventas DESC, ventas_monto DESC
       LIMIT 10`
    );
    res.json(ranking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el ranking" });
  }
}

/**
 * Calcula los 6 indicadores principales (leads, cobertura, contactos,
 * pedidos, ventas, conversion) para un mes+base especificos. Se usa dos
 * veces desde resumenIndicadores: una para el periodo elegido, otra para
 * el periodo anterior, y con ambas se arma el "+12% ↑" de tendencia.
 *
 * Definiciones (igual criterio que "Reparto automático" / reportes):
 *   - leads_total: leads generados ese mes (leads.creado_en), de la(s) base(s).
 *   - cobertura_total: de esos leads, cuantos recibieron al menos 1 visita ese mes.
 *   - contactos_total: de esos, cuantos tuvieron contacto real (resultado != 'no_ubicado').
 *   - pedidos_total: de esos, cuantos terminaron en venta_cerrada.
 *   - ventas_monto: suma de S/ de esas ventas.
 */
async function calcularIndicadoresPeriodo({ anio, mes }, baseIds) {
  const filtroBase = baseIds ? `AND lb.carga_id IN (${baseIds.map(() => "?").join(",")})` : "";
  const valoresBase = baseIds || [];

  const [[fila]] = await pool.query(
    `SELECT
       COUNT(DISTINCT l.id) AS leads_total,
       COUNT(DISTINCT CASE WHEN v.id IS NOT NULL THEN l.id END) AS cobertura_total,
       COUNT(DISTINCT CASE WHEN v.resultado != 'no_ubicado' THEN l.id END) AS contactos_total,
       COUNT(DISTINCT CASE WHEN v.resultado = 'venta_cerrada' THEN l.id END) AS pedidos_total,
       COALESCE(SUM(CASE WHEN v.resultado = 'venta_cerrada' THEN ve.monto ELSE 0 END), 0) AS ventas_monto
     FROM leads l
     JOIN leads_base lb ON lb.id = l.lead_base_id
     LEFT JOIN visitas v ON v.lead_id = l.id AND YEAR(v.fecha) = ? AND MONTH(v.fecha) = ?
     LEFT JOIN ventas ve ON ve.visita_id = v.id
     WHERE YEAR(l.creado_en) = ? AND MONTH(l.creado_en) = ?
       ${filtroBase}`,
    [anio, mes, anio, mes, ...valoresBase]
  );

  const cobertura_pct = fila.leads_total > 0 ? Math.round((fila.cobertura_total / fila.leads_total) * 100) : 0;
  const conversion_pct = fila.contactos_total > 0 ? Math.round((fila.pedidos_total / fila.contactos_total) * 100) : 0;

  return {
    leads_total: fila.leads_total,
    cobertura_total: fila.cobertura_total,
    cobertura_pct,
    contactos_total: fila.contactos_total,
    pedidos_total: fila.pedidos_total,
    ventas_monto: fila.ventas_monto,
    conversion_pct,
  };
}

/**
 * Endpoint del mini-resumen con tendencia para el dashboard
 * (?mes=YYYY-MM&base_ids=1,2,3). Devuelve el periodo actual y el cambio
 * porcentual de cada indicador contra el mes inmediatamente anterior.
 */
async function resumenIndicadores(req, res) {
  try {
    const periodoActual = resolverMes(req.query.mes);
    const periodoAnterior = mesAnterior(periodoActual);
    const baseIds = parsearBaseIds(req.query.base_ids);

    const [actual, anterior] = await Promise.all([
      calcularIndicadoresPeriodo(periodoActual, baseIds),
      calcularIndicadoresPeriodo(periodoAnterior, baseIds),
    ]);

    res.json({
      actual,
      cambios: {
        leads_total: calcularCambioPct(actual.leads_total, anterior.leads_total),
        cobertura_pct: calcularCambioPct(actual.cobertura_pct, anterior.cobertura_pct),
        contactos_total: calcularCambioPct(actual.contactos_total, anterior.contactos_total),
        pedidos_total: calcularCambioPct(actual.pedidos_total, anterior.pedidos_total),
        ventas_monto: calcularCambioPct(actual.ventas_monto, anterior.ventas_monto),
        conversion_pct: calcularCambioPct(actual.conversion_pct, anterior.conversion_pct),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular el resumen de indicadores" });
  }
}
async function kpisBase(req, res) {
  const { carga_id } = req.query;
  const whereCarga = carga_id ? `WHERE lb.carga_id = ${Number(carga_id)}` : "";

  try {
    // 1. Total registros (DISTINCT para evitar duplicidad por visitas), contactabilidad y libres
    const [[stats]] = await pool.query(
      `SELECT
         COUNT(DISTINCT l.id) as total,
         COUNT(DISTINCT CASE WHEN v.id IS NOT NULL THEN l.id END) as contactados,
         COUNT(DISTINCT CASE WHEN v.resultado = 'venta_cerrada' THEN l.id END) as ventas,
         COUNT(DISTINCT CASE WHEN l.vendedor_id IS NULL THEN l.id END) as libres
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN visitas v ON v.lead_id = l.id
       ${whereCarga}`
    );

    // 2. Total de visitas para calcular vueltas (turns)
    const [[visitas]] = await pool.query(
      `SELECT COUNT(*) as total_visitas
       FROM visitas v
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       ${whereCarga}`
    );

    const contactabilidad = stats.total > 0 ? Math.round((stats.contactados / stats.total) * 100) : 0;
    const efectividad = stats.contactados > 0 ? Math.round((stats.ventas / stats.contactados) * 100) : 0;
    const vueltas = stats.contactados > 0 ? (visitas.total_visitas / stats.contactados).toFixed(1) : "0.0";

    res.json({
      total_registros: stats.total,
      contactados: stats.contactados,
      libres: stats.libres || 0,
      contactabilidad_pct: contactabilidad,
      efectividad_pct: efectividad,
      vueltas_base: vueltas
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular KPIs de base" });
  }
}

module.exports = { kpisVendedor, dashboardAdmin, serieDiariaMes, dashboardSupervisor, rankingVendedores, kpisBase, resumenIndicadores };

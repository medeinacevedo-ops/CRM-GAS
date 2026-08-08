const pool = require("../config/db");

/**
 * Determina que IDs de vendedor puede ver el usuario que consulta.
 * - admin: todos (sin restriccion, puede filtrar por query params igual).
 * - supervisor: solo los vendedores de zonas/vendedores que tenga otorgados
 *   con puede_ver_ubicacion = 1 en permisos_supervisor.
 * Devuelve null para "sin restriccion" (admin) o un array de IDs (supervisor).
 * Un array vacio significa "no tiene ningun permiso de ubicacion".
 */
async function resolverVendedoresVisibles(usuario) {
  if (usuario.rol === "admin") return null;

  const [permisos] = await pool.query(
    `SELECT zona_id, vendedor_id FROM permisos_supervisor
     WHERE supervisor_id = ? AND puede_ver_ubicacion = 1`,
    [usuario.id]
  );
  if (permisos.length === 0) return [];

  const zonaIds = permisos.filter((p) => p.zona_id).map((p) => p.zona_id);
  const vendedorIdsDirectos = permisos.filter((p) => p.vendedor_id).map((p) => p.vendedor_id);

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

  const [vendedores] = await pool.query(
    `SELECT id FROM usuarios WHERE rol = 'vendedor' AND (${condiciones.join(" OR ")})`,
    valores
  );
  return vendedores.map((v) => v.id);
}

/**
 * Historial de ubicacion (checkpoints): ingreso, cada visita, inicio/fin de
 * pausa, y salida -- no es tracking en vivo, es la reconstruccion del
 * recorrido despues de ocurrido, tal como se diseno para ahorrar bateria.
 *
 * Query params opcionales: vendedor_id, fecha (YYYY-MM-DD), tipo_evento, page, limit
 */
async function listarCheckpoints(req, res) {
  const { vendedor_id, fecha, tipo_evento } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  try {
    const vendedoresVisibles = await resolverVendedoresVisibles(req.usuario);

    if (vendedoresVisibles !== null && vendedoresVisibles.length === 0) {
      return res.status(403).json({
        error: "No tienes permiso de ubicación otorgado todavía. Pide al administrador que te lo habilite.",
      });
    }

    const condiciones = [];
    const valores = [];

    if (vendedoresVisibles !== null) {
      condiciones.push(`c.vendedor_id IN (${vendedoresVisibles.map(() => "?").join(",")})`);
      valores.push(...vendedoresVisibles);
    }
    if (vendedor_id) {
      condiciones.push("c.vendedor_id = ?");
      valores.push(vendedor_id);
    }
    if (fecha) {
      condiciones.push("DATE(c.hora) = ?");
      valores.push(fecha);
    }
    if (tipo_evento) {
      condiciones.push("c.tipo_evento = ?");
      valores.push(tipo_evento);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM checkpoints_ubicacion c ${where}`,
      valores
    );

    const [rows] = await pool.query(
      `SELECT c.id, c.vendedor_id, u.nombre AS vendedor, c.tipo_evento, c.lat, c.lng, c.hora,
              lb.nombre AS cliente
       FROM checkpoints_ubicacion c
       JOIN usuarios u ON u.id = c.vendedor_id
       LEFT JOIN leads l ON c.tipo_evento = 'visita' AND l.id = c.referencia_id
       LEFT JOIN leads_base lb ON lb.id = l.lead_base_id
       ${where}
       ORDER BY c.hora DESC
       LIMIT ? OFFSET ?`,
      [...valores, limit, offset]
    );

    res.json({ total, page, limit, resultados: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar el historial de ubicación" });
  }
}

module.exports = { listarCheckpoints, resolverVendedoresVisibles };

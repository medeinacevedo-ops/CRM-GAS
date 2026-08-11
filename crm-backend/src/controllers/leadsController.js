const fs = require("fs");
const { parse } = require("csv-parse/sync");
const pool = require("../config/db");

/**
 * Sube un archivo CSV con columnas: nombre,telefono,direccion,lat,lng,distrito
 */
async function cargarBase(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "Debes adjuntar un archivo CSV" });
  }

  const conn = await pool.getConnection();
  try {
    const contenido = fs.readFileSync(req.file.path, "utf8");
    const registros = parse(contenido, { columns: true, skip_empty_lines: true, trim: true });

    if (registros.length === 0) {
      return res.status(400).json({ error: "El archivo no contiene registros" });
    }

    await conn.beginTransaction();

    const [cargaResult] = await conn.query(
      `INSERT INTO bases_cargadas (nombre_archivo, cargado_por, total_registros, estado)
       VALUES (?, ?, ?, 'procesando')`,
      [req.file.originalname, req.usuario.id, registros.length]
    );
    const cargaId = cargaResult.insertId;

    const values = registros.map((r) => [
      cargaId,
      r.nombre || null,
      r.telefono || null,
      r.direccion || null,
      r.lat || null,
      r.lng || null,
      r.distrito || null,
      JSON.stringify(r),
    ]);

    await conn.query(
      `INSERT INTO leads_base (carga_id, nombre, telefono, direccion, lat, lng, distrito, datos_adicionales)
       VALUES ?`,
      [values]
    );

    await conn.query(`UPDATE bases_cargadas SET estado = 'completado' WHERE id = ?`, [cargaId]);

    await conn.commit();
    fs.unlinkSync(req.file.path);

    res.status(201).json({ carga_id: cargaId, total_registros: registros.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al procesar la carga de base" });
  } finally {
    conn.release();
  }
}

async function listarCargas(req, res) {
  const [rows] = await pool.query(
    `SELECT bc.id, bc.nombre_archivo, bc.total_registros, bc.estado, bc.fecha_carga, u.nombre AS cargado_por
     FROM bases_cargadas bc JOIN usuarios u ON u.id = bc.cargado_por
     ORDER BY bc.fecha_carga DESC`
  );
  res.json(rows);
}

/**
 * Genera la copia operativa. Mejora: Búsqueda insensible a acentos y espacios.
 */
async function generarLeadsOperativos(req, res) {
  const { carga_id, zona_id } = req.body;
  const adminId = req.usuario.id;

  if (!carga_id || !zona_id) return res.status(400).json({ error: "Carga y Zona son requeridas" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[zona]] = await conn.query("SELECT distrito FROM zonas WHERE id = ?", [zona_id]);
    if (!zona) return res.status(404).json({ error: "Zona no encontrada" });

    // Normalizar para comparación (LOWER, TRIM y COLLATE para acentos)
    const [insResult] = await conn.query(
      `INSERT INTO leads (lead_base_id, zona_id, estado)
       SELECT lb.id, ?, 'nuevo'
       FROM leads_base lb
       WHERE lb.carga_id = ?
         AND lb.distrito COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
         AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.lead_base_id = lb.id)`,
      [zona_id, carga_id, zona.distrito]
    );

    const leadsCreados = insResult.affectedRows;

    // Reparto automático inmediato si hay vendedores activos
    if (leadsCreados > 0) {
      const [vendedores] = await conn.query(
        `SELECT id FROM usuarios WHERE zona_id = ? AND rol = 'vendedor' AND activo = 1`, [zona_id]
      );

      if (vendedores.length > 0) {
        const [nuevosLeads] = await conn.query(
          `SELECT l.id FROM leads l
           JOIN leads_base lb ON lb.id = l.lead_base_id
           WHERE lb.carga_id = ? AND l.zona_id = ? AND l.estado = 'nuevo' AND l.vendedor_id IS NULL`,
          [carga_id, zona_id]
        );

        let i = 0;
        for (const lead of nuevosLeads) {
          const v = vendedores[i % vendedores.length];
          await conn.query(`UPDATE leads SET vendedor_id = ?, estado = 'asignado', fecha_asignacion = NOW() WHERE id = ?`, [v.id, lead.id]);
          await conn.query(`INSERT INTO asignaciones (lead_id, vendedor_id, asignado_por, tipo) VALUES (?, ?, ?, 'automatico')`, [lead.id, v.id, adminId]);
          i++;
        }
      }
    }

    await conn.commit();
    res.status(201).json({ success: true, mensaje: `Se generaron y repartieron ${leadsCreados} leads.` });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al generar los leads. Verifica la conexión." });
  } finally { conn.release(); }
}

async function repartirZona(conn, zonaId, adminId, cargaId = null) {
  const [vendedores] = await conn.query(
    `SELECT id FROM usuarios WHERE zona_id = ? AND rol = 'vendedor' AND activo = 1`, [zonaId]
  );
  if (vendedores.length === 0) return { zona_id: zonaId, leads_asignados: 0, vendedores: 0 };

  let queryLeads = "SELECT id FROM leads WHERE zona_id = ? AND estado = 'nuevo'";
  let params = [zonaId];
  if(cargaId) {
    queryLeads += " AND lead_base_id IN (SELECT id FROM leads_base WHERE carga_id = ?)";
    params.push(cargaId);
  }

  const [leads] = await conn.query(queryLeads, params);
  if (leads.length === 0) return { zona_id: zonaId, leads_asignados: 0 };

  let i = 0;
  for (const lead of leads) {
    const v = vendedores[i % vendedores.length];
    await conn.query(`UPDATE leads SET vendedor_id = ?, estado = 'asignado', fecha_asignacion = NOW() WHERE id = ?`, [v.id, lead.id]);
    await conn.query(`INSERT INTO asignaciones (lead_id, vendedor_id, asignado_por, tipo) VALUES (?, ?, ?, 'automatico')`, [lead.id, v.id, adminId]);
    i++;
  }
  return { zona_id: zonaId, leads_asignados: leads.length };
}

async function repartirAutomatico(req, res) {
  const { zona_id, todas_las_zonas, carga_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let resultados;
    if (todas_las_zonas) {
      const [zonas] = await conn.query(`SELECT DISTINCT zona_id FROM leads WHERE estado = 'nuevo'`);
      resultados = [];
      for (const z of zonas) resultados.push(await repartirZona(conn, z.zona_id, req.usuario.id, carga_id));
    } else {
      resultados = [await repartirZona(conn, zona_id, req.usuario.id, carga_id)];
    }
    await conn.commit();
    res.json({ resultados });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: "Error en reparto" });
  } finally {
    conn.release();
  }
}

async function misLeads(req, res) {
  const [rows] = await pool.query(
    `SELECT l.id, lb.nombre, lb.telefono, lb.direccion, lb.lat, lb.lng, lb.distrito, l.estado, z.nombre as zona_nombre,
            (SELECT COUNT(*) FROM visitas v WHERE v.lead_id = l.id AND DATE(v.fecha) = DATE(NOW())) as visitado_hoy
     FROM leads l
     JOIN leads_base lb ON lb.id = l.lead_base_id
     JOIN zonas z ON z.id = l.zona_id
     WHERE l.vendedor_id = ? AND l.estado IN ('asignado', 'contactado', 'vendido')
     ORDER BY l.fecha_asignacion DESC`,
    [req.usuario.id]
  );
  res.json(rows);
}

/**
 * Cartera de un vendedor especifico, vista por el admin -- se usa para
 * el selector de "reasignar a otro cliente" al corregir una visita mal
 * registrada (Principal > Corregir visitas).
 */
async function leadsDeVendedor(req, res) {
  const { vendedorId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT l.id, lb.nombre, lb.direccion, l.estado
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE l.vendedor_id = ?
       ORDER BY lb.nombre`,
      [vendedorId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar los clientes del vendedor" });
  }
}

/**
 * Busca leads ya asignados, con filtros, para la pantalla
 * "Principal > Reasignar leads" -- distinto de misLeads (que es la
 * cartera propia del vendedor) y de zonasConDisponiblesDeCarga (que
 * trabaja sobre leads sin asignar).
 */
async function buscarLeadsAdmin(req, res) {
  const { vendedor_id, zona_id, estado, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 25);
  const offset = (page - 1) * limit;

  const condiciones = ["l.vendedor_id IS NOT NULL"];
  const valores = [];

  if (vendedor_id) {
    condiciones.push("l.vendedor_id = ?");
    valores.push(vendedor_id);
  }
  if (zona_id) {
    condiciones.push("l.zona_id = ?");
    valores.push(zona_id);
  }
  if (estado) {
    condiciones.push("l.estado = ?");
    valores.push(estado);
  }
  if (q) {
    condiciones.push("(lb.nombre LIKE ? OR lb.telefono LIKE ?)");
    valores.push(`%${q}%`, `%${q}%`);
  }
  const where = `WHERE ${condiciones.join(" AND ")}`;

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM leads l JOIN leads_base lb ON lb.id = l.lead_base_id ${where}`,
      valores
    );

    const [rows] = await pool.query(
      `SELECT l.id, l.estado, l.fecha_asignacion,
              lb.nombre AS cliente, lb.telefono, lb.direccion,
              u.id AS vendedor_id, u.nombre AS vendedor,
              z.id AS zona_id, z.nombre AS zona
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN usuarios u ON u.id = l.vendedor_id
       LEFT JOIN zonas z ON z.id = l.zona_id
       ${where}
       ORDER BY l.fecha_asignacion DESC
       LIMIT ? OFFSET ?`,
      [...valores, limit, offset]
    );

    res.json({ total, page, limit, resultados: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar leads" });
  }
}

/**
 * Reasigna un lead directamente a otro vendedor -- corrección de un
 * error de asignación, sin pasar por el flujo de intercambio (que
 * requiere que ambos vendedores confirmen). Queda registrado en
 * `asignaciones` con tipo 'manual' para mantener trazabilidad.
 */
async function reasignarLeadAdmin(req, res) {
  const { id } = req.params;
  const { vendedor_id } = req.body;
  const adminId = req.usuario.id;

  if (!vendedor_id) return res.status(400).json({ error: "vendedor_id es requerido" });

  try {
    const [[lead]] = await pool.query(`SELECT id, vendedor_id FROM leads WHERE id = ?`, [id]);
    if (!lead) return res.status(404).json({ error: "Lead no encontrado" });

    const [[vendedor]] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor' AND activo = 1`,
      [vendedor_id]
    );
    if (!vendedor) return res.status(404).json({ error: "Vendedor no encontrado o inactivo" });

    if (String(lead.vendedor_id) === String(vendedor_id)) {
      return res.status(400).json({ error: "El lead ya está asignado a ese vendedor" });
    }

    await pool.query(
      `UPDATE leads SET vendedor_id = ?, fecha_asignacion = NOW() WHERE id = ?`,
      [vendedor_id, id]
    );
    await pool.query(
      `INSERT INTO asignaciones (lead_id, vendedor_id, asignado_por, tipo) VALUES (?, ?, ?, 'manual')`,
      [id, vendedor_id, adminId]
    );

    res.json({ success: true, mensaje: "Lead reasignado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al reasignar el lead" });
  }
}

async function resumenCarga(req, res) {
  const { id } = req.params;
  const [rows] = await pool.query("SELECT COUNT(*) as total FROM leads_base WHERE carga_id = ?", [id]);
  const [libres] = await pool.query("SELECT COUNT(*) as total FROM leads l JOIN leads_base lb ON lb.id = l.lead_base_id WHERE lb.carga_id = ? AND l.vendedor_id IS NULL", [id]);
  res.json({ total_leads: rows[0].total, leads_disponibles: libres[0].total });
}

async function zonasConDisponiblesDeCarga(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT z.id, z.nombre, z.distrito, COUNT(*) AS disponibles
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN zonas z ON z.id = l.zona_id
       WHERE lb.carga_id = ? AND l.estado = 'nuevo'
       GROUP BY z.id`, [id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Error" }); }
}

async function vendedoresDeZonaParaAsignar(req, res) {
  const { id, zonaId } = req.params;
  try {
    const [vendedores] = await pool.query(
      `SELECT u.id, u.nombre,
              (SELECT COUNT(*) FROM leads l2 WHERE l2.vendedor_id = u.id AND l2.estado IN ('asignado','contactado')) AS cartera_total
       FROM usuarios u WHERE u.rol = 'vendedor' AND u.activo = 1 AND u.zona_id = ?`, [zonaId]
    );
    res.json({ vendedores });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error" }); }
}

async function asignarIndividual(req, res) {
    res.json({ success: true });
}

/**
 * Desglose por zona de una carga, para la pantalla de Reparto automático:
 * de los leads_base de esta carga, cuántos ya se generaron como leads
 * operativos por zona (según el match de distrito, igual criterio que
 * generarLeadsOperativos), cuántos siguen disponibles (estado 'nuevo'),
 * cuántos vendedores activos hay en esa zona, y cuántos leads_base de
 * la carga no matchean con NINGUNA zona registrada todavía.
 */
async function resumenZonasCarga(req, res) {
  const { id } = req.params;
  try {
    const [zonas] = await pool.query(
      `SELECT z.id, z.nombre, z.distrito,
              COUNT(l.id) AS total_leads,
              SUM(CASE WHEN l.estado = 'nuevo' THEN 1 ELSE 0 END) AS leads_disponibles,
              (SELECT COUNT(*) FROM usuarios u
               WHERE u.zona_id = z.id AND u.rol = 'vendedor' AND u.activo = 1) AS vendedores
       FROM zonas z
       JOIN leads_base lb
         ON lb.distrito COLLATE utf8mb4_unicode_ci = z.distrito COLLATE utf8mb4_unicode_ci
        AND lb.carga_id = ?
       LEFT JOIN leads l ON l.lead_base_id = lb.id AND l.zona_id = z.id
       GROUP BY z.id, z.nombre, z.distrito
       ORDER BY z.nombre`,
      [id]
    );

    const [[{ sin_zona }]] = await pool.query(
      `SELECT COUNT(*) AS sin_zona
       FROM leads_base lb
       WHERE lb.carga_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM zonas z
           WHERE z.distrito COLLATE utf8mb4_unicode_ci = lb.distrito COLLATE utf8mb4_unicode_ci
         )`,
      [id]
    );

    // leads_disponibles llega como string/decimal por el SUM en MySQL;
    // se normaliza a número para que el frontend lo compare bien (> 0).
    const zonasNormalizadas = zonas.map((z) => ({
      ...z,
      total_leads: Number(z.total_leads),
      leads_disponibles: Number(z.leads_disponibles || 0),
      vendedores: Number(z.vendedores),
    }));

    res.json({ zonas: zonasNormalizadas, sin_zona: Number(sin_zona) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el desglose por zona" });
  }
}

/**
 * Crea un prospecto desde el APP.
 */
async function crearLeadProspecto(req, res) {
  const { nombre, telefono, direccion, lat, lng, distrito } = req.body;
  const vendedorId = req.usuario.id;

  if (!nombre || !lat || !lng) return res.status(400).json({ error: "Nombre y Ubicación son obligatorios." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Asegurar Carga de Prospección
    let [cargas] = await conn.query("SELECT id FROM bases_cargadas WHERE nombre_archivo = 'PROSPECCION' LIMIT 1");
    let cargaId;
    if (cargas.length === 0) {
      const [r] = await conn.query("INSERT INTO bases_cargadas (nombre_archivo, cargado_por, total_registros, estado) VALUES ('PROSPECCION', ?, 1, 'completado')", [vendedorId]);
      cargaId = r.insertId;
    } else {
      cargaId = cargas[0].id;
      await conn.query("UPDATE bases_cargadas SET total_registros = total_registros + 1 WHERE id = ?", [cargaId]);
    }

    // 2. Obtener Zona del Vendedor
    const [[user]] = await conn.query("SELECT zona_id FROM usuarios WHERE id = ?", [vendedorId]);
    if (!user || !user.zona_id) {
       await conn.rollback();
       return res.status(400).json({ error: "Tu usuario no tiene una Zona asignada. Pide al administrador que te asigne una." });
    }

    // 3. Insertar en Leads_Base
    const [lbResult] = await conn.query(
      `INSERT INTO leads_base (carga_id, nombre, telefono, direccion, lat, lng, distrito, datos_adicionales)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cargaId, nombre, telefono || null, direccion || null, lat, lng, distrito || null, JSON.stringify({ via: "app", vendedor: vendedorId })]
    );

    // 4. Insertar en Leads Operativo directamente asignado al vendedor
    await conn.query(
      `INSERT INTO leads (lead_base_id, zona_id, vendedor_id, estado, fecha_asignacion)
       VALUES (?, ?, ?, 'asignado', NOW())`,
      [lbResult.insertId, user.zona_id, vendedorId]
    );

    await conn.commit();
    res.status(201).json({ success: true, mensaje: "Cliente registrado correctamente en tu ruta." });
  } catch (err) {
    await conn.rollback();
    console.error("[Prospeccion Error]", err);
    res.status(500).json({ error: "Error interno al guardar prospecto." });
  }
  finally { conn.release(); }
}

async function actualizarLead(req, res) {
  const { id } = req.params;
  const { nombre, telefono, direccion, distrito } = req.body;
  const vendedorId = req.usuario.id;

  try {
    // 1. Verificar que el lead le pertenece al vendedor
    const [[lead]] = await pool.query("SELECT lead_base_id FROM leads WHERE id = ? AND vendedor_id = ?", [id, vendedorId]);
    if (!lead) return res.status(404).json({ error: "Lead no encontrado o no autorizado" });

    // 2. Actualizar en leads_base (los datos del cliente)
    // Usamos NULLIF para que si envían vacío no sobreescriba si ya había dato,
    // pero en este caso queremos que se actualice con lo que el usuario puso.
    await pool.query(
      `UPDATE leads_base SET
         nombre = ?,
         telefono = ?,
         direccion = ?,
         distrito = ?
       WHERE id = ?`,
      [nombre, telefono, direccion, distrito, lead.lead_base_id]
    );

    res.json({ success: true, mensaje: "Datos del cliente actualizados correctamente." });
  } catch (err) {
    console.error("[Update Lead Error]", err);
    res.status(500).json({ error: "Error al actualizar los datos." });
  }
}

module.exports = {
  cargarBase, listarCargas, generarLeadsOperativos, repartirAutomatico,
  misLeads, resumenCarga, zonasConDisponiblesDeCarga, vendedoresDeZonaParaAsignar,
  asignarIndividual, resumenZonasCarga, crearLeadProspecto, actualizarLead,
  leadsDeVendedor, buscarLeadsAdmin, reasignarLeadAdmin,
};

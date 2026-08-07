const pool = require("../config/db");

/**
 * Exporta la base maestra de leads con su ultima interaccion.
 * Genera un CSV que se puede abrir directamente en Excel.
 */
async function exportMasterLeads(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT
        lb.nombre, lb.telefono, lb.direccion, lb.distrito,
        l.estado as estado_actual,
        u.nombre as vendedor_asignado,
        v.resultado as ultima_gestion,
        v.fecha as fecha_ultima_gestion,
        v.notas as comentario_ultimo
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN usuarios u ON u.id = l.vendedor_id
       LEFT JOIN (
         SELECT v1.* FROM visitas v1
         JOIN (SELECT lead_id, MAX(fecha) as max_fecha FROM visitas GROUP BY lead_id) v2
         ON v1.lead_id = v2.lead_id AND v1.fecha = v2.max_fecha
       ) v ON v.lead_id = l.id
       ORDER BY lb.distrito, lb.nombre`
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "No hay datos para exportar" });
    }

    // Construir CSV
    const headers = ["Nombre", "Telefono", "Direccion", "Distrito", "Estado Actual", "Vendedor", "Ultima Gestion", "Fecha Ultima", "Comentario"];
    let csvContent = "\ufeff" + headers.join(",") + "\n"; // BOM for Excel UTF-8

    rows.forEach(r => {
      const row = [
        `"${r.nombre || ''}"`,
        `"${r.telefono || ''}"`,
        `"${r.direccion || ''}"`,
        `"${r.distrito || ''}"`,
        `"${r.estado_actual || ''}"`,
        `"${r.vendedor_asignado || ''}"`,
        `"${r.ultima_gestion || ''}"`,
        `"${r.fecha_ultima_gestion ? new Date(r.fecha_ultima_gestion).toLocaleString() : ''}"`,
        `"${(r.comentario_ultimo || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`
      ];
      csvContent += row.join(",") + "\n";
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=Reporte_Maestro_Leads.csv");
    res.status(200).send(csvContent);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el reporte" });
  }
}

/**
 * Exporta el consolidado de ventas del mes.
 */
async function exportConsolidadoVentas(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT
        u.nombre as vendedor,
        lb.nombre as cliente,
        lb.distrito,
        ve.producto,
        ve.monto,
        ve.fecha,
        v.foto_url,
        v.firma_url
       FROM ventas ve
       JOIN visitas v ON v.id = ve.visita_id
       JOIN leads l ON l.id = v.lead_id
       JOIN leads_base lb ON lb.id = l.lead_base_id
       JOIN usuarios u ON u.id = v.vendedor_id
       ORDER BY ve.fecha DESC`
    );

    const headers = ["Vendedor", "Cliente", "Distrito", "Producto", "Monto", "Fecha", "Foto URL", "Firma URL"];
    let csvContent = "\ufeff" + headers.join(",") + "\n";

    rows.forEach(r => {
      const row = [
        `"${r.vendedor}"`,
        `"${r.cliente}"`,
        `"${r.distrito || ''}"`,
        `"${r.producto}"`,
        `"${r.monto}"`,
        `"${new Date(r.fecha).toLocaleString()}"`,
        `"${r.foto_url ? 'http://' + req.get('host') + r.foto_url : ''}"`,
        `"${r.firma_url ? 'http://' + req.get('host') + r.firma_url : ''}"`
      ];
      csvContent += row.join(",") + "\n";
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=Consolidado_Ventas.csv");
    res.status(200).send(csvContent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte de ventas" });
  }
}

/**
 * Exporta el control de tiempos y jornadas de los vendedores.
 */
async function exportControlTiempos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT
        u.nombre as vendedor,
        j.fecha,
        j.hora_ingreso,
        j.hora_salida,
        j.tiempo_activo_total as minutos_activos,
        (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, hora_inicio, COALESCE(hora_fin, NOW()))), 0)
         FROM registros_pausas WHERE jornada_id = j.id) as minutos_pausa
       FROM jornadas j
       JOIN usuarios u ON u.id = j.vendedor_id
       ORDER BY j.fecha DESC, u.nombre ASC`
    );

    const headers = ["Vendedor", "Fecha", "Ingreso", "Salida", "Minutos Pausa", "Minutos Efectivos"];
    let csvContent = "\ufeff" + headers.join(",") + "\n";

    rows.forEach(r => {
      const fechaStr = r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha;
      const row = [
        `"${r.vendedor}"`,
        `"${fechaStr}"`,
        `"${r.hora_ingreso ? new Date(r.hora_ingreso).toLocaleTimeString() : ''}"`,
        `"${r.hora_salida ? new Date(r.hora_salida).toLocaleTimeString() : ''}"`,
        `"${r.minutos_pausa}"`,
        `"${r.minutos_activos || 0}"`
      ];
      csvContent += row.join(",") + "\n";
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=Control_Tiempos.csv");
    res.status(200).send(csvContent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar reporte de tiempos" });
  }
}

module.exports = { exportMasterLeads, exportConsolidadoVentas, exportControlTiempos };

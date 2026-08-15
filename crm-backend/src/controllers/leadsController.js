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

/**
 * Analiza un archivo CSV ANTES de cargarlo: no inserta nada en la base ni
 * crea un registro en bases_cargadas, solo valida fila por fila y
 * devuelve un reporte. Pantalla "Cargar base > Analizar antes de subir".
 *
 * Errores BLOQUEANTES (harían fallar la carga real, porque violan una
 * restricción de la tabla leads_base):
 *   - nombre vacío (columna NOT NULL)
 *   - lat/lng presentes pero no numéricos
 *   - columnas del archivo que no coinciden con la plantilla (típico si
 *     Excel exportó con ; en vez de , como separador)
 *
 * ADVERTENCIAS (no bloquean, pero conviene revisar antes de confirmar):
 *   - teléfono con formato dudoso
 *   - lat/lng en (0,0) o fuera del rango aproximado Perú/Chile
 *   - distrito que no coincide con ningún distrito conocido en `ubigeo`
 *     (ese dataset es solo de Perú -- filas de Chile mostrarán esta
 *     advertencia aunque estén correctas; se omite del todo si la tabla
 *     no está poblada)
 *   - duplicado dentro del mismo archivo (mismo teléfono, o mismo
 *     nombre+dirección repetido)
 *   - cliente que ya existe en la base (mismo teléfono en leads_base)
 */
async function analizarBase(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "Debes adjuntar un archivo CSV" });
  }

  try {
    const contenido = fs.readFileSync(req.file.path, "utf8");
    fs.unlinkSync(req.file.path); // el análisis no conserva el archivo, solo lo lee

    const registros = parse(contenido, { columns: true, skip_empty_lines: true, trim: true });

    if (registros.length === 0) {
      return res.json({
        total_filas: 0,
        error_estructura: "El archivo no contiene registros.",
        se_puede_cargar: false,
      });
    }

    // Si las columnas no coinciden con la plantilla, cualquier análisis
    // fila por fila sería ruido -- se corta aquí con un mensaje claro.
    const columnasEsperadas = ["nombre", "telefono", "direccion", "lat", "lng", "distrito"];
    const columnasEncontradas = Object.keys(registros[0]);
    const columnasFaltantes = columnasEsperadas.filter((c) => !columnasEncontradas.includes(c));
    if (columnasFaltantes.length > 0) {
      return res.json({
        total_filas: registros.length,
        error_estructura:
          `No se reconocen estas columnas: ${columnasFaltantes.join(", ")}. ` +
          `Columnas encontradas en el archivo: ${columnasEncontradas.join(", ")}. ` +
          `Si armaste el archivo en Excel, revisa que el separador sea coma (,) y no punto y coma (;), ` +
          `y que los encabezados coincidan exactamente con la plantilla.`,
        se_puede_cargar: false,
      });
    }

    // Distritos conocidos, solo si la tabla ubigeo ya fue poblada.
    let distritosConocidos = null;
    try {
      const [filasUbigeo] = await pool.query(`SELECT DISTINCT NOMBDIST FROM ubigeo`);
      if (filasUbigeo.length > 0) {
        distritosConocidos = new Set(filasUbigeo.map((f) => f.NOMBDIST.trim().toUpperCase()));
      }
    } catch (e) {
      distritosConocidos = null; // la tabla no existe todavía -- se omite esta validación
    }

    // Teléfonos que ya están en la base, para avisar de clientes repetidos.
    const telefonosArchivo = [...new Set(registros.map((r) => (r.telefono || "").trim()).filter(Boolean))];
    let telefonosExistentes = new Set();
    if (telefonosArchivo.length > 0) {
      const [filasExistentes] = await pool.query(
        `SELECT DISTINCT telefono FROM leads_base WHERE telefono IN (?)`,
        [telefonosArchivo]
      );
      telefonosExistentes = new Set(filasExistentes.map((f) => f.telefono));
    }

    const vistoPorTelefono = new Map();
    const vistoPorNombreDireccion = new Map();
    const filasBloqueantes = [];
    const filasAdvertencia = [];
    const distritosNoReconocidos = new Set();
    let yaExistentesCount = 0;
    let duplicadosInternosCount = 0;

    registros.forEach((r, idx) => {
      const numeroFila = idx + 2; // +1 por índice base 0, +1 por la fila de encabezado
      const problemas = [];
      let esBloqueante = false;

      const nombre = (r.nombre || "").trim();
      if (!nombre) {
        problemas.push("Nombre vacío (obligatorio)");
        esBloqueante = true;
      }

      const latTexto = (r.lat || "").toString().trim();
      const lngTexto = (r.lng || "").toString().trim();
      const latNum = latTexto === "" ? null : Number(latTexto);
      const lngNum = lngTexto === "" ? null : Number(lngTexto);

      if (latTexto !== "" && Number.isNaN(latNum)) {
        problemas.push(`Latitud no numérica: "${latTexto}"`);
        esBloqueante = true;
      }
      if (lngTexto !== "" && Number.isNaN(lngNum)) {
        problemas.push(`Longitud no numérica: "${lngTexto}"`);
        esBloqueante = true;
      }
      if (!esBloqueante && latNum !== null && lngNum !== null) {
        if (latNum === 0 && lngNum === 0) {
          problemas.push("Coordenadas en (0,0) — probablemente vacías o mal exportadas");
        } else if (latNum < -56 || latNum > 0 || lngNum < -82 || lngNum > -66) {
          problemas.push("Coordenadas fuera del rango esperado para Perú/Chile — revisa si lat/lng están invertidos");
        }
      }

      const telefono = (r.telefono || "").trim();
      if (telefono) {
        const soloDigitos = telefono.replace(/\D/g, "");
        if (soloDigitos !== telefono || soloDigitos.length < 7 || soloDigitos.length > 9) {
          problemas.push(`Teléfono con formato dudoso: "${telefono}"`);
        }
        if (telefonosExistentes.has(telefono)) {
          yaExistentesCount++;
          problemas.push("Este teléfono ya existe en tu base de clientes");
        }
        if (vistoPorTelefono.has(telefono)) {
          duplicadosInternosCount++;
          problemas.push(`Teléfono duplicado dentro del archivo (también en la fila ${vistoPorTelefono.get(telefono)})`);
        } else {
          vistoPorTelefono.set(telefono, numeroFila);
        }
      }

      const direccion = (r.direccion || "").trim();
      if (nombre && direccion) {
        const clave = `${nombre.toUpperCase()}|${direccion.toUpperCase()}`;
        if (vistoPorNombreDireccion.has(clave)) {
          duplicadosInternosCount++;
          problemas.push(`Nombre + dirección duplicados dentro del archivo (también en la fila ${vistoPorNombreDireccion.get(clave)})`);
        } else {
          vistoPorNombreDireccion.set(clave, numeroFila);
        }
      }

      const distrito = (r.distrito || "").trim();
      if (distrito && distritosConocidos && !distritosConocidos.has(distrito.toUpperCase())) {
        problemas.push(`Distrito "${distrito}" no coincide con ningún distrito conocido (revisa si tiene un error de tipeo)`);
        distritosNoReconocidos.add(distrito);
      }

      if (problemas.length > 0) {
        const filaReporte = { fila: numeroFila, nombre: nombre || "(vacío)", problemas };
        if (esBloqueante) filasBloqueantes.push(filaReporte);
        else filasAdvertencia.push(filaReporte);
      }
    });

    res.json({
      total_filas: registros.length,
      filas_limpias: registros.length - filasBloqueantes.length - filasAdvertencia.length,
      filas_bloqueantes: filasBloqueantes,
      filas_advertencia: filasAdvertencia,
      resumen: {
        ya_existentes: yaExistentesCount,
        duplicados_internos: duplicadosInternosCount,
        distritos_no_reconocidos: [...distritosNoReconocidos],
        ubigeo_disponible: distritosConocidos !== null,
      },
      se_puede_cargar: filasBloqueantes.length === 0,
    });
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Error al analizar el archivo" });
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
            l.proxima_cita,
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

/**
 * Previsualiza si una carga puede deshacerse sin pérdida de datos: solo
 * es seguro si ninguno de sus leads fue asignado a un vendedor todavía
 * (nadie trabajó esos clientes). Se usa antes de mostrar el botón
 * "Deshacer" para no borrar trabajo real por accidente.
 */
async function previsualizarDeshacerCarga(req, res) {
  const { id } = req.params;
  try {
    const [[carga]] = await pool.query(`SELECT id, nombre_archivo, total_registros FROM bases_cargadas WHERE id = ?`, [id]);
    if (!carga) return res.status(404).json({ error: "Carga no encontrada" });

    const [[conteo]] = await pool.query(
      `SELECT
         COUNT(*) AS total_leads,
         SUM(CASE WHEN l.vendedor_id IS NOT NULL THEN 1 ELSE 0 END) AS leads_asignados
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE lb.carga_id = ?`,
      [id]
    );

    res.json({
      carga,
      total_leads_generados: conteo.total_leads,
      leads_asignados: conteo.leads_asignados || 0,
      se_puede_deshacer: Number(conteo.leads_asignados) === 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al previsualizar la carga" });
  }
}

/**
 * Elimina por completo una carga (bases_cargadas + leads_base + leads
 * generados) para cuando se subió el CSV equivocado. Solo se permite si
 * ningún lead de esa carga fue asignado todavía a un vendedor -- una vez
 * que un vendedor tiene ese cliente en su cartera, ya no es una simple
 * "carga de prueba" y no se debe borrar silenciosamente (ver la
 * convención de solo-INSERT documentada en leads_base).
 */
async function deshacerCarga(req, res) {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    const [[carga]] = await conn.query(`SELECT id FROM bases_cargadas WHERE id = ?`, [id]);
    if (!carga) {
      conn.release();
      return res.status(404).json({ error: "Carga no encontrada" });
    }

    const [[conteo]] = await conn.query(
      `SELECT COUNT(*) AS asignados
       FROM leads l JOIN leads_base lb ON lb.id = l.lead_base_id
       WHERE lb.carga_id = ? AND l.vendedor_id IS NOT NULL`,
      [id]
    );
    if (Number(conteo.asignados) > 0) {
      conn.release();
      return res.status(400).json({
        error: "No se puede deshacer: algunos leads de esta carga ya fueron asignados a un vendedor.",
      });
    }

    await conn.beginTransaction();
    await conn.query(
      `DELETE l FROM leads l JOIN leads_base lb ON lb.id = l.lead_base_id WHERE lb.carga_id = ?`,
      [id]
    );
    await conn.query(`DELETE FROM leads_base WHERE carga_id = ?`, [id]);
    await conn.query(`DELETE FROM bases_cargadas WHERE id = ?`, [id]);
    await conn.commit();

    res.json({ success: true, mensaje: "Carga deshecha correctamente" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al deshacer la carga" });
  } finally {
    conn.release();
  }
}

/**
 * Reasigna TODA la cartera activa de un vendedor a otro de una vez (por
 * ejemplo, cuando un vendedor deja de operar una zona). Por defecto solo
 * mueve los leads en los que todavía hay algo por hacer (asignado,
 * contactado); si se pide incluir_finalizados, también mueve los ya
 * vendidos/descartados.
 */
async function reasignarCarteraCompleta(req, res) {
  const { vendedor_origen_id, vendedor_destino_id, incluir_finalizados } = req.body;
  const adminId = req.usuario.id;

  if (!vendedor_origen_id || !vendedor_destino_id) {
    return res.status(400).json({ error: "vendedor_origen_id y vendedor_destino_id son requeridos" });
  }
  if (String(vendedor_origen_id) === String(vendedor_destino_id)) {
    return res.status(400).json({ error: "El vendedor de origen y destino no pueden ser el mismo" });
  }

  const conn = await pool.getConnection();
  try {
    const [[destino]] = await conn.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor' AND activo = 1`,
      [vendedor_destino_id]
    );
    if (!destino) {
      conn.release();
      return res.status(404).json({ error: "Vendedor destino no encontrado o inactivo" });
    }

    const estados = incluir_finalizados
      ? ["asignado", "contactado", "vendido", "descartado"]
      : ["asignado", "contactado"];

    const [leads] = await conn.query(
      `SELECT id FROM leads WHERE vendedor_id = ? AND estado IN (?)`,
      [vendedor_origen_id, estados]
    );
    if (leads.length === 0) {
      conn.release();
      return res.json({ success: true, mensaje: "Ese vendedor no tiene leads para reasignar con los filtros elegidos", total: 0 });
    }

    const ids = leads.map((l) => l.id);
    await conn.beginTransaction();

    await conn.query(
      `UPDATE leads SET vendedor_id = ?, fecha_asignacion = NOW() WHERE id IN (?)`,
      [vendedor_destino_id, ids]
    );
    await conn.query(
      `INSERT INTO asignaciones (lead_id, vendedor_id, asignado_por, tipo) VALUES ${ids.map(() => "(?, ?, ?, 'manual')").join(", ")}`,
      ids.flatMap((leadId) => [leadId, vendedor_destino_id, adminId])
    );

    await conn.commit();
    res.json({ success: true, mensaje: `${ids.length} leads reasignados`, total: ids.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al reasignar la cartera" });
  } finally {
    conn.release();
  }
}

/**
 * Detecta posibles clientes duplicados dentro de la misma zona (mismo
 * teléfono, o mismo nombre + dirección) -- típico de una base cargada
 * dos veces por error. Se usa para armar la pantalla "Fusionar leads".
 */
async function detectarLeadsDuplicados(req, res) {
  try {
    const [porTelefono] = await pool.query(`
      SELECT lb.telefono AS clave, GROUP_CONCAT(l.id) AS lead_ids, COUNT(*) AS cantidad
      FROM leads l
      JOIN leads_base lb ON lb.id = l.lead_base_id
      WHERE lb.telefono IS NOT NULL AND lb.telefono != ''
      GROUP BY lb.telefono
      HAVING COUNT(*) > 1
    `);
    const [porNombreDireccion] = await pool.query(`
      SELECT CONCAT(lb.nombre, ' — ', lb.direccion) AS clave, GROUP_CONCAT(l.id) AS lead_ids, COUNT(*) AS cantidad
      FROM leads l
      JOIN leads_base lb ON lb.id = l.lead_base_id
      WHERE lb.direccion IS NOT NULL AND lb.direccion != ''
      GROUP BY lb.nombre, lb.direccion
      HAVING COUNT(*) > 1
    `);

    const grupos = [...porTelefono, ...porNombreDireccion].map((g) => ({
      clave: g.clave,
      lead_ids: g.lead_ids.split(",").map(Number),
    }));

    if (grupos.length === 0) return res.json([]);

    const todosIds = [...new Set(grupos.flatMap((g) => g.lead_ids))];
    const [detalles] = await pool.query(
      `SELECT l.id, l.estado, lb.nombre, lb.telefono, lb.direccion, u.nombre AS vendedor
       FROM leads l
       JOIN leads_base lb ON lb.id = l.lead_base_id
       LEFT JOIN usuarios u ON u.id = l.vendedor_id
       WHERE l.id IN (?)`,
      [todosIds]
    );
    const porId = Object.fromEntries(detalles.map((d) => [d.id, d]));

    const resultado = grupos.map((g) => ({
      clave: g.clave,
      leads: g.lead_ids.map((id) => porId[id]).filter(Boolean),
    }));

    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar duplicados" });
  }
}

/**
 * Fusiona dos o más leads duplicados en uno solo (el "sobreviviente"):
 * todo el historial (visitas, ventas, checkpoints) de los leads
 * eliminados se reasigna al sobreviviente antes de borrarlos, para no
 * perder ninguna venta o visita ya registrada.
 */
async function fusionarLeadsDuplicados(req, res) {
  const { lead_sobreviviente_id, lead_ids_a_eliminar } = req.body;

  if (!lead_sobreviviente_id || !Array.isArray(lead_ids_a_eliminar) || lead_ids_a_eliminar.length === 0) {
    return res.status(400).json({ error: "lead_sobreviviente_id y lead_ids_a_eliminar son requeridos" });
  }
  if (lead_ids_a_eliminar.includes(Number(lead_sobreviviente_id))) {
    return res.status(400).json({ error: "El lead sobreviviente no puede estar en la lista a eliminar" });
  }

  const conn = await pool.getConnection();
  try {
    const [[sobreviviente]] = await conn.query(`SELECT id FROM leads WHERE id = ?`, [lead_sobreviviente_id]);
    if (!sobreviviente) {
      conn.release();
      return res.status(404).json({ error: "Lead sobreviviente no encontrado" });
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE visitas SET lead_id = ? WHERE lead_id IN (?)`,
      [lead_sobreviviente_id, lead_ids_a_eliminar]
    );
    await conn.query(
      `UPDATE checkpoints_ubicacion SET referencia_id = ? WHERE tipo_evento = 'visita' AND referencia_id IN (?)`,
      [lead_sobreviviente_id, lead_ids_a_eliminar]
    );
    await conn.query(`DELETE FROM asignaciones WHERE lead_id IN (?)`, [lead_ids_a_eliminar]);
    await conn.query(`DELETE FROM leads WHERE id IN (?)`, [lead_ids_a_eliminar]);

    await recalcularEstadoLeadTrasFusion(conn, lead_sobreviviente_id);

    await conn.commit();
    res.json({ success: true, mensaje: `${lead_ids_a_eliminar.length} leads fusionados en el lead #${lead_sobreviviente_id}` });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al fusionar los leads" });
  } finally {
    conn.release();
  }
}

/**
 * Misma lógica que recalcularEstadoLead en visitasController.js: el
 * estado de un lead depende de su visita más reciente. Se duplica aquí
 * (en vez de importar) porque son módulos independientes y es una
 * función pequeña; si se edita una, revisar la otra.
 */
async function recalcularEstadoLeadTrasFusion(conn, leadId) {
  const [[ultimaVisita]] = await conn.query(
    `SELECT resultado FROM visitas WHERE lead_id = ? ORDER BY fecha DESC LIMIT 1`,
    [leadId]
  );
  let nuevoEstado;
  if (!ultimaVisita) nuevoEstado = "asignado";
  else if (ultimaVisita.resultado === "venta_cerrada") nuevoEstado = "vendido";
  else if (ultimaVisita.resultado === "no_interesado") nuevoEstado = "descartado";
  else nuevoEstado = "contactado";

  await conn.query(`UPDATE leads SET estado = ? WHERE id = ?`, [nuevoEstado, leadId]);
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
  previsualizarDeshacerCarga, deshacerCarga, reasignarCarteraCompleta,
  detectarLeadsDuplicados, fusionarLeadsDuplicados, analizarBase,
};

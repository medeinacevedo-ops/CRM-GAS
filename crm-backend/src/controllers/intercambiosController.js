const pool = require("../config/db");

/**
 * Un vendedor solicita intercambiar una lista especifica de sus leads
 * por la misma cantidad de leads del vendedor destino.
 * Los leads ofrecidos se guardan en 'leads_ofrecidos'.
 */
async function solicitarIntercambio(req, res) {
  const { vendedor_destino_id, lead_ids } = req.body;
  const vendedorOrigenId = req.usuario.id;

  if (!vendedor_destino_id || !lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res.status(400).json({ error: "vendedor_destino_id y una lista de lead_ids son requeridos" });
  }
  if (Number(vendedor_destino_id) === vendedorOrigenId) {
    return res.status(400).json({ error: "No puedes intercambiar leads contigo mismo" });
  }

  try {
    // Validar que los leads pertenecen al origen y estan en estado valido
    const [leadsValidos] = await pool.query(
      `SELECT id FROM leads WHERE id IN (?) AND vendedor_id = ? AND estado IN ('asignado', 'contactado')`,
      [lead_ids, vendedorOrigenId]
    );

    if (leadsValidos.length !== lead_ids.length) {
      return res.status(400).json({ error: "Algunos leads seleccionados no son validos para intercambio" });
    }

    const [[destino]] = await pool.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'vendedor' AND activo = 1`,
      [vendedor_destino_id]
    );
    if (!destino) return res.status(404).json({ error: "Vendedor destino no encontrado" });

    const [result] = await pool.query(
      `INSERT INTO intercambios_leads (vendedor_origen_id, vendedor_destino_id, cantidad, leads_ofrecidos, estado)
       VALUES (?, ?, ?, ?, 'pendiente')`,
      [vendedorOrigenId, vendedor_destino_id, lead_ids.length, lead_ids.join(",")]
    );

    res.status(201).json({ intercambio_id: result.insertId, estado: "pendiente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al solicitar el intercambio" });
  }
}

async function misIntercambios(req, res) {
  const vendedorId = req.usuario.id;
  try {
    const [rows] = await pool.query(
      `SELECT il.id, il.cantidad, il.estado, il.fecha, il.leads_ofrecidos, il.leads_recibidos,
              uo.nombre AS vendedor_origen, uo.id AS vendedor_origen_id,
              ud.nombre AS vendedor_destino, ud.id AS vendedor_destino_id
       FROM intercambios_leads il
       JOIN usuarios uo ON uo.id = il.vendedor_origen_id
       JOIN usuarios ud ON ud.id = il.vendedor_destino_id
       WHERE il.vendedor_origen_id = ? OR il.vendedor_destino_id = ?
       ORDER BY il.fecha DESC`,
      [vendedorId, vendedorId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar los intercambios" });
  }
}

/**
 * Al confirmar, el vendedor destino DEBE enviar la lista de sus leads que entregara a cambio.
 */
async function confirmarIntercambio(req, res) {
  const { id } = req.params;
  const { lead_ids_retorno } = req.body;
  const vendedorId = req.usuario.id;

  if (!lead_ids_retorno || !Array.isArray(lead_ids_retorno)) {
    return res.status(400).json({ error: "Debes seleccionar los leads que entregaras a cambio" });
  }

  const conn = await pool.getConnection();
  try {
    const [[intercambio]] = await conn.query(
      `SELECT * FROM intercambios_leads WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!intercambio) return res.status(404).json({ error: "Intercambio no encontrado" });
    if (intercambio.vendedor_destino_id !== vendedorId) {
      return res.status(403).json({ error: "Solo el destino puede confirmar" });
    }
    if (intercambio.estado !== "pendiente") {
      return res.status(400).json({ error: "Intercambio ya procesado" });
    }
    if (lead_ids_retorno.length !== intercambio.cantidad) {
      return res.status(400).json({ error: `Debes seleccionar exactamente ${intercambio.cantidad} leads` });
    }

    await conn.beginTransaction();

    // Validar leads de retorno
    const [validosRetorno] = await conn.query(
      `SELECT id FROM leads WHERE id IN (?) AND vendedor_id = ? AND estado IN ('asignado', 'contactado')`,
      [lead_ids_retorno, vendedorId]
    );
    if (validosRetorno.length !== intercambio.cantidad) {
      await conn.rollback();
      return res.status(400).json({ error: "Algunos leads de retorno no son validos" });
    }

    const idsOfrecidos = intercambio.leads_ofrecidos.split(",").map(Number);

    // Mover ofrecidos (Origen -> Destino)
    await conn.query(
      `UPDATE leads SET vendedor_id = ?, fecha_asignacion = NOW() WHERE id IN (?)`,
      [vendedorId, idsOfrecidos]
    );
    // Mover retorno (Destino -> Origen)
    await conn.query(
      `UPDATE leads SET vendedor_id = ?, fecha_asignacion = NOW() WHERE id IN (?)`,
      [intercambio.vendedor_origen_id, lead_ids_retorno]
    );

    await conn.query(
      `UPDATE intercambios_leads SET estado = 'confirmado', leads_recibidos = ? WHERE id = ?`,
      [lead_ids_retorno.join(","), id]
    );

    await conn.commit();
    res.json({ mensaje: "Intercambio realizado con éxito" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error en la transaccion de intercambio" });
  } finally {
    conn.release();
  }
}

async function rechazarIntercambio(req, res) {
  const { id } = req.params;
  const userId = req.usuario.id;
  try {
    // Permitir que tanto el origen (cancelar) como el destino (rechazar) puedan anular la solicitud
    const [result] = await pool.query(
      `UPDATE intercambios_leads
       SET estado = 'rechazado'
       WHERE id = ? AND (vendedor_destino_id = ? OR vendedor_origen_id = ?) AND estado = 'pendiente'`,
      [id, userId, userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "No se pudo anular el intercambio. Verifique que aún esté pendiente." });
    res.json({ mensaje: "Intercambio anulado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al procesar la anulación" });
  }
}

async function listarTodosIntercambios(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT il.id, il.cantidad, il.estado, il.fecha,
              uo.nombre AS vendedor_origen, ud.nombre AS vendedor_destino
       FROM intercambios_leads il
       JOIN usuarios uo ON uo.id = il.vendedor_origen_id
       JOIN usuarios ud ON ud.id = il.vendedor_destino_id
       ORDER BY il.fecha DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar" });
  }
}

module.exports = {
  solicitarIntercambio,
  misIntercambios,
  confirmarIntercambio,
  rechazarIntercambio,
  listarTodosIntercambios,
};

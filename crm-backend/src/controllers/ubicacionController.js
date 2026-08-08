const pool = require("../config/db");
const socket = require("../socket");
const { resolverVendedoresVisibles } = require("./checkpointsController");

// Antiguedad minima entre dos heartbeats guardados del mismo vendedor.
// El frontend puede llamar cada 30-60s; esto es una salvaguarda de servidor
// para que un reintento o un cliente mal configurado no llene la tabla.
const INTERVALO_MINIMO_SEGUNDOS = 20;

/**
 * Recibe un ping de ubicacion del vendedor mientras su jornada esta activa.
 * A diferencia de los checkpoints de evento (ingreso, visita, pausa, salida),
 * el heartbeat es solo para tracking en vivo: se guarda en la misma tabla
 * checkpoints_ubicacion (tipo_evento = 'heartbeat') para no duplicar
 * estructura, y ademas se retransmite por socket.io a los admins/supervisores
 * que tengan abierto el mapa de seguimiento en vivo.
 *
 * Body esperado: { lat, lng }
 */
async function registrarHeartbeat(req, res) {
  const { lat, lng } = req.body;
  const vendedorId = req.usuario.id;

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: "lat y lng son obligatorios y deben ser numericos" });
  }

  try {
    const [[jornada]] = await pool.query(
      `SELECT id FROM jornadas
       WHERE vendedor_id = ? AND fecha = DATE(NOW()) AND hora_salida IS NULL`,
      [vendedorId]
    );
    if (!jornada) {
      return res.status(400).json({ error: "No tienes una jornada activa, no se registra ubicacion en vivo" });
    }

    const [[ultimo]] = await pool.query(
      `SELECT hora FROM checkpoints_ubicacion
       WHERE vendedor_id = ? AND tipo_evento = 'heartbeat'
       ORDER BY hora DESC LIMIT 1`,
      [vendedorId]
    );

    let guardado = false;
    if (!ultimo || segundosDesde(ultimo.hora) >= INTERVALO_MINIMO_SEGUNDOS) {
      await pool.query(
        `INSERT INTO checkpoints_ubicacion (vendedor_id, jornada_id, tipo_evento, lat, lng)
         VALUES (?, ?, 'heartbeat', ?, ?)`,
        [vendedorId, jornada.id, latNum, lngNum]
      );
      guardado = true;
    }

    // Se retransmite siempre (aunque no se haya insertado), para que el mapa
    // en vivo se sienta fluido sin depender del intervalo de guardado.
    try {
      socket.getIo().to("monitoreo_ubicacion").emit("ubicacion:heartbeat", {
        vendedor_id: vendedorId,
        lat: latNum,
        lng: lngNum,
        hora: new Date().toISOString(),
      });
    } catch (socketErr) {
      // Si socket.io aun no fue inicializado o falla la emision, no debe
      // tumbar la respuesta HTTP: el guardado en BD ya se completo.
      console.error("No se pudo retransmitir el heartbeat por socket:", socketErr.message);
    }

    res.json({ success: true, guardado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar el heartbeat de ubicacion" });
  }
}

/**
 * Devuelve la ultima posicion conocida de cada vendedor visible para el
 * usuario que consulta (mismo modelo de permisos que el historial de
 * checkpoints), para pintar el mapa de seguimiento en vivo al cargar la
 * pantalla. Las actualizaciones posteriores llegan por el socket
 * 'ubicacion:heartbeat', esta ruta es solo la carga inicial.
 */
async function obtenerUbicacionesEnVivo(req, res) {
  try {
    const vendedoresVisibles = await resolverVendedoresVisibles(req.usuario);

    if (vendedoresVisibles !== null && vendedoresVisibles.length === 0) {
      return res.status(403).json({
        error: "No tienes permiso de ubicación otorgado todavía. Pide al administrador que te lo habilite.",
      });
    }

    const condicionVendedores =
      vendedoresVisibles !== null
        ? `AND c.vendedor_id IN (${vendedoresVisibles.map(() => "?").join(",")})`
        : "";
    const valores = vendedoresVisibles !== null ? [...vendedoresVisibles] : [];

    // Ultimo heartbeat (o, en su defecto, el ultimo checkpoint de cualquier
    // tipo) por vendedor con jornada activa hoy -- si ya marco salida no
    // tiene sentido mostrarlo "en vivo".
    const [rows] = await pool.query(
      `SELECT c.vendedor_id, u.nombre AS vendedor, c.lat, c.lng, c.hora
       FROM checkpoints_ubicacion c
       JOIN usuarios u ON u.id = c.vendedor_id
       JOIN jornadas j ON j.vendedor_id = c.vendedor_id
                       AND j.fecha = DATE(NOW()) AND j.hora_salida IS NULL
       WHERE c.id IN (
         SELECT MAX(c2.id) FROM checkpoints_ubicacion c2
         WHERE c2.vendedor_id = c.vendedor_id
         GROUP BY c2.vendedor_id
       )
       ${condicionVendedores}
       ORDER BY c.hora DESC`,
      valores
    );

    res.json({ resultados: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener las ubicaciones en vivo" });
  }
}

function segundosDesde(fechaMysql) {
  const entonces = new Date(fechaMysql.replace(" ", "T"));
  return (Date.now() - entonces.getTime()) / 1000;
}

module.exports = { registrarHeartbeat, obtenerUbicacionesEnVivo };

const cron = require("node-cron");
const pool = require("../config/db");

/**
 * Tarea programada para cerrar jornadas y pausas olvidadas a la medianoche.
 */
async function cerrarEventosPendientes() {
  console.log("[Cron] Iniciando cierre automatico de eventos pendientes...");
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Cerrar pausas abiertas de dias anteriores
    // Ponemos como hora de fin las 23:59:59 del dia en que inicio
    const [pausas] = await conn.query(
      `UPDATE registros_pausas
       SET hora_fin = CONCAT(DATE(hora_inicio), ' 23:59:59')
       WHERE hora_fin IS NULL AND DATE(hora_inicio) < CURDATE()`
    );
    if (pausas.affectedRows > 0) {
      console.log(`[Cron] Se cerraron ${pausas.affectedRows} pausas pendientes.`);
    }

    // 2. Cerrar jornadas abiertas de dias anteriores
    // Ponemos como hora de salida las 23:59:59 de ese dia
    const [jornadas] = await conn.query(
      `UPDATE jornadas
       SET hora_salida = CONCAT(fecha, ' 23:59:59')
       WHERE hora_salida IS NULL AND fecha < CURDATE()`
    );
    if (jornadas.affectedRows > 0) {
      console.log(`[Cron] Se cerraron ${jornadas.affectedRows} jornadas pendientes.`);

      // 3. Recalcular tiempo activo total para las jornadas recien cerradas
      await conn.query(
        `UPDATE jornadas
         SET tiempo_activo_total = TIMESTAMPDIFF(MINUTE, hora_ingreso, hora_salida)
         WHERE tiempo_activo_total IS NULL AND hora_salida IS NOT NULL`
      );
    }

    await conn.commit();
    console.log("[Cron] Cierre automatico completado con éxito.");
  } catch (err) {
    await conn.rollback();
    console.error("[Cron] Error en el cierre automatico:", err);
  } finally {
    conn.release();
  }
}

// Programar para que corra todos los dias a las 00:05 AM
cron.schedule("5 0 * * *", () => {
  cerrarEventosPendientes();
});

// Tambien exportamos para poder llamarlo al iniciar el servidor (opcional)
module.exports = { cerrarEventosPendientes };

const cron = require("node-cron");
const pool = require("../config/db");
const { cerrarEventosPendientes } = require("../utils/cierreAutomatico");

/**
 * Tarea programada para cerrar jornadas y pausas olvidadas a la medianoche.
 *
 * IMPORTANTE (leer utils/cierreAutomatico.js): en Render free, esto solo
 * corre si la instancia está despierta a esa hora exacta. Como red de
 * seguridad adicional, el mismo cierre se aplica también de forma
 * perezosa en jornadaController.marcarIngreso -- así que si esta tarea
 * se salta una noche porque el servidor estaba dormido, igual se
 * corrige solo en cuanto el vendedor vuelve a marcar ingreso.
 */
async function ejecutarCierreProgramado() {
  console.log("[Cron] Iniciando cierre automatico de eventos pendientes...");
  try {
    const { pausasCerradas, jornadasCerradas } = await cerrarEventosPendientes(pool);
    if (pausasCerradas > 0) console.log(`[Cron] Se cerraron ${pausasCerradas} pausas pendientes.`);
    if (jornadasCerradas > 0) console.log(`[Cron] Se cerraron ${jornadasCerradas} jornadas pendientes.`);
    console.log("[Cron] Cierre automatico completado con éxito.");
  } catch (err) {
    console.error("[Cron] Error en el cierre automatico:", err);
  }
}

// Programado para correr todos los días a las 00:05 (hora de Perú, ya que
// config/db.js fija el time_zone de sesión a -05:00 en cada conexión).
cron.schedule("5 0 * * *", ejecutarCierreProgramado);

module.exports = { ejecutarCierreProgramado };

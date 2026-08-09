/**
 * Cierra jornadas y pausas que quedaron abiertas de días anteriores,
 * asignándoles como hora de fin las 23:59:59 del día en que iniciaron.
 *
 * Se puede llamar de dos formas:
 *   - Sin `vendedorId`: cierra TODO lo pendiente de TODOS los vendedores
 *     (usado por el cron de medianoche, tasks/autoCloseTask.js).
 *   - Con `vendedorId`: cierra solo lo pendiente de ESE vendedor (usado
 *     de forma "perezosa" justo antes de marcarIngreso -- ver nota abajo).
 *
 * Por qué existe la variante perezosa, y no solo el cron: en Render
 * (plan free), la instancia se "duerme" tras ~15 min sin tráfico. Un
 * cron interno con node-cron SOLO se dispara si el proceso de Node
 * está despierto en ese momento -- si nadie usó la app a la medianoche,
 * la instancia está dormida y el cron simplemente no corre esa noche.
 * Por eso no basta con arreglar el cron: además, cada vez que un
 * vendedor marca ingreso, se revisa y cierra PRIMERO cualquier jornada
 * suya que haya quedado abierta de un día anterior. Así, aunque el cron
 * se haya saltado la medianoche, la próxima vez que ese vendedor abre
 * la app al día siguiente, su día anterior queda cerrado correctamente
 * antes de crear la jornada nueva -- funciona sin depender de que el
 * servidor haya estado despierto a una hora exacta.
 *
 * @param {import("mysql2/promise").Pool | import("mysql2/promise").PoolConnection} conexion
 * @param {{ vendedorId?: number }} opciones
 */
async function cerrarEventosPendientes(conexion, { vendedorId } = {}) {
  const filtroVendedor = vendedorId ? "AND vendedor_id = ?" : "";
  const filtroVendedorJornada = vendedorId ? "AND j.vendedor_id = ?" : "";
  const valoresVendedor = vendedorId ? [vendedorId] : [];

  // 1. Cerrar pausas abiertas de días anteriores (a través de su jornada,
  //    porque registros_pausas no tiene vendedor_id directo).
  const [pausas] = await conexion.query(
    `UPDATE registros_pausas rp
     JOIN jornadas j ON j.id = rp.jornada_id
     SET rp.hora_fin = CONCAT(DATE(rp.hora_inicio), ' 23:59:59')
     WHERE rp.hora_fin IS NULL
       AND DATE(rp.hora_inicio) < CURDATE()
       ${filtroVendedorJornada}`,
    valoresVendedor
  );

  // 2. Cerrar jornadas abiertas de días anteriores.
  const [jornadas] = await conexion.query(
    `UPDATE jornadas
     SET hora_salida = CONCAT(fecha, ' 23:59:59')
     WHERE hora_salida IS NULL
       AND fecha < CURDATE()
       ${filtroVendedor}`,
    valoresVendedor
  );

  // 3. Recalcular tiempo_activo_total para las jornadas recién cerradas
  //    (restando el tiempo que haya estado en pausa ese día).
  if (jornadas.affectedRows > 0) {
    await conexion.query(
      `UPDATE jornadas j
       SET j.tiempo_activo_total = ROUND((
         TIMESTAMPDIFF(SECOND, j.hora_ingreso, j.hora_salida)
         - COALESCE((
             SELECT SUM(TIMESTAMPDIFF(SECOND, rp.hora_inicio, rp.hora_fin))
             FROM registros_pausas rp WHERE rp.jornada_id = j.id
           ), 0)
       ) / 60)
       WHERE j.tiempo_activo_total IS NULL AND j.hora_salida IS NOT NULL
       ${filtroVendedor ? "AND j.vendedor_id = ?" : ""}`,
      valoresVendedor
    );
  }

  return {
    pausasCerradas: pausas.affectedRows,
    jornadasCerradas: jornadas.affectedRows,
  };
}

module.exports = { cerrarEventosPendientes };

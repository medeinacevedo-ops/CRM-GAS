/**
 * Genera un CSV a partir de columnas definidas y filas de datos (arrays de
 * objetos planos). Sin dependencias externas -- csv-parse ya está en el
 * proyecto para LEER csv (carga de leads), pero no hay ninguna libreria
 * para ESCRIBIR, así que se resuelve aquí con un serializador mínimo.
 *
 * Reglas de escape CSV estándar: si un valor contiene coma, comilla o
 * salto de línea, se envuelve en comillas dobles y las comillas internas
 * se duplican.
 */
function escaparValorCsv(valor) {
  if (valor === null || valor === undefined) return "";

  const texto = valor instanceof Date ? valor.toISOString() : String(valor);

  if (/[",\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * @param {{ clave: string, titulo: string }[]} columnas Define el orden y
 *   encabezado de cada columna. `clave` es la propiedad a leer de cada fila.
 * @param {object[]} filas Filas de datos (resultado directo de pool.query, por ejemplo).
 * @returns {string} Contenido CSV completo, listo para enviar como archivo.
 */
function generarCsv(columnas, filas) {
  const encabezado = columnas.map((c) => escaparValorCsv(c.titulo)).join(",");
  const cuerpo = filas
    .map((fila) => columnas.map((c) => escaparValorCsv(fila[c.clave])).join(","))
    .join("\r\n");

  // BOM UTF-8 al inicio: sin esto, Excel en Windows interpreta tildes/ñ
  // como caracteres corruptos al abrir el CSV directamente.
  const BOM = "\uFEFF";
  return BOM + encabezado + "\r\n" + cuerpo;
}

/**
 * Envía el CSV como archivo descargable con el nombre indicado.
 */
function enviarCsv(res, nombreArchivo, columnas, filas) {
  const csv = generarCsv(columnas, filas);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  res.send(csv);
}

module.exports = { generarCsv, enviarCsv };

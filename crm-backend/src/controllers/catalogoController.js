const pool = require("../config/db");
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { leerContenidoCsv } = require("../utils/csv");

/**
 * Lista productos para el panel admin (incluye activos e inactivos) o
 * para la app de vendedores (solo activos, comportamiento por defecto
 * sin cambios). `incluir_inactivos=1` es de uso exclusivo del admin.
 */
async function listarProductos(req, res) {
  const { categoria, q, incluir_inactivos } = req.query;
  const soloActivos = !(incluir_inactivos === "1" && req.usuario.rol === "admin");

  let query = `
    SELECT p.*, i.url as imagen_principal
    FROM productos p
    LEFT JOIN producto_imagenes i ON i.producto_id = p.id AND i.es_principal = 1
    WHERE 1=1
  `;
  const params = [];

  if (soloActivos) {
    query += " AND p.activo = 1";
  }
  if (categoria) {
    query += " AND p.categoria = ?";
    params.push(categoria);
  }
  if (q) {
    query += " AND (p.nombre LIKE ? OR p.codigo LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  query += " ORDER BY p.categoria, p.nombre";

  try {
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el catálogo" });
  }
}

/**
 * Obtiene el detalle de un producto con todas sus imágenes.
 */
async function detalleProducto(req, res) {
  const { id } = req.params;
  try {
    console.log(`[Catalogo] Obteniendo detalle para producto ID: ${id}`);
    const [[producto]] = await pool.query("SELECT * FROM productos WHERE id = ?", [id]);

    if (!producto) {
      console.warn(`[Catalogo] Producto ID ${id} no encontrado`);
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const [imagenes] = await pool.query(
      "SELECT id, url, es_principal FROM producto_imagenes WHERE producto_id = ? ORDER BY es_principal DESC, orden ASC",
      [id]
    );

    console.log(`[Catalogo] Detalle cargado con éxito para ${producto.nombre} (${imagenes.length} imágenes)`);
    res.json({ ...producto, imagenes });
  } catch (err) {
    console.error(`[Catalogo Error] detalleProducto para ID ${id}:`, err);
    res.status(500).json({ error: "Error interno al obtener detalle del producto" });
  }
}

/**
 * Carga masiva de productos desde CSV.
 */
async function importarProductos(req, res) {
  if (!req.file) return res.status(400).json({ error: "Adjunta un CSV" });

  const conn = await pool.getConnection();
  try {
    const contenido = leerContenidoCsv(req.file.path);
    const registros = parse(contenido, { columns: true, skip_empty_lines: true, trim: true });

    if (registros.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "El archivo no contiene registros" });
    }

    // Validar antes de tocar la base: un solo nombre vacío no debe
    // traducirse en un error críptico de MySQL a mitad de la transacción.
    const filaSinNombre = registros.findIndex((r) => !r.nombre || !r.nombre.trim());
    if (filaSinNombre !== -1) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Fila ${filaSinNombre + 2} del CSV: falta el nombre del producto.` });
    }

    await conn.beginTransaction();

    const [carga] = await conn.query(
      "INSERT INTO cargas_productos (nombre_archivo, cargado_por, total_registros) VALUES (?, ?, ?)",
      [req.file.originalname, req.usuario.id, registros.length]
    );
    const cargaId = carga.insertId;

    for (const r of registros) {
      // Usar INSERT ... ON DUPLICATE KEY UPDATE para el código de producto
      const tipoValido = ["Producto", "Tarifa", "Servicio"].includes(r.tipo) ? r.tipo : "Producto";
      await conn.query(`
        INSERT INTO productos (codigo, nombre, categoria, precio_lista, comision, descripcion, especificaciones, marca, unidad, tipo, carga_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          nombre = VALUES(nombre),
          categoria = VALUES(categoria),
          precio_lista = VALUES(precio_lista),
          comision = VALUES(comision),
          descripcion = VALUES(descripcion),
          especificaciones = VALUES(especificaciones),
          marca = VALUES(marca),
          unidad = VALUES(unidad),
          tipo = VALUES(tipo),
          carga_id = VALUES(carga_id)
      `, [
        r.codigo || null,
        r.nombre,
        r.categoria || 'General',
        parseFloat(r.precio || 0),
        parseFloat(r.comision || 0),
        r.descripcion || null,
        JSON.stringify(r),
        r.marca || null,
        r.unidad || null,
        tipoValido,
        cargaId
      ]);
    }

    await conn.commit();
    fs.unlinkSync(req.file.path);
    res.json({ success: true, total: registros.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: `Error en importación: ${err.sqlMessage || err.message}` });
  } finally {
    conn.release();
  }
}

/**
 * Analiza un CSV de catálogo SIN insertar nada -- mismo espíritu que el
 * analizador de bases de leads. Sirve para detectar antes de subir:
 * filas sin nombre, precios/comisiones no numéricos, tipos fuera de la
 * lista fija, y qué códigos ya existen (se actualizarían) vs. cuáles
 * son nuevos.
 */
async function analizarCatalogo(req, res) {
  if (!req.file) return res.status(400).json({ error: "Adjunta un CSV" });

  try {
    const contenido = leerContenidoCsv(req.file.path);
    fs.unlinkSync(req.file.path); // el análisis no conserva el archivo, solo lo lee

    const registros = parse(contenido, { columns: true, skip_empty_lines: true, trim: true });

    if (registros.length === 0) {
      return res.status(400).json({ error: "El archivo no contiene registros" });
    }

    const codigosDelArchivo = registros.map((r) => r.codigo).filter(Boolean);
    let codigosExistentes = new Set();
    if (codigosDelArchivo.length > 0) {
      const [rows] = await pool.query(
        `SELECT codigo FROM productos WHERE codigo IN (${codigosDelArchivo.map(() => "?").join(",")})`,
        codigosDelArchivo
      );
      codigosExistentes = new Set(rows.map((r) => r.codigo));
    }

    const errores = [];
    const advertencias = [];
    let nuevos = 0;
    let actualizaciones = 0;
    const codigosVistosEnArchivo = new Set();

    registros.forEach((r, i) => {
      const fila = i + 2; // +1 por índice 0, +1 por la fila de encabezado

      if (!r.nombre || !r.nombre.trim()) {
        errores.push(`Fila ${fila}: falta el nombre del producto.`);
      }
      if (r.precio && isNaN(parseFloat(r.precio))) {
        errores.push(`Fila ${fila}: el precio "${r.precio}" no es un número válido.`);
      }
      if (r.comision && isNaN(parseFloat(r.comision))) {
        errores.push(`Fila ${fila}: la comisión "${r.comision}" no es un número válido.`);
      }
      if (r.tipo && !["Producto", "Tarifa", "Servicio"].includes(r.tipo)) {
        advertencias.push(`Fila ${fila}: tipo "${r.tipo}" no es válido, se guardará como "Producto".`);
      }
      if (r.codigo) {
        if (codigosVistosEnArchivo.has(r.codigo)) {
          advertencias.push(`Fila ${fila}: código "${r.codigo}" repetido dentro del mismo archivo -- solo quedará la última fila con ese código.`);
        }
        codigosVistosEnArchivo.add(r.codigo);

        if (codigosExistentes.has(r.codigo)) actualizaciones++;
        else nuevos++;
      } else {
        nuevos++; // sin código, siempre se inserta como producto nuevo
      }
    });

    res.json({
      total_filas: registros.length,
      nuevos,
      actualizaciones,
      errores,
      advertencias,
      se_puede_subir: errores.length === 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al analizar el archivo: ${err.message}` });
  }
}

/**
 * Lista las categorías existentes para filtros.
 */
async function listarCategorias(req, res) {
  try {
    const [rows] = await pool.query("SELECT DISTINCT categoria FROM productos WHERE activo = 1 ORDER BY categoria");
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ error: "Error" });
  }
}

/**
 * Crea un producto manualmente (sin pasar por CSV).
 */
async function crearProducto(req, res) {
  const { codigo, nombre, categoria, precio_lista, comision, descripcion, marca, unidad, tipo } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });

  try {
    const [result] = await pool.query(
      `INSERT INTO productos (codigo, nombre, categoria, precio_lista, comision, descripcion, marca, unidad, tipo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigo || null,
        nombre,
        categoria || "General",
        parseFloat(precio_lista) || 0,
        parseFloat(comision) || 0,
        descripcion || null,
        marca || null,
        unidad || null,
        tipo || "Producto",
      ]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Ya existe un producto con ese código" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear el producto" });
  }
}

/**
 * Edita los datos de un producto existente.
 */
async function actualizarProducto(req, res) {
  const { id } = req.params;
  const { codigo, nombre, categoria, precio_lista, comision, descripcion, marca, unidad, tipo } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });

  try {
    const [result] = await pool.query(
      `UPDATE productos SET codigo = ?, nombre = ?, categoria = ?, precio_lista = ?, comision = ?, descripcion = ?,
         marca = ?, unidad = ?, tipo = ?
       WHERE id = ?`,
      [
        codigo || null,
        nombre,
        categoria || "General",
        parseFloat(precio_lista) || 0,
        parseFloat(comision) || 0,
        descripcion || null,
        marca || null,
        unidad || null,
        tipo || "Producto",
        id,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Ya existe un producto con ese código" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
}

/**
 * Activa o desactiva un producto (borrado seguro: deja de verse en la
 * app de vendedores pero conserva su historial e imágenes).
 */
async function cambiarEstadoProducto(req, res) {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    await pool.query("UPDATE productos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado" });
  }
}

/**
 * Elimina un producto por completo (sus imágenes se borran en cascada
 * por la FK). Pensado para productos cargados por error, ej. duplicados
 * de una importación con el código mal escrito.
 */
async function eliminarProducto(req, res) {
  const { id } = req.params;
  try {
    const [result] = await pool.query("DELETE FROM productos WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
}

/**
 * Sube una imagen para un producto. Con Cloudinary configurado,
 * req.file.path ya es la URL pública final (CloudinaryStorage la deja
 * ahí en vez de una ruta de disco). Si es el primer archivo del
 * producto, se marca automáticamente como principal.
 */
async function subirImagenProducto(req, res) {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: "Adjunta una imagen" });

  try {
    const [[producto]] = await pool.query("SELECT id FROM productos WHERE id = ?", [id]);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

    const [[{ total }]] = await pool.query(
      "SELECT COUNT(*) as total FROM producto_imagenes WHERE producto_id = ?",
      [id]
    );
    const esPrimera = Number(total) === 0;

    const [result] = await pool.query(
      "INSERT INTO producto_imagenes (producto_id, url, es_principal) VALUES (?, ?, ?)",
      [id, req.file.path, esPrimera ? 1 : 0]
    );

    res.status(201).json({ success: true, id: result.insertId, url: req.file.path, es_principal: esPrimera });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al subir la imagen" });
  }
}

/**
 * Elimina una imagen de un producto. Si era la principal, promueve
 * automáticamente a otra (la más antigua que quede) para que el
 * producto no se quede sin foto de portada en la app.
 */
async function eliminarImagenProducto(req, res) {
  const { id, imagenId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[imagen]] = await conn.query(
      "SELECT id, es_principal FROM producto_imagenes WHERE id = ? AND producto_id = ?",
      [imagenId, id]
    );
    if (!imagen) {
      await conn.rollback();
      return res.status(404).json({ error: "Imagen no encontrada" });
    }

    await conn.query("DELETE FROM producto_imagenes WHERE id = ?", [imagenId]);

    if (imagen.es_principal) {
      const [[siguiente]] = await conn.query(
        "SELECT id FROM producto_imagenes WHERE producto_id = ? ORDER BY orden ASC, id ASC LIMIT 1",
        [id]
      );
      if (siguiente) {
        await conn.query("UPDATE producto_imagenes SET es_principal = 1 WHERE id = ?", [siguiente.id]);
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la imagen" });
  } finally {
    conn.release();
  }
}

/**
 * Marca una imagen como la principal del producto (la que se ve en la
 * lista/tarjeta), quitando ese estado de cualquier otra que lo tuviera.
 */
async function marcarImagenPrincipal(req, res) {
  const { id, imagenId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE producto_imagenes SET es_principal = 0 WHERE producto_id = ?", [id]);
    const [result] = await conn.query(
      "UPDATE producto_imagenes SET es_principal = 1 WHERE id = ? AND producto_id = ?",
      [imagenId, id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Imagen no encontrada" });
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al marcar la imagen principal" });
  } finally {
    conn.release();
  }
}

/**
 * Historial de cargas masivas de catálogo (mismo espíritu que el
 * historial de cargas de leads). Incluye cuántos productos siguen
 * asociados a cada carga (productos.carga_id) para poder mostrar el
 * botón "Deshacer" solo donde tiene sentido.
 */
async function historialCargasProductos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT cp.id, cp.nombre_archivo, cp.total_registros, cp.fecha_carga, u.nombre as cargado_por,
              (SELECT COUNT(*) FROM productos p WHERE p.carga_id = cp.id) as productos_vigentes
       FROM cargas_productos cp
       LEFT JOIN usuarios u ON u.id = cp.cargado_por
       ORDER BY cp.fecha_carga DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el historial" });
  }
}

/**
 * Previsualiza qué implica deshacer una carga de catálogo: cuántos
 * productos siguen vigentes con ese carga_id (pueden ser menos que el
 * total original si un producto se re-cargó después en otra carga) y
 * cuántos de ellos ya tienen fotos subidas -- eso es lo único que se
 * protege, porque es trabajo manual real que no está en el CSV.
 */
async function previsualizarDeshacerCargaCatalogo(req, res) {
  const { id } = req.params;
  try {
    const [[carga]] = await pool.query("SELECT id, nombre_archivo FROM cargas_productos WHERE id = ?", [id]);
    if (!carga) return res.status(404).json({ error: "Carga no encontrada" });

    const [[conteo]] = await pool.query(
      `SELECT
         COUNT(*) as total_productos,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM producto_imagenes pi WHERE pi.producto_id = p.id) THEN 1 ELSE 0 END) as con_imagenes
       FROM productos p WHERE p.carga_id = ?`,
      [id]
    );

    res.json({
      carga,
      total_productos: conteo.total_productos,
      con_imagenes: conteo.con_imagenes || 0,
      se_puede_deshacer: Number(conteo.con_imagenes) === 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al previsualizar la carga" });
  }
}

/**
 * Elimina los productos que quedan vinculados a una carga de catálogo
 * (y la carga misma). Se bloquea si alguno de esos productos ya tiene
 * fotos subidas, para no perder ese trabajo manual en silencio.
 */
async function deshacerCargaCatalogo(req, res) {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    const [[carga]] = await conn.query("SELECT id FROM cargas_productos WHERE id = ?", [id]);
    if (!carga) {
      conn.release();
      return res.status(404).json({ error: "Carga no encontrada" });
    }

    const [[conteo]] = await conn.query(
      `SELECT COUNT(*) as con_imagenes
       FROM productos p
       WHERE p.carga_id = ? AND EXISTS (SELECT 1 FROM producto_imagenes pi WHERE pi.producto_id = p.id)`,
      [id]
    );
    if (Number(conteo.con_imagenes) > 0) {
      conn.release();
      return res.status(400).json({
        error: "No se puede deshacer: algunos productos de esta carga ya tienen fotos subidas.",
      });
    }

    await conn.beginTransaction();
    // producto_imagenes se borra en cascada por la FK, pero como ya
    // validamos que no hay ninguna, este DELETE de productos alcanza.
    await conn.query("DELETE FROM productos WHERE carga_id = ?", [id]);
    await conn.query("DELETE FROM cargas_productos WHERE id = ?", [id]);
    await conn.commit();

    res.json({ success: true, mensaje: "Carga de catálogo deshecha correctamente" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al deshacer la carga" });
  } finally {
    conn.release();
  }
}

module.exports = {
  listarProductos,
  detalleProducto,
  importarProductos,
  analizarCatalogo,
  listarCategorias,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  eliminarProducto,
  subirImagenProducto,
  eliminarImagenProducto,
  marcarImagenPrincipal,
  historialCargasProductos,
  previsualizarDeshacerCargaCatalogo,
  deshacerCargaCatalogo,
};

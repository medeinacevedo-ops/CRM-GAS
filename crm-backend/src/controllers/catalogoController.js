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
    const [[producto]] = await pool.query("SELECT * FROM productos WHERE id = ?", [id]);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

    const [imagenes] = await pool.query(
      "SELECT id, url, es_principal FROM producto_imagenes WHERE producto_id = ? ORDER BY es_principal DESC, orden ASC",
      [id]
    );

    res.json({ ...producto, imagenes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener detalle del producto" });
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

    await conn.beginTransaction();

    const [carga] = await conn.query(
      "INSERT INTO cargas_productos (nombre_archivo, cargado_por, total_registros) VALUES (?, ?, ?)",
      [req.file.originalname, req.usuario.id, registros.length]
    );

    for (const r of registros) {
      // Usar INSERT ... ON DUPLICATE KEY UPDATE para el código de producto
      const tipoValido = ["Producto", "Tarifa", "Servicio"].includes(r.tipo) ? r.tipo : "Producto";
      await conn.query(`
        INSERT INTO productos (codigo, nombre, categoria, precio_lista, comision, descripcion, especificaciones, marca, unidad, tipo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          nombre = VALUES(nombre),
          categoria = VALUES(categoria),
          precio_lista = VALUES(precio_lista),
          comision = VALUES(comision),
          descripcion = VALUES(descripcion),
          especificaciones = VALUES(especificaciones),
          marca = VALUES(marca),
          unidad = VALUES(unidad),
          tipo = VALUES(tipo)
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
        tipoValido
      ]);
    }

    await conn.commit();
    fs.unlinkSync(req.file.path);
    res.json({ success: true, total: registros.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error en importación" });
  } finally {
    conn.release();
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
 * historial de cargas de leads).
 */
async function historialCargasProductos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT cp.id, cp.nombre_archivo, cp.total_registros, cp.fecha_carga, u.nombre as cargado_por
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

module.exports = {
  listarProductos,
  detalleProducto,
  importarProductos,
  listarCategorias,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  eliminarProducto,
  subirImagenProducto,
  eliminarImagenProducto,
  marcarImagenPrincipal,
  historialCargasProductos,
};

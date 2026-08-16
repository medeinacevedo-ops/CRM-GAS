const pool = require("../config/db");
const fs = require("fs");
const { parse } = require("csv-parse/sync");

/**
 * Lista todos los productos activos con su imagen principal.
 */
async function listarProductos(req, res) {
  const { categoria, q } = req.query;
  let query = `
    SELECT p.*, i.url as imagen_principal
    FROM productos p
    LEFT JOIN producto_imagenes i ON i.producto_id = p.id AND i.es_principal = 1
    WHERE p.activo = 1
  `;
  const params = [];

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
    const contenido = fs.readFileSync(req.file.path, "utf8");
    const registros = parse(contenido, { columns: true, skip_empty_lines: true, trim: true });

    await conn.beginTransaction();

    const [carga] = await conn.query(
      "INSERT INTO cargas_productos (nombre_archivo, cargado_por, total_registros) VALUES (?, ?, ?)",
      [req.file.originalname, req.usuario.id, registros.length]
    );

    for (const r of registros) {
      // Usar INSERT ... ON DUPLICATE KEY UPDATE para el código de producto
      await conn.query(`
        INSERT INTO productos (codigo, nombre, categoria, precio_lista, comision, descripcion, especificaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          nombre = VALUES(nombre),
          categoria = VALUES(categoria),
          precio_lista = VALUES(precio_lista),
          comision = VALUES(comision),
          descripcion = VALUES(descripcion),
          especificaciones = VALUES(especificaciones)
      `, [
        r.codigo || null,
        r.nombre,
        r.categoria || 'General',
        parseFloat(r.precio || 0),
        parseFloat(r.comision || 0),
        r.descripcion || null,
        JSON.stringify(r)
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

module.exports = { listarProductos, detalleProducto, importarProductos, listarCategorias };

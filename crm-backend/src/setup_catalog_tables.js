require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function setup() {
  try {
    console.log("Iniciando configuración de tablas de catálogo...");

    // 1. Tabla de Productos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        codigo          VARCHAR(100) UNIQUE,
        nombre          VARCHAR(255) NOT NULL,
        categoria       VARCHAR(100),
        precio_lista    DECIMAL(10,2) DEFAULT 0.00,
        comision        DECIMAL(10,2) DEFAULT 0.00,
        descripcion     TEXT,
        especificaciones JSON NULL,
        activo          TINYINT(1) DEFAULT 1,
        creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'productos' lista.");

    // 2. Tabla de Imágenes de Productos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS producto_imagenes (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        producto_id     INT NOT NULL,
        url             VARCHAR(500) NOT NULL,
        es_principal    TINYINT(1) DEFAULT 0,
        orden           INT DEFAULT 0,
        creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_imagen_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'producto_imagenes' lista.");

    // 3. Tabla para cargar bases de productos (similar a leads)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cargas_productos (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        nombre_archivo  VARCHAR(255),
        cargado_por     INT,
        total_registros INT,
        fecha_carga     DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_carga_prod_user FOREIGN KEY (cargado_por) REFERENCES usuarios(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Tabla 'cargas_productos' lista.");

  } catch (err) {
    console.error("Error al configurar catálogo:", err);
  } finally {
    process.exit();
  }
}
setup();

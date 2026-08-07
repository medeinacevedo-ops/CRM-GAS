const mysql = require("mysql2/promise");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const localConfig = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "crm_ventas_campo"
};

const remoteConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
};

async function migrate() {
  let localConn, remoteConn;
  try {
    console.log("Conectando a bases de datos...");
    localConn = await mysql.createConnection(localConfig);
    remoteConn = await mysql.createConnection(remoteConfig);
    console.log("Conexión exitosa.");

    await remoteConn.query("SET FOREIGN_KEY_CHECKS = 0");

    const tables = [
      "zonas", "usuarios", "permisos_supervisor", "bases_cargadas",
      "leads_base", "leads", "asignaciones", "intercambios_leads",
      "visitas", "ventas", "jornadas", "catalogo_pausas",
      "registros_pausas", "checkpoints_ubicacion", "notificaciones"
    ];

    for (const table of tables) {
      console.log(`Migrando tabla: ${table}...`);

      // 1. Obtener esquema real de la tabla local
      const [[createResult]] = await localConn.query(`SHOW CREATE TABLE ${table}`);
      let createSql = createResult["Create Table"];

      // Ajustar para Aiven (si es necesario)
      await remoteConn.query(`DROP TABLE IF EXISTS ${table}`);
      await remoteConn.query(createSql);

      // 2. Copiar Datos
      const [rows] = await localConn.query(`SELECT * FROM ${table}`);
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]).join(", ");
        const placeholders = Object.keys(rows[0]).map(() => "?").join(", ");
        const values = rows.map(row => Object.values(row));

        await remoteConn.query(`INSERT INTO ${table} (${columns}) VALUES ?`, [values]);
      }
      console.log(`Tabla ${table} migrada con ${rows.length} filas.`);
    }

    await remoteConn.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("\n¡MIGRACIÓN COMPLETADA CON ÉXITO!");
    console.log("Tu base de datos ya está en la Nube (Aiven.io)");

  } catch (err) {
    console.error("Error en migración:", err);
  } finally {
    if (localConn) await localConn.end();
    if (remoteConn) await remoteConn.end();
    process.exit();
  }
}

migrate();

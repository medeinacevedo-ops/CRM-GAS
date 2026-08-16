require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const pool = require("./config/db");

async function setup() {
  try {
    console.log("Configurando tabla de alertas SOS...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alertas_sos (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        vendedor_id     INT NOT NULL,
        lat             DECIMAL(10,8) NOT NULL,
        lng             DECIMAL(11,8) NOT NULL,
        fecha           DATETIME DEFAULT CURRENT_TIMESTAMP,
        atendida        TINYINT(1) DEFAULT 0,
        atendida_por    INT NULL,
        notas_resolucion TEXT,
        CONSTRAINT fk_sos_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        CONSTRAINT fk_sos_admin FOREIGN KEY (atendida_por) REFERENCES usuarios(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("Tabla 'alertas_sos' lista.");

  } catch (err) {
    console.error("Error al configurar SOS:", err);
  } finally {
    process.exit();
  }
}
setup();

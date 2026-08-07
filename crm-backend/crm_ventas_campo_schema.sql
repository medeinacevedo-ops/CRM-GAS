-- =====================================================================
-- CRM Ventas de Campo — Esquema de base de datos (MySQL 8+)
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. USUARIOS Y PERMISOS
-- ---------------------------------------------------------------------

CREATE TABLE zonas (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,
    distrito        VARCHAR(100) NOT NULL,
    creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE usuarios (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    telefono        VARCHAR(30),
    password_hash   VARCHAR(255) NOT NULL,
    rol             ENUM('admin', 'supervisor', 'vendedor') NOT NULL,
    zona_id         INT NULL,
    activo          TINYINT(1) NOT NULL DEFAULT 1,
    creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuarios_zona FOREIGN KEY (zona_id) REFERENCES zonas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permisos_supervisor (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    supervisor_id   INT NOT NULL,
    zona_id         INT NULL,
    vendedor_id     INT NULL,
    puede_ver_kpis      TINYINT(1) NOT NULL DEFAULT 1,
    puede_ver_ubicacion TINYINT(1) NOT NULL DEFAULT 0,
    otorgado_por    INT NOT NULL,
    creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_permisos_supervisor FOREIGN KEY (supervisor_id) REFERENCES usuarios(id),
    CONSTRAINT fk_permisos_zona FOREIGN KEY (zona_id) REFERENCES zonas(id),
    CONSTRAINT fk_permisos_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    CONSTRAINT fk_permisos_admin FOREIGN KEY (otorgado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 2. HISTORIAL DE CARGA (INMUTABLE)
-- ---------------------------------------------------------------------

CREATE TABLE bases_cargadas (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    nombre_archivo   VARCHAR(255) NOT NULL,
    cargado_por      INT NOT NULL,
    fecha_carga      DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_registros  INT NOT NULL DEFAULT 0,
    estado           ENUM('procesando', 'completado', 'con_errores') NOT NULL DEFAULT 'procesando',
    CONSTRAINT fk_bases_admin FOREIGN KEY (cargado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- leads_base es de solo INSERT: nunca se ejecuta UPDATE ni DELETE sobre esta tabla.
-- Se recomienda revocar privilegios UPDATE/DELETE al usuario de aplicacion sobre esta tabla
-- y manejar la logica de "no modificar" tambien a nivel de aplicacion.
CREATE TABLE leads_base (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    carga_id         INT NOT NULL,
    nombre           VARCHAR(150) NOT NULL,
    telefono         VARCHAR(30),
    direccion        VARCHAR(255),
    lat              DECIMAL(10,7),
    lng              DECIMAL(10,7),
    distrito         VARCHAR(100),
    datos_adicionales JSON NULL,
    creado_en        DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_leadsbase_carga FOREIGN KEY (carga_id) REFERENCES bases_cargadas(id),
    INDEX idx_leadsbase_carga (carga_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 3. CAPA OPERATIVA DE LEADS
-- ---------------------------------------------------------------------

CREATE TABLE leads (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    lead_base_id     BIGINT NOT NULL,
    zona_id          INT NOT NULL,
    vendedor_id      INT NULL,
    estado           ENUM('nuevo', 'asignado', 'contactado', 'vendido', 'descartado') NOT NULL DEFAULT 'nuevo',
    fecha_asignacion DATETIME NULL,
    creado_en        DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_leads_base FOREIGN KEY (lead_base_id) REFERENCES leads_base(id),
    CONSTRAINT fk_leads_zona FOREIGN KEY (zona_id) REFERENCES zonas(id),
    CONSTRAINT fk_leads_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    INDEX idx_leads_vendedor (vendedor_id),
    INDEX idx_leads_zona (zona_id),
    INDEX idx_leads_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE asignaciones (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    lead_id         BIGINT NOT NULL,
    vendedor_id     INT NOT NULL,
    asignado_por    INT NULL,
    tipo            ENUM('manual', 'automatico', 'intercambio') NOT NULL,
    fecha           DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_asig_lead FOREIGN KEY (lead_id) REFERENCES leads(id),
    CONSTRAINT fk_asig_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    CONSTRAINT fk_asig_admin FOREIGN KEY (asignado_por) REFERENCES usuarios(id),
    INDEX idx_asig_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE intercambios_leads (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    vendedor_origen_id  INT NOT NULL,
    vendedor_destino_id INT NOT NULL,
    cantidad            INT NOT NULL,
    estado              ENUM('pendiente', 'confirmado', 'rechazado') NOT NULL DEFAULT 'pendiente',
    fecha               DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_interc_origen FOREIGN KEY (vendedor_origen_id) REFERENCES usuarios(id),
    CONSTRAINT fk_interc_destino FOREIGN KEY (vendedor_destino_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 4. OPERACION DE VENTA
-- ---------------------------------------------------------------------

CREATE TABLE visitas (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    lead_id             BIGINT NOT NULL,
    vendedor_id         INT NOT NULL,
    fecha               DATETIME DEFAULT CURRENT_TIMESTAMP,
    resultado           ENUM('venta_cerrada', 'no_interesado', 'reagendar', 'no_ubicado') NOT NULL,
    lat_checkin         DECIMAL(10,7),
    lng_checkin         DECIMAL(10,7),
    distancia_al_cliente_m INT,
    notas               TEXT,
    CONSTRAINT fk_visitas_lead FOREIGN KEY (lead_id) REFERENCES leads(id),
    CONSTRAINT fk_visitas_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    INDEX idx_visitas_vendedor_fecha (vendedor_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ventas (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    visita_id   BIGINT NOT NULL,
    producto    VARCHAR(150) NOT NULL,
    monto       DECIMAL(10,2) NOT NULL,
    fecha       DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ventas_visita FOREIGN KEY (visita_id) REFERENCES visitas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 5. JORNADA LABORAL
-- ---------------------------------------------------------------------

CREATE TABLE jornadas (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    vendedor_id         INT NOT NULL,
    fecha               DATE NOT NULL,
    hora_ingreso        DATETIME NULL,
    hora_salida         DATETIME NULL,
    tiempo_activo_total INT NULL COMMENT 'minutos',
    CONSTRAINT fk_jornadas_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    UNIQUE KEY uq_jornada_vendedor_fecha (vendedor_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE catalogo_pausas (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL,
    tipo                ENUM('desconexion', 'reductor') NOT NULL,
    tiempo_max_minutos  INT NULL,
    activo              TINYINT(1) NOT NULL DEFAULT 1,
    creado_por          INT NOT NULL,
    creado_en           DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_catpausas_admin FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE registros_pausas (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    jornada_id   BIGINT NOT NULL,
    pausa_id     INT NOT NULL,
    hora_inicio  DATETIME NOT NULL,
    hora_fin     DATETIME NULL,
    CONSTRAINT fk_regpausas_jornada FOREIGN KEY (jornada_id) REFERENCES jornadas(id),
    CONSTRAINT fk_regpausas_catalogo FOREIGN KEY (pausa_id) REFERENCES catalogo_pausas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE checkpoints_ubicacion (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    vendedor_id    INT NOT NULL,
    jornada_id     BIGINT NULL,
    tipo_evento    ENUM('ingreso', 'visita', 'break_inicio', 'break_fin', 'heartbeat', 'salida') NOT NULL,
    lat            DECIMAL(10,7) NOT NULL,
    lng            DECIMAL(10,7) NOT NULL,
    hora           DATETIME DEFAULT CURRENT_TIMESTAMP,
    referencia_id  BIGINT NULL COMMENT 'ej. lead_id si el evento es una visita',
    CONSTRAINT fk_checkpoints_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
    CONSTRAINT fk_checkpoints_jornada FOREIGN KEY (jornada_id) REFERENCES jornadas(id),
    INDEX idx_checkpoints_vendedor_hora (vendedor_id, hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- DATA SEMILLA MINIMA (opcional, para pruebas)
-- ---------------------------------------------------------------------

INSERT INTO zonas (nombre, distrito) VALUES
    ('Zona SJL', 'San Juan de Lurigancho'),
    ('Zona Comas', 'Comas');

-- Password de ejemplo: se genera el hash real desde el backend (bcrypt), esto es solo referencial.
INSERT INTO usuarios (nombre, email, telefono, password_hash, rol, zona_id) VALUES
    ('Admin Principal', 'admin@empresa.com', '999999999', '$2b$10$reemplazar_con_hash_real', 'admin', NULL);

INSERT INTO catalogo_pausas (nombre, tipo, tiempo_max_minutos, creado_por) VALUES
    ('Baño', 'desconexion', 15, 1),
    ('Coaching', 'desconexion', 30, 1),
    ('Capacitacion', 'desconexion', 60, 1),
    ('Retroalimentacion', 'desconexion', 30, 1),
    ('Descanso medico', 'reductor', NULL, 1);

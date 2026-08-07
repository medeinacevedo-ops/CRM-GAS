# CRM Ventas de Campo — Backend

## Requisitos
- Node.js 18 o superior
- MySQL 8 corriendo en tu PC (o accesible por red)

## 1. Crear la base de datos
```bash
mysql -u root -p -e "CREATE DATABASE crm_ventas_campo CHARACTER SET utf8mb4;"
mysql -u root -p crm_ventas_campo < crm_ventas_campo_schema.sql
```

## 2. Configurar variables de entorno
```bash
cp .env.example .env
```
Edita `.env` con tus datos reales de conexión a MySQL y un `JWT_SECRET` largo y aleatorio.

## 3. Instalar dependencias
```bash
npm install
```

## 4. Crear el usuario administrador
El script SQL insertó un admin de ejemplo con un hash de password inválido (placeholder).
Genera un hash real:
```bash
node src/utils/generarHash.js "TuPasswordSegura123"
```
Copia el resultado y actualízalo en la base de datos:
```sql
UPDATE usuarios SET password_hash = '<hash generado>' WHERE email = 'admin@empresa.com';
```

## 5. Levantar el servidor
```bash
npm run dev
```
Deberías ver: `Servidor corriendo en http://localhost:3000`

## 6. Probar que funciona
```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"TuPasswordSegura123"}'
# Debe devolver un token JWT
```

## Endpoints disponibles hasta ahora

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | /api/auth/login | público | Iniciar sesión |
| POST | /api/leads/cargar-base | admin | Sube un CSV, crea historial inmutable en leads_base |
| GET | /api/leads/cargas | admin | Lista el historial de cargas |
| POST | /api/leads/generar-operativos | admin | Genera la copia operativa (tabla leads) desde una carga |
| POST | /api/leads/repartir-automatico | admin | Reparte los leads 'nuevo' de una zona entre sus vendedores |
| GET | /api/leads/mis-leads | vendedor | Cartera asignada al vendedor autenticado |
| POST | /api/jornada/ingreso | vendedor | Marca ingreso del día |
| POST | /api/jornada/pausa/iniciar | vendedor | Inicia un break/desconexión/reductor |
| POST | /api/jornada/pausa/finalizar | vendedor | Finaliza la pausa activa |
| POST | /api/jornada/salida | vendedor | Marca salida y calcula tiempo activo |
| POST | /api/visitas | vendedor | Registra una visita con check-in geolocalizado |

## Formato del CSV para cargar-base
```
nombre,telefono,direccion,lat,lng,distrito
Maria Fernandez,987654321,Jr. Las Flores 245,-11.9985,-77.0075,San Juan de Lurigancho
```

## Lo que falta construir (siguiente iteración)
- Endpoints de intercambio de leads entre vendedores (confirmación de ambas partes).
- Endpoints de KPIs/dashboard (ventas del mes, conversión, ranking).
- Endpoints de administración de zonas, usuarios y catálogo de pausas (CRUD).
- Endpoint de heartbeat de ubicación.
- Panel de administrador (frontend web).
- App Android (requiere Android Studio — recomendado hacerlo en Claude Code).

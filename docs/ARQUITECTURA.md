# Rumbo — Arquitectura e Infraestructura

Documento de contexto de la aplicación. Explica, de forma práctica, cómo está
construida de punta a punta: infraestructura, servicios, flujo de datos,
seguridad, pruebas y las decisiones de diseño más importantes. Sirve de guion
para explicar el proyecto y como mapa para navegar el código.

> **Qué es Rumbo**: una aplicación de gestión de tareas (login con JWT, listado
> con filtros y paginación, CRUD, prioridades, categorías, vencimientos, tareas
> recurrentes, adjuntos, notificaciones, exportación a calendario y un panel de
> análisis). Todo el entorno se levanta con un solo comando: `docker compose up`.

---

## 1. Vista general

Tres servicios en contenedores, más un job de inicialización de la base de datos.

```
                    Navegador (http://localhost:8080)
                                 │
                                 ▼
            ┌────────────────────────────────────────┐
            │  frontend  (nginx, Vue 3 + Vuetify)     │   red: frontend-net
            │  - sirve la SPA compilada               │
            │  - proxy /api  ──►  backend:3000         │
            └───────────────────┬────────────────────┘
                                 │  /api (mismo origen, sin CORS en el navegador)
                                 ▼
            ┌────────────────────────────────────────┐
            │  backend  (Node + Express + TypeScript) │   redes: frontend-net + backend-net
            │  - API REST, JWT, validación, errores   │
            │  - solo ejecuta Stored Procedures       │
            └───────────────────┬────────────────────┘
                                 │  TDS (puerto 1433), usuario de mínimo privilegio
                                 ▼
            ┌────────────────────────────────────────┐
            │  sqlserver  (SQL Server 2022)           │   red: backend-net
            │  - tabla Tasks + TaskAttachments        │
            │  - Stored Procedures + índices          │
            └────────────────────────────────────────┘
                                 ▲
                                 │  (se ejecuta una vez al inicio)
            ┌────────────────────────────────────────┐
            │  db-init  (job efímero)                 │
            │  - crea BD, tabla, índices, SPs,        │
            │    usuario de app y datos de ejemplo    │
            └────────────────────────────────────────┘
```

**Idea clave de seguridad de red**: el frontend vive en `frontend-net` y el
SQL Server en `backend-net`. El backend es el único que pertenece a ambas, así
que **el navegador nunca puede llegar a la base de datos**: todo pasa por la API.

---



## 2. Orquestación y arranque (Docker Compose)

Archivo: `docker-compose.yml`. Un solo comando levanta todo:

```bash
docker compose up --build
```

**Orden de arranque garantizado por healthchecks y dependencias:**

```
sqlserver (healthy) ──► db-init (completed_successfully) ──► backend (healthy) ──► frontend
```

- `sqlserver` se considera *healthy* solo cuando acepta conexiones y responde
  `SELECT 1` (healthcheck con `sqlcmd`).
- `db-init` corre `database/setup-db.sh`, que aplica `database/init.sql`. Es
  **idempotente**: puede ejecutarse en cada `up` sin duplicar nada. Termina y se
  apaga (`restart: "no"`).
- `backend` espera a que la BD esté lista **y** a que `db-init` haya terminado
  (`service_completed_successfully`). Reintenta la conexión si hace falta.
- `frontend` (nginx) arranca cuando el backend está *healthy*.

**Volúmenes** (datos persistentes):
- `mssql-data` → datos de SQL Server.
- `uploads-data` → archivos adjuntos (`/app/uploads` en el backend).

**Redes**: `backend-net` (sqlserver, db-init, backend) y `frontend-net`
(backend, frontend).

**Puertos publicados en el host** (configurables por `.env`):

| Servicio   | Host | Contenedor | Variable        |
|------------|------|------------|-----------------|
| frontend   | 8080 | 8080       | `FRONTEND_PORT` |
| backend    | 3000 | 3000       | `BACKEND_PORT`  |
| sqlserver  | 1433 | 1433       | `SQLSERVER_PORT`|

### Override de producción

Archivo: `docker-compose.prod.yml`. Se usa junto al base:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Endurece el despliegue:
- `NODE_ENV=production` → la API exige secretos propios o **no arranca** (guardia anti-default).
- Con `ports: !reset []` **no publica** SQL Server ni el backend en el host:
  el único servicio expuesto es el frontend.

---



## 3. Base de datos (SQL Server 2022)

Todo el esquema y la lógica están en `database/init.sql` (versionado en el repo).

### Esquema

- **`Tasks`**: `Id` (PK, identity), `Title`, `Description`, `Status`
  (`PENDING`/`COMPLETED`), `Priority` (`LOW`/`MEDIUM`/`HIGH`), `Category`,
  `DueDate`, `Recurrence` (`NONE`/`DAILY`/`WEEKLY`/`MONTHLY`), `CreatedAt`,
  `CompletedAt`. Con constraints `CHECK` y defaults.
- **`TaskAttachments`**: metadatos de archivos subidos; FK a `Tasks` con
  `ON DELETE CASCADE` (al borrar una tarea se borran sus adjuntos).

### Lógica en Stored Procedures (12)

Toda operación pasa por un SP con `TRY/CATCH` y transacción donde hay escritura.
Los errores de negocio se lanzan con `THROW` usando códigos propios que el
backend mapea a HTTP: **50400 → 400**, **50404 → 404**.

| Procedimiento | Qué hace |
|---|---|
| `sp_GetTasks` | Listado con filtros (estado, prioridad, categoría, texto, rango de fechas), orden y **paginación con `OFFSET/FETCH`**. Devuelve total + página. |
| `sp_CreateTask` / `sp_UpdateTask` / `sp_DeleteTask` | CRUD, con validación y `SCOPE_IDENTITY`. |
| `sp_UpdateTaskStatus` | Cambia estado; sella/limpia `CompletedAt`; si la tarea es recurrente, **crea la siguiente ocurrencia**. |
| `sp_BulkUpdateStatus` / `sp_BulkDeleteTasks` | Operaciones en lote (reciben un arreglo JSON de ids vía `OPENJSON`). |
| `sp_AddAttachment` / `sp_GetAttachments` / `sp_GetAttachment` / `sp_DeleteAttachment` | Gestión de adjuntos. |
| `sp_GetDueTasks` / `sp_GetNotifications` | Tareas vencidas o próximas a vencer. |
| `sp_GetTaskStats` | Métricas del panel de análisis, con bucket (día/semana/mes/año) y rango de fechas para analizar un periodo concreto. |

### Índices (justificados)

- `IX_Tasks_Status_CreatedAt (Status, CreatedAt DESC, Id DESC)` → listado
  filtrado por estado: **seek + orden ya resuelto, sin operador Sort**.
- `IX_Tasks_CreatedAt (CreatedAt DESC, Id DESC)` → vista "Todas" (sin filtro).
- `IX_Tasks_Category_CreatedAt` → filtro por categoría con seek (antes hacía scan).
- `IX_Tasks_Due` → índice **filtrado** (`WHERE Status='PENDING'`) para las notificaciones.

### Seguridad y consistencia

- **Usuario de mínimo privilegio**: el backend se conecta con un login que solo
  tiene `GRANT EXECUTE` sobre los SPs; **no puede leer las tablas directamente**.
- `ALLOW_SNAPSHOT_ISOLATION` activado: el conteo total y la página del listado se
  leen del mismo estado de datos sin bloquear a los escritores.

### Pruebas y análisis de la BD

Carpeta `database/tests/`:
- `test_procedures.sql` → **36 pruebas** de los 12 SPs (casos correctos, límites,
  errores 50400/50404, recurrencia, cascada). Crea datos con prefijo `ZZTEST` y
  los limpia; con `-b` devuelve código de error si algo falla.
- `analyze_performance.sql` → inventario de índices, su uso real, índices que el
  optimizador echa en falta y los planes de ejecución de las consultas clave.

---




## 4. Backend (Node + Express + TypeScript)

Arquitectura **por capas**, con responsabilidades separadas. Carpeta `backend/src/`:

```
routes/        define endpoints y encadena middlewares
  ├─ controllers/   traducen HTTP ↔ dominio (sin lógica de negocio)
  │   └─ services/      lógica de negocio y orquestación
  │       └─ repositories/  único punto que habla con la BD (ejecuta SPs)
middlewares/   auth (JWT), validación (Zod), subida (multer), errores
schemas/       esquemas Zod de validación de entrada
config/        env.ts (validación de variables) · database.ts (pool mssql)
utils/         AppError, asyncHandler, logger
types/         tipos del dominio y de la API
```

### Ciclo de una petición

```
Request
  → Helmet · CORS  (rate-limit en POST /api/auth/login)
  → (rutas protegidas) auth.middleware: verifica el JWT (Bearer)
  → validate.middleware: valida body/query/params con Zod (400 si falla)
  → controller → service → repository → Stored Procedure
  → respuesta JSON uniforme { success, data, meta }
  → (si algo falla) error.middleware: respuesta de error uniforme + código HTTP
```

### Puntos destacados

- **API REST**: listar, crear, editar, cambiar estado, borrar (individual y en
  lote), adjuntos, notificaciones, calendario `.ics` y estadísticas.
- **Autenticación JWT**: `POST /api/auth/login` devuelve un token; el resto de
  endpoints van protegidos por `auth.middleware`.
- **Validación**: todas las entradas se validan con **Zod** antes de llegar al
  controlador.
- **Manejo de errores centralizado**: un único `error.middleware` convierte
  `AppError` y los errores de los SPs en respuestas uniformes con el código HTTP
  correcto (400, 401, 404, 413, 429, 500, 503).
- **Consultas parametrizadas**: el repositorio usa inputs tipados de `mssql`
  (nunca concatena SQL) y solo invoca Stored Procedures.
- **Configuración por entorno**: `config/env.ts` valida las variables con Zod al
  arrancar; si falta algo, el proceso no inicia.
- **Guardia de producción**: con `NODE_ENV=production`, si `JWT_SECRET` o la
  contraseña de la BD siguen con el valor de demo, la API **se niega a arrancar**.
- **Adjuntos**: `multer` guarda en disco (`/app/uploads`), con nombre único y
  límite de tamaño configurable.
- **Respuesta uniforme**: éxito → `{ success: true, data, meta? }`; error →
  `{ success: false, error: { status, code, message } }`.

---




## 5. Frontend (Vue 3 + Vuetify + TypeScript + Vite)

SPA compilada que nginx sirve estáticamente. Carpeta `frontend/src/`:

```
views/         DashboardView (tareas) · AnalyticsView (análisis) · LoginView
components/     AppHeader, TaskFormDialog, StatCard, StatusDonut, TrendChart, ...
composables/    useTasks, useNotifications, useNotifier, useTheme, useCountUp
services/       http.ts (axios + interceptores) · tasks.api.ts · auth.api.ts
stores/         auth.ts (Pinia)
router/         rutas con guardas de autenticación
plugins/        vuetify.ts (tema claro/oscuro)
styles/         tokens.css (design tokens) · main.css
directives/     interactions.ts (v-reveal, etc.)
```

### Puntos destacados

- **Composition API** (`<script setup>`) en todos los componentes.
- **Composables propios**: `useTasks` (listado, filtros, paginación, CRUD, lote,
  búsqueda con debounce), `useNotifications`, `useNotifier`, `useTheme`.
- **Capa de servicios con axios**: `http.ts` adjunta el token JWT en cada
  petición y, si el backend responde **401**, cierra la sesión y redirige al
  login.
- **Estado**: Pinia (`stores/auth.ts`) para la sesión; el token persiste para
  sobrevivir recargas.
- **Enrutado**: Vue Router con guardas (`requiresAuth`, `guestOnly`).
- **UX**: estados de carga visibles (skeletons), errores visibles (snackbars),
  modo claro/oscuro persistido, y una **pantalla de inicio (splash)** con el
  logo durante 5 s mientras arranca la app (en `index.html`, aparece antes de
  cargar el bundle).
- **Mismo origen**: el build llama a `/api`; nginx hace de proxy hacia el
  backend, así que **no hay CORS en el navegador**.

### Infraestructura del contenedor frontend

- Build **multi-stage**: Node compila la SPA → nginx sirve los estáticos.
- `nginx` escucha en 8080, cachea los assets con hash, aplica cabeceras de
  seguridad y hace proxy de `/api` al backend.
- Corre con **nginx sin root** (imagen `unprivileged`).

---




## 6. Flujo de datos de extremo a extremo (ejemplo)

**Login + ver tareas:**

```
1. Usuario envía admin/admin123  → POST /api/auth/login
   nginx  → backend: valida credenciales → firma un JWT → responde { token }
   frontend: guarda el token en el store (Pinia)

2. Usuario abre el Dashboard  → GET /api/tasks?status=PENDING&page=1&pageSize=10
   http.ts adjunta  Authorization: Bearer <token>
   auth.middleware verifica el token
   validate.middleware valida la query (Zod)
   controller → service → repository → EXEC sp_GetTasks
   SQL Server: seek por el índice, pagina con OFFSET/FETCH, devuelve total + página
   respuesta { success, data: [...], meta: { page, total, ... } }
   frontend: renderiza la tabla (con skeletons mientras carga)
```

---



## 7. Seguridad (resumen)

- **JWT** protege todos los endpoints de datos; expiración configurable.
- **Validación de entrada** con Zod en todas las rutas.
- **Sin credenciales en el código**: los valores de demo viven solo en
  `docker-compose.yml`; los secretos reales van en `.env` (ignorado por git).
  La guardia de producción bloquea el arranque con secretos de demo.
- **Mínimo privilegio en la BD**: el usuario de la app solo ejecuta SPs.
- **Aislamiento de red**: el navegador no alcanza la base de datos.
- **Cabeceras** de seguridad (Helmet en la API, cabeceras en nginx),
  **rate-limit en el login** (`express-rate-limit`) y **nginx sin root**.
- En producción (override) solo se expone el frontend.

---



## 8. Variables de entorno (principales)

Todas tienen default para la demo; se sobrescriben con `.env` (ver `.env.example`).

| Variable | Para qué | Default (demo) |
|---|---|---|
| `NODE_ENV` | modo de ejecución | `development` |
| `JWT_SECRET` | firma del JWT (mín. 32 car.) | valor de demo |
| `JWT_EXPIRES_IN` | expiración del token | `1h` |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | credenciales de acceso | `admin` / `admin123` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | conexión a SQL Server | `sqlserver` / `1433` / `TasksDb` |
| `DB_USER` / `DB_PASSWORD` | usuario de app (mínimo privilegio) | `tasks_app` / … |
| `UPLOAD_DIR` / `UPLOAD_MAX_MB` | adjuntos | `/app/uploads` / `5` |
| `CORS_ORIGIN` | origen permitido | `http://localhost:8080` |

---



## 9. Pruebas y CI

- **Base de datos**: 36 pruebas de los SPs (`database/tests/test_procedures.sql`).
- **Backend**: Vitest + Supertest (29 pruebas) con un repositorio en memoria.
- **Frontend**: Vitest + Vue Test Utils (8 pruebas).
- **Calidad**: ESLint (0 warnings) + Prettier + TypeScript estricto.
- **CI** (`.github/workflows/ci.yml`): en cada push corre, para backend y
  frontend, `lint · typecheck · test · build`; construye las imágenes Docker,
  las escanea con **Trivy** y hace un **smoke test** levantando el stack con
  `docker compose` (login + listado real).

---



## 10. Cómo ejecutarlo

```bash
# Demo (desarrollo) — un solo comando
docker compose up --build
# App: http://localhost:8080   ·   admin / admin123

# Producción endurecida (requiere .env con secretos reales)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Sin Docker (desarrollo local): `npm install` + `npm run dev` en `backend/` y
`frontend/`, apuntando a una instancia de SQL Server. Detalles en el `README.md`.

---



## 11. Decisiones de diseño (para explicar)

- **Toda la lógica de datos en Stored Procedures** → la BD valida y controla
  transacciones; el backend no arma SQL. Encaja con el usuario de mínimo
  privilegio (solo `EXECUTE`).
- **Arquitectura por capas en el backend** → fácil de testear (el repositorio se
  reemplaza por uno en memoria en las pruebas) y de razonar.
- **Mismo origen vía proxy de nginx** → sin CORS en el navegador y una sola
  superficie pública.
- **Índices pensados para consultas reales** → el listado ordenado por fecha no
  necesita un paso de `Sort` (se demuestra con el plan de ejecución).
- **Arranque determinista** → healthchecks + `depends_on` evitan condiciones de
  carrera; `db-init` idempotente permite repetir el `up`.
- **Configuración por entorno con validación** → nada de credenciales en el
  código y fallo rápido si falta una variable.

---



## 12. Respuestas a las preguntas de la prueba

Están desarrolladas en el `README.md`; en resumen:

1. **¿Qué consulta optimiza el índice y cómo verificarlo?** El listado por estado
   y fecha usa `IX_Tasks_Status_CreatedAt` (seek + orden resuelto, sin Sort). Se
   verifica con el plan de ejecución (`SET SHOWPLAN_TEXT ON` o el plan real), que
   debe mostrar *Index Seek* y no *Scan/Sort* (ver `database/tests/analyze_performance.sql`).
2. **Si creciera a 5M de filas:** paginación por clave (keyset) en vez de
   `OFFSET/FETCH`, Full-Text Search para la búsqueda, tabla de resumen o
   columnstore para el análisis, particionado por fecha, compresión y caché.
3. **Para llevar a producción:** secretos fuera del código y HTTPS, usuarios
   reales con contraseñas cifradas y refresh tokens, migraciones versionadas,
   backups probados, observabilidad (logs/métricas/alertas), CI con escaneo de
   imágenes (ya incluido) y alta disponibilidad (réplicas + balanceador).

---



## 13. Mapa rápido de archivos

| Necesito ver…                    | Archivo                                           |
|----------------------------------|---------------------------------------------------|
| Esquema, SPs e índices           | `database/init.sql`                               |
| Pruebas / análisis de la BD      | `database/tests/`                                 |
| Rutas y endpoints                | `backend/src/routes/`                             |
| Lógica de negocio                | `backend/src/services/`                           |
| Acceso a datos (SPs)             | `backend/src/repositories/task.repository.ts`     |
| Validación de entrada            | `backend/src/schemas/`                            |
| Config y validación de entorno   | `backend/src/config/env.ts`                       |
| Pantallas                        | `frontend/src/views/`                             |
| Lógica de UI reutilizable        | `frontend/src/composables/`                       |
| Cliente HTTP (token, 401)        | `frontend/src/services/http.ts`                   |
| Orquestación                     | `docker-compose.yml` · `docker-compose.prod.yml`  |
| Pipeline CI                      | `.github/workflows/ci.yml`                        |
| Guía de ejecución y preguntas    | `README.md`                                       |

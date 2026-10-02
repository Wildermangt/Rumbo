# Rumbo

Aplicación de gestión de tareas. Incluye login con JWT, paginación, filtros, prioridades, categorías, fechas de vencimiento, tareas recurrentes, adjuntos con vista previa, notificaciones, exportación a calendario y un panel de análisis. Todo se levanta con un solo comando.

## Tecnologías

| Capa | Qué usa |
|------|---------|
| Frontend | Vue 3 con Composition API, Vuetify 3, TypeScript y Vite |
| Backend | Node.js, Express, TypeScript, JWT, Zod y Multer (adjuntos) |
| Base de datos | SQL Server 2022 con stored procedures e índice |
| Despliegue | Docker y Docker Compose |


## Cómo ejecutarlo

Necesitas Docker con el plugin de Docker Compose v2. Sirve en Linux, macOS o Windows con WSL2. SQL Server pide unos 2 GB de RAM y su imagen es solo para x86_64.

### Pasos en Linux (Ubuntu/Debian)

1. Instala Docker Engine y el plugin de Compose, si aún no los tienes:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # usar docker sin sudo (cierra sesión y vuelve a entrar)
   docker compose version          # comprueba que Compose v2 está instalado
   ```

2. Clona el repositorio y entra en la carpeta:

   ```bash
   git clone <URL-del-repositorio> rumbo
   cd rumbo
   ```

3. Levanta todo el entorno:

   ```bash
   docker compose up --build
   ```

No hay que configurar nada más. Las variables traen un valor por defecto de desarrollo, definido solo en `docker-compose.yml`, para que la demo arranque con un solo comando. El código de la API no trae credenciales: las recibe del entorno.

Cuando termine de arrancar, abre:

| Servicio | Dirección |
|----------|-----------|
| Aplicación | http://localhost:8080 |
| API | http://localhost:8080/api |
| SQL Server | localhost puerto 1433 |

Usuario de prueba: `admin`
Contraseña de prueba: `admin123`

Para detenerlo usa `docker compose down`.
Para empezar desde cero y borrar los datos usa `docker compose down -v` y vuelve a levantar.


## Cómo arranca todo

Los servicios se encienden en orden y cada uno espera a que el anterior esté listo:

1. SQL Server arranca primero. Se considera listo cuando acepta conexiones.
2. Un contenedor de inicialización crea la base de datos, la tabla, el índice, los procedimientos y unos datos de ejemplo. Se puede ejecutar varias veces sin duplicar nada.
3. El backend arranca cuando la base ya está lista y reintenta la conexión si hace falta.
4. El frontend (nginx) sirve la aplicación y reenvía las llamadas `/api` al backend.


## Estructura del proyecto

```
.
├── backend/      API en Express + TypeScript
├── frontend/     Aplicación en Vue 3 + Vuetify
├── database/     init.sql (tabla, índice, procedimientos), setup-db.sh y tests
├── docs/         ARQUITECTURA.md, informes en PDF y capturas
├── docker-compose.yml
└── .env.example
```

El backend está organizado en capas: rutas, controladores, servicios, repositorios, middlewares y configuración.

Para una explicación completa de la infraestructura (servicios, redes, flujo de datos, seguridad, pruebas y decisiones de diseño) consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).


## Base de datos

Tabla `Tasks` con estas columnas:

- `Id`: clave primaria autoincremental.
- `Title`: texto de hasta 150 caracteres.
- `Description`: texto opcional.
- `Status`: `PENDING` o `COMPLETED`. Por defecto `PENDING`.
- `Priority`: `LOW`, `MEDIUM` o `HIGH`. Por defecto `MEDIUM`.
- `Category`: texto corto opcional (por ejemplo Finanzas o Clientes).
- `DueDate`: fecha de vencimiento opcional.
- `Recurrence`: `NONE`, `DAILY`, `WEEKLY` o `MONTHLY`. Por defecto `NONE`. Al completar una tarea recurrente se crea la siguiente ocurrencia con el vencimiento adelantado.
- `CreatedAt`: fecha de creación.
- `CompletedAt`: fecha en que se completó. Queda vacía mientras está pendiente.

Tabla `TaskAttachments` para los archivos adjuntos. Guarda el nombre original, el nombre en disco, el tipo y el tamaño, y se borra en cascada si se elimina la tarea.

Índices para el listado:

- `IX_Tasks_Status_CreatedAt` sobre estado y fecha. Sirve cuando se filtra por estado.
- `IX_Tasks_CreatedAt` sobre fecha. Sirve para la vista por defecto, "Todas", donde no hay filtro de estado.
- `IX_Tasks_Category_CreatedAt` sobre categoría y fecha. Resuelve el filtro por categoría con un seek (sin este índice hacía un recorrido completo de la tabla).
- `IX_Tasks_Due` (filtrado sobre `Status = PENDING`) para las notificaciones de vencimiento.

Con ellos, el listado ordenado por fecha nunca necesita un paso de ordenamiento, ni en orden descendente ni en ascendente.

Procedimientos almacenados. Todos usan `TRY/CATCH` y transacción:

- `sp_GetTasks`: devuelve el total y la página pedida. Filtra por estado, prioridad, categoría y fechas, busca por texto y ordena por fecha, título, vencimiento o prioridad (mayor a menor o menor a mayor).
- `sp_CreateTask`: inserta una tarea y devuelve el registro creado.
- `sp_UpdateTask`: edita título, descripción, prioridad, categoría, vencimiento y recurrencia (CRUD).
- `sp_UpdateTaskStatus`: cambia el estado, valida que la tarea exista y genera la siguiente ocurrencia si es recurrente.
- `sp_DeleteTask`: elimina una tarea (CRUD).
- `sp_BulkUpdateStatus` y `sp_BulkDeleteTasks`: cambian el estado o eliminan varias tareas a la vez (selección múltiple).
- `sp_GetTaskStats`: agrega datos por semana, mes o año para el panel de análisis.
- `sp_GetNotifications` y `sp_GetDueTasks`: listan las tareas vencidas o próximas a vencer.
- `sp_AddAttachment`, `sp_GetAttachments`, `sp_GetAttachment` y `sp_DeleteAttachment`: gestionan los adjuntos.

El backend se conecta con un usuario que solo puede ejecutar los procedimientos. No puede leer las tablas directamente.

### Pruebas y análisis de la base de datos

En `database/tests/` hay dos scripts que se ejecutan con sqlcmd dentro del contenedor de SQL Server:

- `test_procedures.sql`: 36 pruebas que ejercitan los 12 procedimientos con casos correctos, límites y errores de negocio (50400 y 50404), además de la recurrencia y el borrado en cascada de adjuntos. Crea sus propias filas (prefijo `ZZTEST`) y las borra al terminar, así que no toca los datos de ejemplo. Con el flag `-b`, sqlcmd devuelve código de error si alguna prueba falla.
- `analyze_performance.sql`: muestra los índices, su uso real, los índices que el optimizador echa en falta y el plan de ejecución de las consultas principales (para ver si hacen seek o scan).

```bash
docker exec -it tasks-sqlserver bash -lc \
  '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -No -d TasksDb -b -i /tmp/test_procedures.sql'
```


## API

Todas las respuestas tienen el mismo formato. Las correctas traen `success: true` y `data`. Las de error traen `success: false` y un objeto `error` con el código y el mensaje.

| Método | Ruta | Login | Qué hace |
|--------|------|-------|----------|
| GET | `/api/health` | No | Estado de la API y de la base |
| POST | `/api/auth/login` | No | Recibe usuario y contraseña, devuelve un token |
| GET | `/api/tasks` | Sí | Lista tareas con filtros, búsqueda, orden y paginación |
| POST | `/api/tasks` | Sí | Crea una tarea |
| PUT | `/api/tasks/:id` | Sí | Edita la tarea (título, descripción, prioridad, categoría, vencimiento, recurrencia) |
| PATCH | `/api/tasks/:id/status` | Sí | Cambia el estado de una tarea |
| DELETE | `/api/tasks/:id` | Sí | Elimina una tarea |
| POST | `/api/tasks/bulk/status` | Sí | Cambia el estado de varias (selección múltiple) |
| POST | `/api/tasks/bulk/delete` | Sí | Elimina varias (selección múltiple) |
| GET | `/api/tasks/stats` | Sí | Métricas para el panel de análisis |
| GET | `/api/tasks/notifications` | Sí | Tareas vencidas y próximas a vencer |
| GET | `/api/tasks/calendar.ics` | Sí | Descarga las tareas con vencimiento en formato iCalendar |
| GET | `/api/tasks/:id/attachments` | Sí | Lista los adjuntos de una tarea |
| POST | `/api/tasks/:id/attachments` | Sí | Sube un adjunto (multipart, hasta 5 MB) |
| GET | `/api/tasks/attachments/:id/download` | Sí | Descarga o previsualiza un adjunto |
| DELETE | `/api/tasks/attachments/:id` | Sí | Elimina un adjunto |

Filtros disponibles en `GET /api/tasks`: estado, prioridad, categoría, página, tamaño de página, búsqueda por texto, rango de fechas de creación y orden (fecha, título A→Z o Z→A, vencimiento, y prioridad de mayor a menor o de menor a mayor).

Ejemplo de uso:

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .data.token)

curl -s "localhost:8080/api/tasks?status=PENDING&page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Códigos de respuesta que maneja la API: 200, 201, 400, 401, 404, 413, 429, 500 y 503.


## Frontend

La aplicación tiene dos pantallas principales:

Pantalla de tareas. Muestra tarjetas de resumen, un buscador, filtros por estado, prioridad, categoría y rango de fechas, varias opciones de orden y una tabla con paginación. Se pueden crear, editar, completar y eliminar tareas, tanto una a una como en lote (selección múltiple). Hay columnas de prioridad, vencimiento, creación y culminación.

Cada tarea puede tener prioridad, categoría, fecha de vencimiento y repetición (diaria, semanal o mensual). También admite archivos adjuntos: se suben desde el formulario de edición y, al hacer clic en uno, se abre una vista previa sin necesidad de descargarlo (imágenes, PDF y texto se ven dentro de la aplicación). Desde la lista se puede exportar un calendario `.ics` para el correo o añadir una tarea a Google Calendar.

Panel de análisis. Muestra indicadores y un gráfico de tareas creadas contra completadas. Se puede ver por semana, mes o año.

Otros detalles:

- Modo claro y oscuro, con la preferencia guardada.
- Campana de notificaciones con las tareas vencidas y próximas a vencer.
- Estados de carga visibles con skeletons y errores visibles con avisos.
- La lógica de tareas está en un composable propio llamado `useTasks`.
- Si el token caduca, la sesión se cierra y vuelve al login.


## Preguntas de la prueba

### 1. ¿Qué consulta optimiza el índice y cómo saber si SQL Server lo usa?

Los índices optimizan el listado principal: filtrar por estado (opcional), ordenar por fecha y paginar. Es la consulta que se ejecuta cada vez que se abre o se pagina la pantalla de tareas.

```sql
SELECT Id, Title, Description, Status, CreatedAt, CompletedAt
FROM dbo.Tasks
WHERE (@Status IS NULL OR Status = @Status)
ORDER BY CreatedAt DESC, Id DESC
OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
```

- Con un estado concreto (`PENDING` o `COMPLETED`) SQL Server usa `IX_Tasks_Status_CreatedAt (Status, CreatedAt DESC, Id DESC)`: hace un seek al estado y lee las filas ya ordenadas por fecha.
- Sin filtro de estado, la columna `Status` no acota nada, así que ese índice no evita ordenar. Por eso existe `IX_Tasks_CreatedAt (CreatedAt DESC, Id DESC)`: entrega todas las filas ya ordenadas.
- El orden ascendente usa los mismos índices recorridos al revés (`ORDERED BACKWARD`). Por eso el desempate por `Id` sigue la misma dirección que la fecha.

Así SQL Server lee solo las filas de la página y se ahorra el operador `Sort`, que es lo más caro de esta consulta. El procedimiento usa `OPTION (RECOMPILE)`, de modo que cada combinación de filtros recibe su propio plan.

El orden por título y la búsqueda con `LIKE '%texto%'` no están cubiertos por un índice. Es una decisión consciente: ver la pregunta 2.

Para comprobar que lo usa, mira el plan de ejecución. En SSMS o Azure Data Studio activa el plan real con `Ctrl+M`, o desde la terminal:

```bash
docker exec -it tasks-sqlserver bash -c '/opt/mssql-tools18/bin/sqlcmd -C -U sa -P "$MSSQL_SA_PASSWORD" -d TasksDb   -Q "SET STATISTICS PROFILE ON; EXEC dbo.sp_GetTasks; EXEC dbo.sp_GetTasks @Status = N'"'"'PENDING'"'"';"'
```

Qué debe aparecer en la salida:

| Llamada | Operador esperado |
|---------|-------------------|
| Sin estado | `Index Scan` sobre `IX_Tasks_CreatedAt`, `ORDERED FORWARD` |
| `@Status = 'PENDING'` | `Index Seek` sobre `IX_Tasks_Status_CreatedAt`, `SEEK: Status = 'PENDING'` |
| `@SortDir = 'ASC'` | El mismo índice con `ORDERED BACKWARD` |

En ningún caso debe aparecer un operador `Sort`.

### 2. Si la tabla creciera a 5 millones de tareas, ¿qué cambiarías?

- Cambiaría la paginación. `OFFSET/FETCH` se vuelve lento en páginas muy altas porque lee y descarta muchas filas. Usaría paginación por clave, que avanza a partir de la última fila vista y tiene un costo constante.
- Evitaría contar el total exacto en cada consulta. Usaría un conteo aproximado o solo indicaría si hay más páginas.
- Para la búsqueda por texto usaría Full-Text Search, porque buscar con comodín al inicio no aprovecha el índice.
- Para el análisis usaría una tabla de resumen o un índice columnstore, en lugar de recalcular todo cada vez.
- Aplicaría particionado por fecha, estadísticas al día y compresión.
- Agregaría caché para las métricas y, si hiciera falta, una réplica de solo lectura para las consultas pesadas.

### 3. ¿Qué agregarías para llevarla a producción?

- Gestionar los secretos fuera del código y servir todo bajo HTTPS.
- Usuarios reales en la base con contraseñas cifradas y tokens de refresco.
- Migraciones de base de datos versionadas y copias de seguridad probadas.
- Monitoreo con logs, métricas y alertas.
- Un pipeline de integración continua con pruebas y escaneo de imágenes. Ya hay uno incluido.
- Varias réplicas del backend detrás de un balanceador y alta disponibilidad en la base.


## Calidad del código

Pruebas automáticas:

```bash
cd backend  && npm test    # pruebas de la API
cd frontend && npm test    # pruebas del frontend
```

El proyecto incluye ESLint y Prettier en backend y frontend. También hay un flujo de integración continua en `.github/workflows/ci.yml` que revisa el código, corre las pruebas, construye las imágenes y hace una prueba de humo levantando el stack.


## Ejecutar sin Docker

Útil para desarrollar. Primero levanta solo la base de datos y luego cada parte:

```bash
docker compose up -d sqlserver db-init
cd backend  && cp .env.example .env && npm install && npm run dev
cd frontend && npm install && npm run dev
```

El backend queda en el puerto 3000 y el frontend en el 5173.


## Despliegue de producción

Hay una configuración aparte más segura. Pide un archivo `.env` con secretos propios y solo publica el frontend:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

En este modo la API no arranca si los secretos siguen con el valor por defecto, y los puertos de la base y del backend no quedan expuestos.


## Seguridad

El proyecto tiene una revisión de seguridad en `docs/Informe-Seguridad-Rumbo.pdf`. Lo ya aplicado:

- En modo producción la API no arranca si el secreto de JWT, la contraseña de la base o la contraseña del usuario de la aplicación siguen con el valor de demo. Los secretos reales van en `.env`, que no se sube al repositorio.
- El frontend corre en un contenedor sin usuario root.
- El usuario de base de datos solo puede ejecutar los procedimientos.


## Notas

- Las contraseñas y el secreto de JWT traen un valor por defecto de desarrollo, solo en `docker-compose.yml`, para que la demo funcione sin configurar nada. El código de la API no tiene credenciales. Con `NODE_ENV=production` la API se niega a arrancar si el secreto de JWT, la contraseña de la base o la contraseña del usuario siguen con su valor de demo.
- Las imágenes usan Node 22 LTS (`node:22-alpine`), igual que el pipeline de integración continua.

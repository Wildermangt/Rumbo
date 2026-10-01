/* =============================================================================
   Tasks DB - Script de inicialización (idempotente)
   -----------------------------------------------------------------------------
   Variables sqlcmd esperadas (inyectadas por setup-db.sh):
     $(DB_NAME)          Nombre de la base de datos de la aplicación
     $(APP_DB_USER)      Login de la aplicación (mínimo privilegio)
     $(APP_DB_PASSWORD)  Contraseña del login de la aplicación
     $(SEED_DATA)        1 = insertar datos de ejemplo si la tabla está vacía
   ============================================================================= */
SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------------
   1. Base de datos
   --------------------------------------------------------------------------- */
IF DB_ID(N'$(DB_NAME)') IS NULL
BEGIN
    PRINT N'Creando base de datos [$(DB_NAME)]...';
    CREATE DATABASE [$(DB_NAME)];
END
GO

-- Permite lecturas consistentes (conteo + página) sin bloquear a los escritores.
ALTER DATABASE [$(DB_NAME)] SET ALLOW_SNAPSHOT_ISOLATION ON;
GO

USE [$(DB_NAME)];
GO

/* ---------------------------------------------------------------------------
   2. Tabla Tasks
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.Tasks', N'U') IS NULL
BEGIN
    PRINT N'Creando tabla dbo.Tasks...';
    CREATE TABLE dbo.Tasks
    (
        Id          INT IDENTITY(1, 1) NOT NULL,
        Title       NVARCHAR(150)      NOT NULL,
        Description NVARCHAR(MAX)      NULL,
        Status      NVARCHAR(20)       NOT NULL CONSTRAINT DF_Tasks_Status    DEFAULT (N'PENDING'),
        CreatedAt   DATETIME2          NOT NULL CONSTRAINT DF_Tasks_CreatedAt DEFAULT (GETDATE()),
        CompletedAt DATETIME2          NULL,

        CONSTRAINT PK_Tasks               PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_Tasks_Status        CHECK (Status IN (N'PENDING', N'COMPLETED')),
        CONSTRAINT CK_Tasks_Title_NotBlank CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
    );
END
GO

-- Migración idempotente: añade CompletedAt a tablas ya existentes (volúmenes previos).
IF COL_LENGTH(N'dbo.Tasks', N'CompletedAt') IS NULL
BEGIN
    PRINT N'Añadiendo columna CompletedAt...';
    ALTER TABLE dbo.Tasks ADD CompletedAt DATETIME2 NULL;
END
GO

/* ---------------------------------------------------------------------------
   3. Índices no agrupados para filtrado + paginación por fecha
      IX_Tasks_Status_CreatedAt (listado filtrado por estado):
        - Seek por Status.
        - Orden ya resuelto por (CreatedAt DESC, Id DESC) => sin operador SORT.
      IX_Tasks_CreatedAt (listado sin filtro, la vista por defecto "Todas"):
        - Sin filtro, Status no acota nada; este índice entrega el orden por
          fecha directamente y evita Scan + TopN Sort.
      Ambos sirven también el orden ascendente con un recorrido BACKWARD.
      INCLUDE (Title) reduce lookups para listados livianos.
   --------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1
               FROM sys.indexes
               WHERE name = N'IX_Tasks_Status_CreatedAt'
                 AND object_id = OBJECT_ID(N'dbo.Tasks'))
BEGIN
    PRINT N'Creando índice IX_Tasks_Status_CreatedAt...';
    CREATE NONCLUSTERED INDEX IX_Tasks_Status_CreatedAt
        ON dbo.Tasks (Status ASC, CreatedAt DESC, Id DESC)
        INCLUDE (Title);
END
GO

IF NOT EXISTS (SELECT 1
               FROM sys.indexes
               WHERE name = N'IX_Tasks_CreatedAt'
                 AND object_id = OBJECT_ID(N'dbo.Tasks'))
BEGIN
    PRINT N'Creando índice IX_Tasks_CreatedAt...';
    CREATE NONCLUSTERED INDEX IX_Tasks_CreatedAt
        ON dbo.Tasks (CreatedAt DESC, Id DESC)
        INCLUDE (Title);
END
GO

/* ---------------------------------------------------------------------------
   4. Stored Procedures
      Códigos de error de negocio (mapeados a HTTP por el backend):
        50400 -> 400 Bad Request
        50404 -> 404 Not Found
   --------------------------------------------------------------------------- */

/* sp_GetTasks: devuelve 2 result sets -> [0] TotalCount, [1] página solicitada.
   @Search  : texto libre; filtra por Title o Description (LIKE, insensible a may/min por collation).
   @SortBy  : 'date' (por CreatedAt, por defecto) o 'title' (alfabético).
   @SortDir : 'DESC' o 'ASC'. */
CREATE OR ALTER PROCEDURE dbo.sp_GetTasks
    @Status     NVARCHAR(20)  = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 10,
    @Search     NVARCHAR(200) = NULL,
    @SortDir    NVARCHAR(4)   = N'DESC',
    @FromDate   DATETIME2     = NULL,   -- filtra por CreatedAt >= @FromDate
    @ToDate     DATETIME2     = NULL,   -- filtra por CreatedAt <= fin del día @ToDate
    @SortBy     NVARCHAR(10)  = N'date' -- criterio de orden: date | title
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @PageNumber IS NULL OR @PageNumber < 1
            THROW 50400, N'PageNumber debe ser mayor o igual a 1.', 1;

        IF @PageSize IS NULL OR @PageSize < 1 OR @PageSize > 100
            THROW 50400, N'PageSize debe estar entre 1 y 100.', 1;

        IF @Status IS NOT NULL AND @Status NOT IN (N'PENDING', N'COMPLETED')
            THROW 50400, N'Status inválido. Valores permitidos: PENDING, COMPLETED.', 1;

        SET @SortDir = UPPER(LTRIM(RTRIM(ISNULL(@SortDir, N'DESC'))));
        IF @SortDir NOT IN (N'ASC', N'DESC')
            THROW 50400, N'SortDir inválido. Valores permitidos: ASC, DESC.', 1;

        SET @SortBy = LOWER(LTRIM(RTRIM(ISNULL(@SortBy, N'date'))));
        IF @SortBy NOT IN (N'date', N'title')
            THROW 50400, N'SortBy inválido. Valores permitidos: date, title.', 1;

        IF @FromDate IS NOT NULL AND @ToDate IS NOT NULL AND @FromDate > @ToDate
            THROW 50400, N'El rango de fechas es inválido: la fecha inicial supera la final.', 1;

        -- @ToDate se interpreta inclusivo: se cubre hasta el final de ese día.
        DECLARE @ToExclusive DATETIME2 = CASE WHEN @ToDate IS NOT NULL THEN DATEADD(DAY, 1, CAST(@ToDate AS DATE)) END;

        -- Normaliza la búsqueda y escapa los comodines de LIKE.
        SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
        DECLARE @Like NVARCHAR(210) = NULL;
        IF @Search IS NOT NULL
            SET @Like = N'%' + REPLACE(REPLACE(REPLACE(@Search, N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]') + N'%';

        -- Snapshot: el total y la página se leen del mismo estado de datos.
        SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
        BEGIN TRANSACTION;

            SELECT COUNT_BIG(*) AS TotalCount
            FROM dbo.Tasks
            WHERE (@Status IS NULL OR Status = @Status)
              AND (@Like IS NULL OR Title LIKE @Like OR Description LIKE @Like)
              AND (@FromDate IS NULL OR CreatedAt >= @FromDate)
              AND (@ToExclusive IS NULL OR CreatedAt < @ToExclusive)
            OPTION (RECOMPILE);

            SELECT Id, Title, Description, Status, CreatedAt, CompletedAt
            FROM dbo.Tasks
            WHERE (@Status IS NULL OR Status = @Status)
              AND (@Like IS NULL OR Title LIKE @Like OR Description LIKE @Like)
              AND (@FromDate IS NULL OR CreatedAt >= @FromDate)
              AND (@ToExclusive IS NULL OR CreatedAt < @ToExclusive)
            ORDER BY
                CASE WHEN @SortBy = N'title' AND @SortDir = N'ASC'  THEN Title END ASC,
                CASE WHEN @SortBy = N'title' AND @SortDir = N'DESC' THEN Title END DESC,
                CASE WHEN @SortBy = N'date'  AND @SortDir = N'ASC'  THEN CreatedAt END ASC,
                CASE WHEN @SortBy = N'date'  AND @SortDir = N'DESC' THEN CreatedAt END DESC,
                -- El desempate sigue la dirección: así el índice sirve ASC con un recorrido BACKWARD.
                CASE WHEN @SortDir = N'ASC'  THEN Id END ASC,
                CASE WHEN @SortDir = N'DESC' THEN Id END DESC
            OFFSET (@PageNumber - 1) * @PageSize ROWS
            FETCH NEXT @PageSize ROWS ONLY
            OPTION (RECOMPILE);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_CreateTask: inserta y devuelve el registro creado */
CREATE OR ALTER PROCEDURE dbo.sp_CreateTask
    @Title       NVARCHAR(4000),   -- más amplio que la columna para detectar truncamiento
    @Description NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        SET @Title = LTRIM(RTRIM(@Title));

        IF @Title IS NULL OR LEN(@Title) = 0
            THROW 50400, N'Title es obligatorio.', 1;

        IF LEN(@Title) > 150
            THROW 50400, N'Title no puede superar 150 caracteres.', 1;

        DECLARE @Inserted TABLE
        (
            Id          INT,
            Title       NVARCHAR(150),
            Description NVARCHAR(MAX),
            Status      NVARCHAR(20),
            CreatedAt   DATETIME2,
            CompletedAt DATETIME2
        );

        BEGIN TRANSACTION;

            INSERT INTO dbo.Tasks (Title, Description)
            OUTPUT INSERTED.Id, INSERTED.Title, INSERTED.Description, INSERTED.Status, INSERTED.CreatedAt, INSERTED.CompletedAt
                INTO @Inserted
            VALUES (@Title, NULLIF(LTRIM(RTRIM(@Description)), N''));

        COMMIT TRANSACTION;

        SELECT Id, Title, Description, Status, CreatedAt, CompletedAt FROM @Inserted;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_UpdateTaskStatus: valida existencia, actualiza y devuelve el registro */
CREATE OR ALTER PROCEDURE dbo.sp_UpdateTaskStatus
    @TaskId INT,
    @Status NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @TaskId IS NULL OR @TaskId < 1
            THROW 50400, N'TaskId inválido.', 1;

        IF @Status IS NULL OR @Status NOT IN (N'PENDING', N'COMPLETED')
            THROW 50400, N'Status inválido. Valores permitidos: PENDING, COMPLETED.', 1;

        DECLARE @Updated TABLE
        (
            Id          INT,
            Title       NVARCHAR(150),
            Description NVARCHAR(MAX),
            Status      NVARCHAR(20),
            CreatedAt   DATETIME2,
            CompletedAt DATETIME2
        );

        BEGIN TRANSACTION;

            -- UPDLOCK + HOLDLOCK: la fila no puede desaparecer entre la validación y el UPDATE.
            IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @TaskId)
                THROW 50404, N'La tarea solicitada no existe.', 1;

            -- Al completar se sella la fecha de culminación; al reabrir se limpia.
            UPDATE dbo.Tasks
               SET Status = @Status,
                   CompletedAt = CASE WHEN @Status = N'COMPLETED' THEN GETDATE() ELSE NULL END
            OUTPUT INSERTED.Id, INSERTED.Title, INSERTED.Description, INSERTED.Status, INSERTED.CreatedAt, INSERTED.CompletedAt
                INTO @Updated
             WHERE Id = @TaskId;

        COMMIT TRANSACTION;

        SELECT Id, Title, Description, Status, CreatedAt, CompletedAt FROM @Updated;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_GetTaskStats: métricas agregadas para el dashboard de análisis.
   @Granularity: 'week' | 'month' | 'year' (define el tamaño del bucket temporal).
   Devuelve 3 result sets:
     [0] Totales (Total, Pending, Completed, AvgCompletionHours)
     [1] Creadas por bucket  (Bucket DATE, Cnt INT)
     [2] Completadas por bucket (Bucket DATE, Cnt INT)
   El relleno de buckets vacíos y el formato de etiquetas los hace el backend. */
CREATE OR ALTER PROCEDURE dbo.sp_GetTaskStats
    @Granularity NVARCHAR(10) = N'month'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        SET @Granularity = LOWER(LTRIM(RTRIM(ISNULL(@Granularity, N'month'))));
        IF @Granularity NOT IN (N'week', N'month', N'year')
            THROW 50400, N'Granularity inválido. Valores permitidos: week, month, year.', 1;

        SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

        -- [0] Totales + tiempo medio de culminación (en horas).
        SELECT
            COUNT_BIG(*)                                                     AS Total,
            SUM(CASE WHEN Status = N'PENDING'   THEN 1 ELSE 0 END)           AS Pending,
            SUM(CASE WHEN Status = N'COMPLETED' THEN 1 ELSE 0 END)           AS Completed,
            AVG(CASE WHEN CompletedAt IS NOT NULL
                     THEN DATEDIFF(MINUTE, CreatedAt, CompletedAt) * 1.0 / 60 END) AS AvgCompletionHours
        FROM dbo.Tasks;

        -- Truncamiento del bucket, independiente de DATEFIRST/idioma:
        --   week  -> lunes de la semana | month -> día 1 | year -> 1 de enero
        -- [1] Creadas por bucket
        SELECT
            CAST(
                CASE @Granularity
                    WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CreatedAt) % 7), CreatedAt)
                    WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CreatedAt), 0)
                    ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CreatedAt), 0)
                END AS DATE) AS Bucket,
            COUNT_BIG(*)     AS Cnt
        FROM dbo.Tasks
        GROUP BY
            CASE @Granularity
                WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CreatedAt) % 7), CreatedAt)
                WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CreatedAt), 0)
                ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CreatedAt), 0)
            END
        ORDER BY Bucket;

        -- [2] Completadas por bucket (según la fecha de culminación)
        SELECT
            CAST(
                CASE @Granularity
                    WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CompletedAt) % 7), CompletedAt)
                    WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CompletedAt), 0)
                    ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CompletedAt), 0)
                END AS DATE) AS Bucket,
            COUNT_BIG(*)     AS Cnt
        FROM dbo.Tasks
        WHERE CompletedAt IS NOT NULL
        GROUP BY
            CASE @Granularity
                WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CompletedAt) % 7), CompletedAt)
                WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CompletedAt), 0)
                ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CompletedAt), 0)
            END
        ORDER BY Bucket;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END
GO

/* ---------------------------------------------------------------------------
   5. Seguridad: login de aplicación con mínimo privilegio
      Solo puede EJECUTAR procedimientos del esquema dbo (sin acceso directo a tablas).
   --------------------------------------------------------------------------- */
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(APP_DB_USER)')
BEGIN
    PRINT N'Creando login [$(APP_DB_USER)]...';
    CREATE LOGIN [$(APP_DB_USER)] WITH PASSWORD = N'$(APP_DB_PASSWORD)',
        DEFAULT_DATABASE = [$(DB_NAME)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [$(APP_DB_USER)] WITH PASSWORD = N'$(APP_DB_PASSWORD)';
END
GO

USE [$(DB_NAME)];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(APP_DB_USER)')
    CREATE USER [$(APP_DB_USER)] FOR LOGIN [$(APP_DB_USER)];
GO
GRANT EXECUTE ON SCHEMA::dbo TO [$(APP_DB_USER)];
GO

/* ---------------------------------------------------------------------------
   6. Datos de ejemplo (solo si la tabla está vacía y SEED_DATA = 1)
   --------------------------------------------------------------------------- */
IF N'$(SEED_DATA)' = N'1' AND NOT EXISTS (SELECT 1 FROM dbo.Tasks)
BEGIN
    PRINT N'Insertando datos de ejemplo...';

    -- Catálogo de tareas realistas (título + descripción), sin numeración artificial.
    DECLARE @Templates TABLE (t NVARCHAR(150), d NVARCHAR(300));
    INSERT INTO @Templates (t, d) VALUES
        (N'Preparar propuesta comercial para cliente nuevo', N'Alcance, cronograma y presupuesto estimado.'),
        (N'Actualizar la política de vacaciones',            N'Revisar el documento con Recursos Humanos.'),
        (N'Renovar certificado SSL del sitio',               N'Vence a fin de mes; coordinar con infraestructura.'),
        (N'Revisar facturas pendientes de pago',             N'Conciliar con contabilidad antes del cierre.'),
        (N'Planificar campaña de redes de octubre',          N'Calendario de publicaciones y presupuesto.'),
        (N'Corregir error en el cálculo de impuestos',       N'Reportado por un usuario en la última venta.'),
        (N'Entrevistar candidatos para soporte',             N'Tres entrevistas agendadas esta semana.'),
        (N'Migrar correos al nuevo proveedor',               N'Planear la transición sin perder mensajes.'),
        (N'Hacer respaldo mensual de la base de datos',      N'Verificar que la restauración funcione.'),
        (N'Diseñar el nuevo logotipo',                       N'Tres propuestas para revisión de dirección.'),
        (N'Capacitar al equipo en el nuevo sistema',         N'Sesión práctica de dos horas.'),
        (N'Responder tickets de soporte atrasados',          N'Priorizar los de clientes premium.'),
        (N'Negociar renovación con el proveedor de hosting', N'Buscar mejor tarifa anual.'),
        (N'Preparar informe de ventas del trimestre',        N'Comparar contra el trimestre anterior.'),
        (N'Revisar contrato con el proveedor de limpieza',   N'Vence en dos semanas.'),
        (N'Configurar alertas de inventario bajo',           N'Aviso automático al llegar al mínimo.'),
        (N'Actualizar precios en el catálogo',               N'Aplicar el ajuste acordado en reunión.'),
        (N'Organizar el archivo de documentos',              N'Digitalizar lo que siga en papel.'),
        (N'Optimizar la velocidad de la página de inicio',   N'Mejorar tiempos de carga en móviles.'),
        (N'Lanzar encuesta de satisfacción',                 N'Enviar a clientes de los últimos tres meses.'),
        (N'Revisar permisos de acceso del personal',         N'Dar de baja cuentas de exempleados.'),
        (N'Coordinar el envío de pedidos pendientes',        N'Confirmar con la empresa de mensajería.'),
        (N'Actualizar los términos y condiciones',           N'Revisión legal antes de publicar.'),
        (N'Preparar la reunión mensual de equipo',           N'Agenda, métricas y temas abiertos.'),
        (N'Investigar caída del servicio del viernes',       N'Analizar logs y documentar causa.'),
        (N'Diseñar plantilla de correo para boletín',        N'Que funcione bien en todos los clientes.'),
        (N'Revisar gastos de viaje del equipo',              N'Aprobar reembolsos del mes.'),
        (N'Configurar la firma digital de contratos',        N'Evaluar dos herramientas candidatas.'),
        (N'Actualizar las fotos de productos',               N'Sesión de fotografía para el catálogo nuevo.'),
        (N'Depurar la lista de correos inactivos',           N'Mejorar la entregabilidad del boletín.'),
        (N'Programar mantenimiento de servidores',           N'Ventana nocturna para minimizar impacto.'),
        (N'Redactar manual de bienvenida',                   N'Para nuevos integrantes del equipo.'),
        (N'Analizar motivos de cancelación de clientes',     N'Entrevistar a cinco bajas recientes.'),
        (N'Actualizar la versión de Node del backend',       N'Probar que todo siga funcionando.'),
        (N'Crear tablero de indicadores para gerencia',      N'Ventas, soporte y operaciones en una vista.'),
        (N'Revisar el plan de recuperación ante desastres',  N'Actualizar contactos y procedimientos.'),
        (N'Gestionar la renovación de licencias de software',N'Confirmar cuántas se usan realmente.'),
        (N'Preparar material para la feria comercial',       N'Folletos, banner y tarjetas.'),
        (N'Configurar inicio de sesión con dos factores',    N'Mayor seguridad para las cuentas internas.'),
        (N'Revisar comentarios de la última reseña',         N'Responder públicamente a los clientes.'),
        (N'Ordenar la bodega antes del inventario',          N'Dejar todo listo para el conteo.'),
        (N'Actualizar datos de contacto en el sitio',        N'Teléfono y dirección de la nueva sede.'),
        (N'Automatizar el reporte semanal de ventas',        N'Que se envíe solo los lunes.'),
        (N'Revisar la cobertura del seguro de la oficina',   N'Comparar con una póliza alternativa.'),
        (N'Planear la fiesta de fin de año',                 N'Lugar, fecha y presupuesto.'),
        (N'Corregir enlaces rotos del sitio web',            N'Detectados en la última revisión.'),
        (N'Definir objetivos del próximo trimestre',         N'Alinear metas con cada área.'),
        (N'Actualizar el inventario de equipos de cómputo',  N'Registrar altas y bajas del año.'),
        (N'Revisar el proceso de devoluciones',              N'Simplificarlo según el feedback.'),
        (N'Configurar copias automáticas en la nube',        N'Documentos compartidos del equipo.'),
        (N'Preparar la declaración de impuestos mensual',    N'Reunir comprobantes y conciliar.'),
        (N'Rediseñar la página de precios',                  N'Hacerla más clara y comparativa.'),
        (N'Evaluar proveedores de telefonía',                N'Buscar mejor plan para el equipo.'),
        (N'Crear guía rápida de preguntas frecuentes',       N'Para reducir tickets repetidos.');

    -- Reparte las tareas en ~12 meses. Las más antiguas tienden a estar completadas.
    ;WITH T AS (
        SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n, t, d FROM @Templates
    )
    INSERT INTO dbo.Tasks (Title, Description, Status, CreatedAt, CompletedAt)
    SELECT
        T.t,
        T.d,
        CASE WHEN c.CompletedAt IS NOT NULL THEN N'COMPLETED' ELSE N'PENDING' END,
        c.CreatedAt,
        c.CompletedAt
    FROM T
    CROSS APPLY (
        -- CreatedAt: más atrás cuanto mayor es n (hasta ~12 meses), con dispersión.
        SELECT CreatedAt = DATEADD(HOUR, -(T.n * 160 + (ABS(CHECKSUM(NEWID())) % 150)), GETDATE())
    ) AS c0
    CROSS APPLY (
        SELECT
            CreatedAt = c0.CreatedAt,
            -- Completadas: probabilidad mayor para las tareas más antiguas.
            CompletedAt = CASE
                WHEN (ABS(CHECKSUM(NEWID())) % 100) < (45 + T.n)
                THEN DATEADD(HOUR, (ABS(CHECKSUM(NEWID())) % 150) + 3, c0.CreatedAt)
                ELSE NULL
            END
    ) AS c
    WHERE c0.CreatedAt < GETDATE();
END
GO

PRINT N'Inicialización de base de datos completada.';
GO

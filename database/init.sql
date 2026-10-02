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
        Priority    NVARCHAR(10)       NOT NULL CONSTRAINT DF_Tasks_Priority  DEFAULT (N'MEDIUM'),
        Category    NVARCHAR(50)       NULL,
        DueDate     DATE               NULL,
        Recurrence  NVARCHAR(10)       NOT NULL CONSTRAINT DF_Tasks_Recurrence DEFAULT (N'NONE'),
        CreatedAt   DATETIME2          NOT NULL CONSTRAINT DF_Tasks_CreatedAt DEFAULT (GETDATE()),
        CompletedAt DATETIME2          NULL,

        CONSTRAINT PK_Tasks               PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_Tasks_Status        CHECK (Status IN (N'PENDING', N'COMPLETED')),
        CONSTRAINT CK_Tasks_Priority      CHECK (Priority IN (N'LOW', N'MEDIUM', N'HIGH')),
        CONSTRAINT CK_Tasks_Recurrence    CHECK (Recurrence IN (N'NONE', N'DAILY', N'WEEKLY', N'MONTHLY')),
        CONSTRAINT CK_Tasks_Title_NotBlank CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
    );
END
GO

-- Tabla de adjuntos (archivos subidos, un registro por archivo).
IF OBJECT_ID(N'dbo.TaskAttachments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TaskAttachments
    (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TaskAttachments PRIMARY KEY CLUSTERED,
        TaskId       INT               NOT NULL,
        StoredName   NVARCHAR(200)     NOT NULL,  -- nombre único en disco
        OriginalName NVARCHAR(260)     NOT NULL,  -- nombre original mostrado al usuario
        Size         BIGINT            NOT NULL,
        MimeType     NVARCHAR(150)     NULL,
        CreatedAt    DATETIME2         NOT NULL CONSTRAINT DF_TaskAttachments_CreatedAt DEFAULT (GETDATE()),
        CONSTRAINT FK_TaskAttachments_Tasks FOREIGN KEY (TaskId) REFERENCES dbo.Tasks(Id) ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX IX_TaskAttachments_TaskId ON dbo.TaskAttachments (TaskId);
END
GO

-- Migraciones idempotentes (para volúmenes de versiones anteriores).
IF COL_LENGTH(N'dbo.Tasks', N'CompletedAt') IS NULL
    ALTER TABLE dbo.Tasks ADD CompletedAt DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Tasks', N'Priority') IS NULL
    ALTER TABLE dbo.Tasks ADD Priority NVARCHAR(10) NOT NULL CONSTRAINT DF_Tasks_Priority DEFAULT (N'MEDIUM');
GO
IF COL_LENGTH(N'dbo.Tasks', N'Category') IS NULL
    ALTER TABLE dbo.Tasks ADD Category NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.Tasks', N'DueDate') IS NULL
    ALTER TABLE dbo.Tasks ADD DueDate DATE NULL;
GO
IF COL_LENGTH(N'dbo.Tasks', N'Recurrence') IS NULL
    ALTER TABLE dbo.Tasks ADD Recurrence NVARCHAR(10) NOT NULL CONSTRAINT DF_Tasks_Recurrence DEFAULT (N'NONE');
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Tasks_Recurrence')
    ALTER TABLE dbo.Tasks ADD CONSTRAINT CK_Tasks_Recurrence CHECK (Recurrence IN (N'NONE', N'DAILY', N'WEEKLY', N'MONTHLY'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Tasks_Priority')
    ALTER TABLE dbo.Tasks ADD CONSTRAINT CK_Tasks_Priority CHECK (Priority IN (N'LOW', N'MEDIUM', N'HIGH'));
GO
-- Índice para notificaciones (tareas pendientes con vencimiento).
-- Un índice filtrado exige estas SET options activas al crearlo.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Due' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE NONCLUSTERED INDEX IX_Tasks_Due ON dbo.Tasks (DueDate) INCLUDE (Title, Priority, Status) WHERE Status = N'PENDING';
GO
-- Recurrencia: cada ocurrencia generada guarda la tarea que la originó. El índice
-- único filtrado garantiza (incluso con concurrencia) que una tarea genere como
-- máximo una ocurrencia, aunque se complete, reabra y vuelva a completar.
IF COL_LENGTH(N'dbo.Tasks', N'SourceTaskId') IS NULL
    ALTER TABLE dbo.Tasks ADD SourceTaskId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Tasks_SourceTaskId' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_Tasks_SourceTaskId ON dbo.Tasks (SourceTaskId) WHERE SourceTaskId IS NOT NULL;
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

/* Filtro por categoría (función de la UI). Sin este índice el filtro hace un
   scan completo de la tabla. Con Category como clave y (CreatedAt, Id) a
   continuación, el filtro por categoría resuelve con Index Seek y ya ordenado
   por fecha; INCLUDE (Title) lo hace cubridor para el listado. */
IF NOT EXISTS (SELECT 1
               FROM sys.indexes
               WHERE name = N'IX_Tasks_Category_CreatedAt'
                 AND object_id = OBJECT_ID(N'dbo.Tasks'))
BEGIN
    PRINT N'Creando índice IX_Tasks_Category_CreatedAt...';
    CREATE NONCLUSTERED INDEX IX_Tasks_Category_CreatedAt
        ON dbo.Tasks (Category, CreatedAt DESC, Id DESC)
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
    @SortBy     NVARCHAR(10)  = N'date', -- criterio de orden: date | title | due | priority
    @Priority   NVARCHAR(10)  = NULL,   -- filtra por prioridad
    @Category   NVARCHAR(50)  = NULL    -- filtra por categoría
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
        IF @SortBy NOT IN (N'date', N'title', N'due', N'priority')
            THROW 50400, N'SortBy inválido. Valores permitidos: date, title, due, priority.', 1;

        SET @Priority = NULLIF(UPPER(LTRIM(RTRIM(@Priority))), N'');
        IF @Priority IS NOT NULL AND @Priority NOT IN (N'LOW', N'MEDIUM', N'HIGH')
            THROW 50400, N'Priority inválido. Valores permitidos: LOW, MEDIUM, HIGH.', 1;
        SET @Category = NULLIF(LTRIM(RTRIM(@Category)), N'');

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
              AND (@Priority IS NULL OR Priority = @Priority)
              AND (@Category IS NULL OR Category = @Category)
            OPTION (RECOMPILE);

            SELECT Id, Title, Description, Status, Priority, Category, DueDate, Recurrence, CreatedAt, CompletedAt
            FROM dbo.Tasks
            WHERE (@Status IS NULL OR Status = @Status)
              AND (@Like IS NULL OR Title LIKE @Like OR Description LIKE @Like)
              AND (@FromDate IS NULL OR CreatedAt >= @FromDate)
              AND (@ToExclusive IS NULL OR CreatedAt < @ToExclusive)
              AND (@Priority IS NULL OR Priority = @Priority)
              AND (@Category IS NULL OR Category = @Category)
            ORDER BY
                CASE WHEN @SortBy = N'title' AND @SortDir = N'ASC'  THEN Title END ASC,
                CASE WHEN @SortBy = N'title' AND @SortDir = N'DESC' THEN Title END DESC,
                -- Vencimiento: los NULL (sin fecha) van al final en ambos sentidos.
                CASE WHEN @SortBy = N'due' THEN CASE WHEN DueDate IS NULL THEN 1 ELSE 0 END END ASC,
                CASE WHEN @SortBy = N'due' AND @SortDir = N'ASC'  THEN DueDate END ASC,
                CASE WHEN @SortBy = N'due' AND @SortDir = N'DESC' THEN DueDate END DESC,
                -- Prioridad: mayor a menor (DESC) o menor a mayor (ASC).
                CASE WHEN @SortBy = N'priority' AND @SortDir = N'DESC'
                     THEN CASE Priority WHEN N'HIGH' THEN 3 WHEN N'MEDIUM' THEN 2 ELSE 1 END END DESC,
                CASE WHEN @SortBy = N'priority' AND @SortDir = N'ASC'
                     THEN CASE Priority WHEN N'HIGH' THEN 3 WHEN N'MEDIUM' THEN 2 ELSE 1 END END ASC,
                CASE WHEN @SortBy = N'date'  AND @SortDir = N'ASC'  THEN CreatedAt END ASC,
                CASE WHEN @SortBy = N'date'  AND @SortDir = N'DESC' THEN CreatedAt END DESC,
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
    @Description NVARCHAR(MAX) = NULL,
    @Priority    NVARCHAR(10)  = N'MEDIUM',
    @Category    NVARCHAR(50)  = NULL,
    @DueDate     DATE          = NULL,
    @Recurrence  NVARCHAR(10)  = N'NONE'
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

        SET @Priority = NULLIF(UPPER(LTRIM(RTRIM(@Priority))), N'');
        IF @Priority IS NULL SET @Priority = N'MEDIUM';
        IF @Priority NOT IN (N'LOW', N'MEDIUM', N'HIGH')
            THROW 50400, N'Priority inválido. Valores permitidos: LOW, MEDIUM, HIGH.', 1;

        SET @Recurrence = NULLIF(UPPER(LTRIM(RTRIM(@Recurrence))), N'');
        IF @Recurrence IS NULL SET @Recurrence = N'NONE';
        IF @Recurrence NOT IN (N'NONE', N'DAILY', N'WEEKLY', N'MONTHLY')
            THROW 50400, N'Recurrence inválido. Valores permitidos: NONE, DAILY, WEEKLY, MONTHLY.', 1;

        DECLARE @NewId INT;

        BEGIN TRANSACTION;
            INSERT INTO dbo.Tasks (Title, Description, Priority, Category, DueDate, Recurrence)
            VALUES (@Title, NULLIF(LTRIM(RTRIM(@Description)), N''), @Priority,
                    NULLIF(LTRIM(RTRIM(@Category)), N''), @DueDate, @Recurrence);
            SET @NewId = SCOPE_IDENTITY();
        COMMIT TRANSACTION;

        SELECT Id, Title, Description, Status, Priority, Category, DueDate, Recurrence, CreatedAt, CompletedAt
        FROM dbo.Tasks WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_UpdateTaskStatus: valida existencia, actualiza y devuelve el registro.
   Idempotente: si la tarea ya tiene ese estado no cambia nada (ni CompletedAt
   ni la recurrencia). La siguiente ocurrencia solo se crea en la transición
   PENDING -> COMPLETED y una sola vez por tarea (SourceTaskId). */
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

        BEGIN TRANSACTION;

            -- UPDLOCK + HOLDLOCK: la fila no puede cambiar ni desaparecer entre la lectura y el UPDATE.
            DECLARE @OldStatus NVARCHAR(20), @Rec NVARCHAR(10), @OldDue DATE, @T NVARCHAR(150),
                    @D NVARCHAR(MAX), @P NVARCHAR(10), @C NVARCHAR(50);
            SELECT @OldStatus = Status, @Rec = Recurrence, @OldDue = DueDate, @T = Title,
                   @D = Description, @P = Priority, @C = Category
            FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @TaskId;

            IF @OldStatus IS NULL
                THROW 50404, N'La tarea solicitada no existe.', 1;

            IF @OldStatus <> @Status
            BEGIN
                -- Al completar se sella la fecha de culminación; al reabrir se limpia.
                UPDATE dbo.Tasks
                   SET Status = @Status,
                       CompletedAt = CASE WHEN @Status = N'COMPLETED' THEN GETDATE() ELSE NULL END
                 WHERE Id = @TaskId;

                -- Recurrencia: al completar una tarea que se repite se crea la siguiente
                -- ocurrencia, salvo que ya se hubiera generado antes (reabrir y completar).
                IF @Status = N'COMPLETED' AND @Rec <> N'NONE'
                   AND NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE SourceTaskId = @TaskId)
                BEGIN
                    DECLARE @Base DATE = ISNULL(@OldDue, CAST(GETDATE() AS DATE));
                    DECLARE @NextDue DATE =
                        CASE @Rec
                            WHEN N'DAILY'   THEN DATEADD(DAY, 1, @Base)
                            WHEN N'WEEKLY'  THEN DATEADD(WEEK, 1, @Base)
                            WHEN N'MONTHLY' THEN DATEADD(MONTH, 1, @Base)
                        END;
                    INSERT INTO dbo.Tasks (Title, Description, Priority, Category, DueDate, Recurrence, SourceTaskId)
                    VALUES (@T, @D, @P, @C, @NextDue, @Rec, @TaskId);
                END
            END

        COMMIT TRANSACTION;

        SELECT Id, Title, Description, Status, Priority, Category, DueDate, Recurrence, CreatedAt, CompletedAt
        FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_UpdateTask: edita título, descripción, prioridad, categoría y vencimiento (CRUD - Update). */
CREATE OR ALTER PROCEDURE dbo.sp_UpdateTask
    @TaskId      INT,
    @Title       NVARCHAR(4000),
    @Description NVARCHAR(MAX) = NULL,
    @Priority    NVARCHAR(10)  = N'MEDIUM',
    @Category    NVARCHAR(50)  = NULL,
    @DueDate     DATE          = NULL,
    @Recurrence  NVARCHAR(10)  = N'NONE'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @TaskId IS NULL OR @TaskId < 1
            THROW 50400, N'TaskId inválido.', 1;

        SET @Title = LTRIM(RTRIM(@Title));
        IF @Title IS NULL OR LEN(@Title) = 0
            THROW 50400, N'Title es obligatorio.', 1;
        IF LEN(@Title) > 150
            THROW 50400, N'Title no puede superar 150 caracteres.', 1;

        SET @Priority = NULLIF(UPPER(LTRIM(RTRIM(@Priority))), N'');
        IF @Priority IS NULL SET @Priority = N'MEDIUM';
        IF @Priority NOT IN (N'LOW', N'MEDIUM', N'HIGH')
            THROW 50400, N'Priority inválido. Valores permitidos: LOW, MEDIUM, HIGH.', 1;

        SET @Recurrence = NULLIF(UPPER(LTRIM(RTRIM(@Recurrence))), N'');
        IF @Recurrence IS NULL SET @Recurrence = N'NONE';
        IF @Recurrence NOT IN (N'NONE', N'DAILY', N'WEEKLY', N'MONTHLY')
            THROW 50400, N'Recurrence inválido. Valores permitidos: NONE, DAILY, WEEKLY, MONTHLY.', 1;

        BEGIN TRANSACTION;

            IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @TaskId)
                THROW 50404, N'La tarea solicitada no existe.', 1;

            UPDATE dbo.Tasks
               SET Title = @Title,
                   Description = NULLIF(LTRIM(RTRIM(@Description)), N''),
                   Priority = @Priority,
                   Category = NULLIF(LTRIM(RTRIM(@Category)), N''),
                   DueDate = @DueDate,
                   Recurrence = @Recurrence
             WHERE Id = @TaskId;

        COMMIT TRANSACTION;

        SELECT Id, Title, Description, Status, Priority, Category, DueDate, Recurrence, CreatedAt, CompletedAt
        FROM dbo.Tasks WHERE Id = @TaskId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_DeleteTask: elimina una tarea (CRUD - Delete). Valida existencia.
   Los adjuntos se borran en cascada; StoredNames (JSON) devuelve sus nombres en
   disco para que el backend elimine también los archivos. */
CREATE OR ALTER PROCEDURE dbo.sp_DeleteTask
    @TaskId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @TaskId IS NULL OR @TaskId < 1
            THROW 50400, N'TaskId inválido.', 1;

        DECLARE @Files TABLE (StoredName NVARCHAR(200));

        BEGIN TRANSACTION;

            IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @TaskId)
                THROW 50404, N'La tarea solicitada no existe.', 1;

            INSERT INTO @Files (StoredName)
            SELECT StoredName FROM dbo.TaskAttachments WHERE TaskId = @TaskId;

            DELETE FROM dbo.Tasks WHERE Id = @TaskId;

        COMMIT TRANSACTION;

        SELECT @TaskId AS DeletedId,
               (SELECT StoredName FROM @Files FOR JSON PATH) AS StoredNames;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_BulkUpdateStatus: cambia el estado de varias tareas a la vez (selección múltiple).
   @Ids: arreglo JSON de enteros, p. ej. '[1,2,3]'. Devuelve la cantidad que cambió de estado.
   Mismas reglas que sp_UpdateTaskStatus: solo toca las filas cuyo estado cambia y
   genera la siguiente ocurrencia de las recurrentes que pasan a COMPLETED. */
CREATE OR ALTER PROCEDURE dbo.sp_BulkUpdateStatus
    @Ids    NVARCHAR(MAX),
    @Status NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @Status IS NULL OR @Status NOT IN (N'PENDING', N'COMPLETED')
            THROW 50400, N'Status inválido. Valores permitidos: PENDING, COMPLETED.', 1;

        DECLARE @List TABLE (Id INT PRIMARY KEY);
        INSERT INTO @List (Id)
        SELECT DISTINCT TRY_CAST(value AS INT)
        FROM OPENJSON(@Ids)
        WHERE TRY_CAST(value AS INT) IS NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM @List)
            THROW 50400, N'Debe indicar al menos un identificador válido.', 1;

        DECLARE @Affected INT;
        BEGIN TRANSACTION;
            -- Recurrencia: se calcula antes del UPDATE, mientras aún se ve el estado anterior.
            IF @Status = N'COMPLETED'
                INSERT INTO dbo.Tasks (Title, Description, Priority, Category, DueDate, Recurrence, SourceTaskId)
                SELECT t.Title, t.Description, t.Priority, t.Category,
                       CASE t.Recurrence
                           WHEN N'DAILY'   THEN DATEADD(DAY,   1, ISNULL(t.DueDate, CAST(GETDATE() AS DATE)))
                           WHEN N'WEEKLY'  THEN DATEADD(WEEK,  1, ISNULL(t.DueDate, CAST(GETDATE() AS DATE)))
                           WHEN N'MONTHLY' THEN DATEADD(MONTH, 1, ISNULL(t.DueDate, CAST(GETDATE() AS DATE)))
                       END,
                       t.Recurrence, t.Id
                FROM dbo.Tasks t WITH (UPDLOCK, HOLDLOCK)
                JOIN @List l ON l.Id = t.Id
                WHERE t.Status = N'PENDING'
                  AND t.Recurrence <> N'NONE'
                  AND NOT EXISTS (SELECT 1 FROM dbo.Tasks s WHERE s.SourceTaskId = t.Id);

            UPDATE t
               SET t.Status = @Status,
                   t.CompletedAt = CASE WHEN @Status = N'COMPLETED' THEN GETDATE() ELSE NULL END
            FROM dbo.Tasks t
            JOIN @List l ON l.Id = t.Id
            WHERE t.Status <> @Status;
            -- @@ROWCOUNT debe leerse antes del COMMIT (el COMMIT lo reinicia a 0).
            SET @Affected = @@ROWCOUNT;
        COMMIT TRANSACTION;

        SELECT @Affected AS Affected;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_BulkDeleteTasks: elimina varias tareas (selección múltiple).
   Devuelve Affected y StoredNames (JSON) con los archivos adjuntos a borrar del disco. */
CREATE OR ALTER PROCEDURE dbo.sp_BulkDeleteTasks
    @Ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        DECLARE @List TABLE (Id INT PRIMARY KEY);
        INSERT INTO @List (Id)
        SELECT DISTINCT TRY_CAST(value AS INT)
        FROM OPENJSON(@Ids)
        WHERE TRY_CAST(value AS INT) IS NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM @List)
            THROW 50400, N'Debe indicar al menos un identificador válido.', 1;

        DECLARE @Affected INT;
        DECLARE @Files TABLE (StoredName NVARCHAR(200));
        BEGIN TRANSACTION;
            INSERT INTO @Files (StoredName)
            SELECT a.StoredName
            FROM dbo.TaskAttachments a WITH (UPDLOCK, HOLDLOCK)
            JOIN @List l ON l.Id = a.TaskId;

            DELETE t FROM dbo.Tasks t JOIN @List l ON l.Id = t.Id;
            -- @@ROWCOUNT debe leerse antes del COMMIT (el COMMIT lo reinicia a 0).
            SET @Affected = @@ROWCOUNT;
        COMMIT TRANSACTION;

        SELECT @Affected AS Affected,
               (SELECT StoredName FROM @Files FOR JSON PATH) AS StoredNames;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* ---------------------------------------------------------------------------
   Adjuntos y calendario
   --------------------------------------------------------------------------- */

/* sp_AddAttachment: registra un archivo subido para una tarea. */
CREATE OR ALTER PROCEDURE dbo.sp_AddAttachment
    @TaskId       INT,
    @StoredName   NVARCHAR(200),
    @OriginalName NVARCHAR(260),
    @Size         BIGINT,
    @MimeType     NVARCHAR(150) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        DECLARE @NewId INT;

        BEGIN TRANSACTION;
            -- UPDLOCK: si la tarea se está borrando en paralelo, espera y luego falla con 404.
            IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @TaskId)
                THROW 50404, N'La tarea solicitada no existe.', 1;

            INSERT INTO dbo.TaskAttachments (TaskId, StoredName, OriginalName, Size, MimeType)
            VALUES (@TaskId, @StoredName, @OriginalName, @Size, @MimeType);
            SET @NewId = SCOPE_IDENTITY();
        COMMIT TRANSACTION;

        SELECT Id, TaskId, StoredName, OriginalName, Size, MimeType, CreatedAt
        FROM dbo.TaskAttachments WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_GetAttachments: lista los adjuntos de una tarea (lectura: sin transacción). */
CREATE OR ALTER PROCEDURE dbo.sp_GetAttachments
    @TaskId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        SELECT Id, TaskId, StoredName, OriginalName, Size, MimeType, CreatedAt
        FROM dbo.TaskAttachments
        WHERE TaskId = @TaskId
        ORDER BY CreatedAt DESC, Id DESC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END
GO

/* sp_GetAttachment: un adjunto por id (para descargar). Lectura: sin transacción. */
CREATE OR ALTER PROCEDURE dbo.sp_GetAttachment
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        SELECT Id, TaskId, StoredName, OriginalName, Size, MimeType, CreatedAt
        FROM dbo.TaskAttachments WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END
GO

/* sp_DeleteAttachment: elimina el registro y devuelve el nombre en disco para borrar el archivo. */
CREATE OR ALTER PROCEDURE dbo.sp_DeleteAttachment
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        DECLARE @Stored NVARCHAR(200);
        BEGIN TRANSACTION;
            SELECT @Stored = StoredName FROM dbo.TaskAttachments WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id;
            IF @Stored IS NULL THROW 50404, N'El adjunto solicitado no existe.', 1;
            DELETE FROM dbo.TaskAttachments WHERE Id = @Id;
        COMMIT TRANSACTION;
        SELECT @Stored AS StoredName;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

/* sp_GetDueTasks: tareas PENDIENTES con fecha de vencimiento (para el feed de calendario .ics).
   Lectura: sin transacción. */
CREATE OR ALTER PROCEDURE dbo.sp_GetDueTasks
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        SELECT Id, Title, Description, Priority, Category, DueDate
        FROM dbo.Tasks
        WHERE Status = N'PENDING' AND DueDate IS NOT NULL
        ORDER BY DueDate ASC, Id ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END
GO

/* sp_GetNotifications: tareas PENDIENTES vencidas o próximas a vencer.
   @Days: ventana de "por vencer" en días (por defecto 3).
   Devuelve 2 result sets:
     [0] Contadores (Overdue, DueSoon)
     [1] Lista (hasta @Top) ordenada por vencimiento ascendente. */
CREATE OR ALTER PROCEDURE dbo.sp_GetNotifications
    @Days INT = 3,
    @Top  INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        IF @Days IS NULL OR @Days < 0 SET @Days = 3;
        IF @Top IS NULL OR @Top < 1 OR @Top > 100 SET @Top = 20;

        DECLARE @Today DATE = CAST(GETDATE() AS DATE);
        DECLARE @Limit DATE = DATEADD(DAY, @Days, @Today);

        SELECT
            SUM(CASE WHEN DueDate < @Today THEN 1 ELSE 0 END)                          AS Overdue,
            SUM(CASE WHEN DueDate >= @Today AND DueDate <= @Limit THEN 1 ELSE 0 END)   AS DueSoon
        FROM dbo.Tasks
        WHERE Status = N'PENDING' AND DueDate IS NOT NULL;

        SELECT TOP (@Top) Id, Title, Priority, Category, DueDate,
               CASE WHEN DueDate < @Today THEN N'OVERDUE' ELSE N'DUE_SOON' END AS Kind
        FROM dbo.Tasks
        WHERE Status = N'PENDING' AND DueDate IS NOT NULL AND DueDate <= @Limit
        ORDER BY DueDate ASC, Id ASC;
    END TRY
    BEGIN CATCH
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
    @Granularity NVARCHAR(10) = N'month',  -- unidad del bucket: day | week | month | year
    @FromDate    DATE         = NULL,       -- acota el análisis a un periodo (inclusive)
    @ToDate      DATE         = NULL        -- fin del periodo (inclusive)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        SET @Granularity = LOWER(LTRIM(RTRIM(ISNULL(@Granularity, N'month'))));
        IF @Granularity NOT IN (N'day', N'week', N'month', N'year')
            THROW 50400, N'Granularity inválido. Valores permitidos: day, week, month, year.', 1;

        IF @FromDate IS NOT NULL AND @ToDate IS NOT NULL AND @FromDate > @ToDate
            THROW 50400, N'El rango de fechas es inválido: la fecha inicial supera la final.', 1;

        -- @ToDate es inclusivo: se cubre hasta el final de ese día.
        DECLARE @ToExclusive DATETIME2 = CASE WHEN @ToDate IS NOT NULL THEN DATEADD(DAY, 1, @ToDate) END;

        SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

        -- [0] Totales + tiempo medio de culminación (en horas), acotados al periodo si se indica.
        --     El periodo se aplica sobre la fecha de creación (cohorte creada en el periodo).
        SELECT
            COUNT_BIG(*)                                                     AS Total,
            SUM(CASE WHEN Status = N'PENDING'   THEN 1 ELSE 0 END)           AS Pending,
            SUM(CASE WHEN Status = N'COMPLETED' THEN 1 ELSE 0 END)           AS Completed,
            AVG(CASE WHEN CompletedAt IS NOT NULL
                     THEN DATEDIFF(MINUTE, CreatedAt, CompletedAt) * 1.0 / 60 END) AS AvgCompletionHours
        FROM dbo.Tasks
        WHERE (@FromDate    IS NULL OR CreatedAt >= @FromDate)
          AND (@ToExclusive IS NULL OR CreatedAt <  @ToExclusive);

        -- Truncamiento del bucket, independiente de DATEFIRST/idioma:
        --   day -> ese día | week -> lunes de la semana | month -> día 1 | year -> 1 de enero
        -- [1] Creadas por bucket
        SELECT
            CAST(
                CASE @Granularity
                    WHEN N'day'   THEN CAST(CreatedAt AS DATE)
                    WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CreatedAt) % 7), CreatedAt)
                    WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CreatedAt), 0)
                    ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CreatedAt), 0)
                END AS DATE) AS Bucket,
            COUNT_BIG(*)     AS Cnt
        FROM dbo.Tasks
        WHERE (@FromDate    IS NULL OR CreatedAt >= @FromDate)
          AND (@ToExclusive IS NULL OR CreatedAt <  @ToExclusive)
        GROUP BY
            CASE @Granularity
                WHEN N'day'   THEN CAST(CreatedAt AS DATE)
                WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CreatedAt) % 7), CreatedAt)
                WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CreatedAt), 0)
                ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CreatedAt), 0)
            END
        ORDER BY Bucket;

        -- [2] Completadas por bucket (según la fecha de culminación, dentro del periodo)
        SELECT
            CAST(
                CASE @Granularity
                    WHEN N'day'   THEN CAST(CompletedAt AS DATE)
                    WHEN N'week'  THEN DATEADD(DAY,   -(DATEDIFF(DAY,   0, CompletedAt) % 7), CompletedAt)
                    WHEN N'month' THEN DATEADD(MONTH,  DATEDIFF(MONTH,  0, CompletedAt), 0)
                    ELSE               DATEADD(YEAR,   DATEDIFF(YEAR,   0, CompletedAt), 0)
                END AS DATE) AS Bucket,
            COUNT_BIG(*)     AS Cnt
        FROM dbo.Tasks
        WHERE CompletedAt IS NOT NULL
          AND (@FromDate    IS NULL OR CompletedAt >= @FromDate)
          AND (@ToExclusive IS NULL OR CompletedAt <  @ToExclusive)
        GROUP BY
            CASE @Granularity
                WHEN N'day'   THEN CAST(CompletedAt AS DATE)
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
    INSERT INTO dbo.Tasks (Title, Description, Status, Priority, Category, DueDate, Recurrence, CreatedAt, CompletedAt)
    SELECT
        T.t,
        T.d,
        CASE WHEN c.CompletedAt IS NOT NULL THEN N'COMPLETED' ELSE N'PENDING' END,
        -- Prioridad: ~25% alta, ~45% media, ~30% baja.
        CASE WHEN p.r < 25 THEN N'HIGH' WHEN p.r < 70 THEN N'MEDIUM' ELSE N'LOW' END,
        -- Categoría rotativa de un conjunto realista.
        CHOOSE((T.n % 7) + 1, N'Trabajo', N'Finanzas', N'Clientes', N'TI', N'Administración', N'Marketing', N'Personal'),
        -- Vencimiento solo para pendientes: algunas vencidas, otras próximas, otras más lejanas.
        CASE WHEN c.CompletedAt IS NOT NULL THEN NULL
             ELSE DATEADD(DAY, (ABS(CHECKSUM(NEWID())) % 30) - 7, CAST(GETDATE() AS DATE)) END,
        -- Recurrencia: unas pocas se repiten (diaria/semanal/mensual).
        CASE WHEN c.CompletedAt IS NOT NULL THEN N'NONE'
             WHEN p.r < 8 THEN N'WEEKLY' WHEN p.r < 14 THEN N'MONTHLY' WHEN p.r < 17 THEN N'DAILY'
             ELSE N'NONE' END,
        c.CreatedAt,
        c.CompletedAt
    FROM T
    CROSS APPLY (SELECT r = ABS(CHECKSUM(NEWID())) % 100) AS p
    CROSS APPLY (
        SELECT CreatedAt = DATEADD(HOUR, -(T.n * 160 + (ABS(CHECKSUM(NEWID())) % 150)), GETDATE())
    ) AS c0
    CROSS APPLY (
        SELECT
            CreatedAt = c0.CreatedAt,
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

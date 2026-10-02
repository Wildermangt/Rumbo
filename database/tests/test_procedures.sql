/* =============================================================================
   Pruebas de los procedimientos almacenados de TasksDb
   -----------------------------------------------------------------------------
   Ejecuta cada SP con casos correctos, límites y errores de negocio, y verifica
   el resultado. Las filas de prueba usan el prefijo 'ZZTEST' y se borran al final
   (el FK en cascada limpia también sus adjuntos). No altera los datos de ejemplo.

   Uso (dentro del contenedor):
     sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -No -d TasksDb -b -i test_procedures.sql
   El flag -b hace que sqlcmd devuelva código de error si alguna prueba falla.
   ============================================================================= */
SET NOCOUNT ON;
-- La tabla Tasks tiene un índice filtrado (IX_Tasks_Due); cualquier DML directo
-- sobre ella requiere estas opciones activas (sqlcmd las deja en OFF por defecto).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
USE TasksDb;

IF OBJECT_ID('tempdb..#r') IS NOT NULL DROP TABLE #r;
CREATE TABLE #r (id INT IDENTITY(1,1), name NVARCHAR(200), ok BIT, detail NVARCHAR(400));

DECLARE @errno INT, @affected INT, @cnt INT;

-- Tablas para capturar los result sets de un solo conjunto (INSERT ... EXEC).
DECLARE @task TABLE (Id INT, Title NVARCHAR(150), Description NVARCHAR(MAX), Status NVARCHAR(20),
                     Priority NVARCHAR(10), Category NVARCHAR(50), DueDate DATE, Recurrence NVARCHAR(10),
                     CreatedAt DATETIME2, CompletedAt DATETIME2);
DECLARE @att  TABLE (Id INT, TaskId INT, StoredName NVARCHAR(200), OriginalName NVARCHAR(260),
                     Size BIGINT, MimeType NVARCHAR(150), CreatedAt DATETIME2);
DECLARE @bulk TABLE (Affected INT);
DECLARE @del  TABLE (DeletedId INT, StoredNames NVARCHAR(MAX));
DECLARE @bulkdel TABLE (Affected INT, StoredNames NVARCHAR(MAX));
DECLARE @stored TABLE (StoredName NVARCHAR(200));

DECLARE @id1 INT, @id2 INT, @id3 INT, @recId INT, @attId INT;
-- T-SQL no admite expresiones como argumento de EXEC: se precalculan en variables.
DECLARE @bigtitle NVARCHAR(4000), @ids NVARCHAR(100), @json NVARCHAR(MAX), @firstCompleted DATETIME2, @againCompleted DATETIME2;

/* ---------------------------------------------------------------------------
   sp_CreateTask
   --------------------------------------------------------------------------- */
-- OK: valores por defecto
DELETE FROM @task;
BEGIN TRY
    INSERT INTO @task EXEC dbo.sp_CreateTask @Title = N'ZZTEST crear por defecto';
    SELECT @id1 = Id FROM @task;
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_CreateTask: defaults (PENDING/MEDIUM/NONE)',
           CASE WHEN Status=N'PENDING' AND Priority=N'MEDIUM' AND Recurrence=N'NONE' AND CompletedAt IS NULL THEN 1 ELSE 0 END,
           CONCAT('Status=',Status,' Priority=',Priority,' Recurrence=',Recurrence)
    FROM @task;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: defaults', 0, CONCAT('Excepción ', ERROR_NUMBER(), ': ', ERROR_MESSAGE()));
END CATCH

-- OK: con todos los campos
DELETE FROM @task;
BEGIN TRY
    INSERT INTO @task EXEC dbo.sp_CreateTask @Title=N'ZZTEST crear completo', @Description=N'desc',
        @Priority=N'high', @Category=N'Finanzas', @DueDate='2030-06-15', @Recurrence=N'weekly';
    SELECT @id2 = Id FROM @task;
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_CreateTask: todos los campos (normaliza mayúsculas)',
           CASE WHEN Priority=N'HIGH' AND Category=N'Finanzas' AND DueDate='2030-06-15' AND Recurrence=N'WEEKLY' THEN 1 ELSE 0 END,
           CONCAT('Priority=',Priority,' Recurrence=',Recurrence,' Due=',CONVERT(CHAR(10),DueDate,120))
    FROM @task;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: todos los campos', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL esperado: título vacío -> 50400
BEGIN TRY
    EXEC dbo.sp_CreateTask @Title = N'   ';
    INSERT INTO #r VALUES ('sp_CreateTask: título vacío debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: título vacío -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL esperado: título > 150 -> 50400
SET @bigtitle = REPLICATE(N'x', 151);
BEGIN TRY
    EXEC dbo.sp_CreateTask @Title = @bigtitle;
    INSERT INTO #r VALUES ('sp_CreateTask: título largo debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: título > 150 -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL esperado: prioridad inválida -> 50400
BEGIN TRY
    EXEC dbo.sp_CreateTask @Title=N'ZZTEST pri', @Priority=N'URGENTE';
    INSERT INTO #r VALUES ('sp_CreateTask: prioridad inválida debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: prioridad inválida -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL esperado: recurrencia inválida -> 50400
BEGIN TRY
    EXEC dbo.sp_CreateTask @Title=N'ZZTEST rec', @Recurrence=N'YEARLY';
    INSERT INTO #r VALUES ('sp_CreateTask: recurrencia inválida debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_CreateTask: recurrencia inválida -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   sp_UpdateTask
   --------------------------------------------------------------------------- */
DELETE FROM @task;
BEGIN TRY
    INSERT INTO @task EXEC dbo.sp_UpdateTask @TaskId=@id1, @Title=N'ZZTEST actualizado', @Priority=N'LOW', @Category=N'TI', @DueDate='2031-01-01', @Recurrence=N'MONTHLY';
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_UpdateTask: edita campos', CASE WHEN Title=N'ZZTEST actualizado' AND Priority=N'LOW' AND Category=N'TI' AND Recurrence=N'MONTHLY' THEN 1 ELSE 0 END,
           CONCAT('Title=',Title,' Priority=',Priority) FROM @task;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTask: edita campos', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: id inexistente -> 50404
BEGIN TRY
    EXEC dbo.sp_UpdateTask @TaskId=2000000000, @Title=N'ZZTEST x';
    INSERT INTO #r VALUES ('sp_UpdateTask: id inexistente debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTask: id inexistente -> 50404', CASE WHEN ERROR_NUMBER()=50404 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   sp_UpdateTaskStatus  (+ recurrencia + fecha de culminación)
   --------------------------------------------------------------------------- */
-- Crea una tarea recurrente semanal con vencimiento conocido
DELETE FROM @task;
INSERT INTO @task EXEC dbo.sp_CreateTask @Title=N'ZZTEST recurrente', @DueDate='2030-03-01', @Recurrence=N'WEEKLY';
SELECT @id3 = Id FROM @task;

-- OK: completar sella CompletedAt
DELETE FROM @task;
BEGIN TRY
    INSERT INTO @task EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'COMPLETED';
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_UpdateTaskStatus: completar sella CompletedAt', CASE WHEN Status=N'COMPLETED' AND CompletedAt IS NOT NULL THEN 1 ELSE 0 END,
           CONCAT('CompletedAt=',CONVERT(VARCHAR(30),CompletedAt,120)) FROM @task;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: completar', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- Recurrencia: debe existir una nueva ocurrencia PENDING con vencimiento +7 días
SELECT @recId = Id FROM dbo.Tasks WHERE Title=N'ZZTEST recurrente' AND Status=N'PENDING' AND DueDate='2030-03-08';
INSERT INTO #r VALUES ('sp_UpdateTaskStatus: recurrencia crea próxima ocurrencia (+7d)', CASE WHEN @recId IS NOT NULL THEN 1 ELSE 0 END,
    CONCAT('nuevaId=', ISNULL(CONVERT(VARCHAR(10),@recId),'NULL')));

-- OK: reabrir limpia CompletedAt
DELETE FROM @task;
BEGIN TRY
    INSERT INTO @task EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'PENDING';
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_UpdateTaskStatus: reabrir limpia CompletedAt', CASE WHEN Status=N'PENDING' AND CompletedAt IS NULL THEN 1 ELSE 0 END, '' FROM @task;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: reabrir', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- Recurrencia sin duplicados: completar otra vez tras reabrir, y repetir COMPLETED,
-- no crea más ocurrencias. Repetir COMPLETED tampoco cambia CompletedAt (idempotente).
BEGIN TRY
    DELETE FROM @task; INSERT INTO @task EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'COMPLETED';
    SELECT @firstCompleted = CompletedAt FROM @task;
    WAITFOR DELAY '00:00:00.050';
    DELETE FROM @task; INSERT INTO @task EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'COMPLETED';
    SELECT @againCompleted = CompletedAt FROM @task;
    SELECT @cnt = COUNT(*) FROM dbo.Tasks WHERE SourceTaskId=@id3;
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: recurrencia no duplica ocurrencias', CASE WHEN @cnt=1 THEN 1 ELSE 0 END, CONCAT('ocurrencias=',@cnt));
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: COMPLETED repetido es idempotente', CASE WHEN @againCompleted=@firstCompleted THEN 1 ELSE 0 END,
        CONCAT('antes=',CONVERT(VARCHAR(30),@firstCompleted,121),' despues=',CONVERT(VARCHAR(30),@againCompleted,121)));
    DELETE FROM @task; INSERT INTO @task EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'PENDING';
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: recurrencia sin duplicados', 0, CONCAT('Excepción ', ERROR_NUMBER(), ' ', ERROR_MESSAGE()));
END CATCH

-- FAIL: estado inválido -> 50400
BEGIN TRY
    EXEC dbo.sp_UpdateTaskStatus @TaskId=@id3, @Status=N'ARCHIVED';
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: estado inválido debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: estado inválido -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL: id inexistente -> 50404
BEGIN TRY
    EXEC dbo.sp_UpdateTaskStatus @TaskId=2000000000, @Status=N'COMPLETED';
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: id inexistente debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_UpdateTaskStatus: id inexistente -> 50404', CASE WHEN ERROR_NUMBER()=50404 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   sp_GetTasks  (validaciones + ejecución; los conteos los cubre la app)
   --------------------------------------------------------------------------- */
-- OK: ejecución con filtros no lanza error
BEGIN TRY
    EXEC dbo.sp_GetTasks @Status=N'PENDING', @PageNumber=1, @PageSize=5, @Search=N'ZZTEST', @SortBy=N'priority', @SortDir=N'DESC', @Priority=N'HIGH';
    INSERT INTO #r VALUES ('sp_GetTasks: ejecución con filtros', 1, 'OK');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTasks: ejecución con filtros', 0, CONCAT('Excepción ', ERROR_NUMBER(), ': ', ERROR_MESSAGE()));
END CATCH

-- FAIL: PageSize > 100 -> 50400
BEGIN TRY
    EXEC dbo.sp_GetTasks @PageSize=101;
    INSERT INTO #r VALUES ('sp_GetTasks: PageSize>100 debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTasks: PageSize>100 -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL: status inválido -> 50400
BEGIN TRY
    EXEC dbo.sp_GetTasks @Status=N'FOO';
    INSERT INTO #r VALUES ('sp_GetTasks: status inválido debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTasks: status inválido -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL: sortBy inválido -> 50400
BEGIN TRY
    EXEC dbo.sp_GetTasks @SortBy=N'color';
    INSERT INTO #r VALUES ('sp_GetTasks: sortBy inválido debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTasks: sortBy inválido -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL: rango de fechas inválido -> 50400
BEGIN TRY
    EXEC dbo.sp_GetTasks @FromDate='2030-12-01', @ToDate='2030-01-01';
    INSERT INTO #r VALUES ('sp_GetTasks: rango fechas inválido debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTasks: rango fechas inválido -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   sp_AddAttachment / sp_GetAttachments / sp_GetAttachment / sp_DeleteAttachment
   --------------------------------------------------------------------------- */
DELETE FROM @att;
BEGIN TRY
    INSERT INTO @att EXEC dbo.sp_AddAttachment @TaskId=@id2, @StoredName=N'abc.bin', @OriginalName=N'informe.pdf', @Size=2048, @MimeType=N'application/pdf';
    SELECT @attId = Id FROM @att;
    INSERT INTO #r(name, ok, detail)
    SELECT 'sp_AddAttachment: registra adjunto', CASE WHEN TaskId=@id2 AND OriginalName=N'informe.pdf' AND Size=2048 THEN 1 ELSE 0 END, '' FROM @att;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_AddAttachment: registra adjunto', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: adjunto para tarea inexistente -> 50404
BEGIN TRY
    INSERT INTO @att EXEC dbo.sp_AddAttachment @TaskId=2000000000, @StoredName=N'x', @OriginalName=N'x', @Size=1;
    INSERT INTO #r VALUES ('sp_AddAttachment: tarea inexistente debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_AddAttachment: tarea inexistente -> 50404', CASE WHEN ERROR_NUMBER()=50404 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- sp_GetAttachments
DELETE FROM @att;
INSERT INTO @att EXEC dbo.sp_GetAttachments @TaskId=@id2;
SELECT @cnt = COUNT(*) FROM @att;
INSERT INTO #r VALUES ('sp_GetAttachments: lista del task', CASE WHEN @cnt>=1 THEN 1 ELSE 0 END, CONCAT('filas=',@cnt));

-- sp_GetAttachment
DELETE FROM @att;
INSERT INTO @att EXEC dbo.sp_GetAttachment @Id=@attId;
INSERT INTO #r(name, ok, detail) SELECT 'sp_GetAttachment: uno por id', CASE WHEN Id=@attId THEN 1 ELSE 0 END, '' FROM @att;

-- sp_DeleteAttachment (devuelve StoredName)
DELETE FROM @stored;
BEGIN TRY
    INSERT INTO @stored EXEC dbo.sp_DeleteAttachment @Id=@attId;
    SELECT @cnt = COUNT(*) FROM dbo.TaskAttachments WHERE Id=@attId;
    INSERT INTO #r(name, ok, detail) SELECT 'sp_DeleteAttachment: borra y devuelve StoredName',
        CASE WHEN StoredName=N'abc.bin' AND @cnt=0 THEN 1 ELSE 0 END, CONCAT('restantes=',@cnt) FROM @stored;
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_DeleteAttachment', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: adjunto inexistente -> 50404
BEGIN TRY
    INSERT INTO @stored EXEC dbo.sp_DeleteAttachment @Id=2000000000;
    INSERT INTO #r VALUES ('sp_DeleteAttachment: inexistente debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_DeleteAttachment: inexistente -> 50404', CASE WHEN ERROR_NUMBER()=50404 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- Cascada: adjunto se borra al borrar la tarea (añade uno y luego borra la tarea)
DELETE FROM @att;
INSERT INTO @att EXEC dbo.sp_AddAttachment @TaskId=@id2, @StoredName=N'cas.bin', @OriginalName=N'cas.pdf', @Size=10;
SELECT @attId = Id FROM @att;

/* ---------------------------------------------------------------------------
   sp_BulkUpdateStatus / sp_BulkDeleteTasks
   --------------------------------------------------------------------------- */
-- OK: marca dos como completadas
DELETE FROM @bulk;
SET @ids = CONCAT('[', @id1, ',', @id3, ']');
BEGIN TRY
    INSERT INTO @bulk EXEC dbo.sp_BulkUpdateStatus @Ids = @ids, @Status=N'COMPLETED';
    SELECT @affected = Affected FROM @bulk;
    SELECT @cnt = COUNT(*) FROM dbo.Tasks WHERE Id IN (@id1,@id3) AND Status=N'COMPLETED';
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: afecta 2 filas', CASE WHEN @affected=2 AND @cnt=2 THEN 1 ELSE 0 END, CONCAT('Affected=',@affected));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: afecta 2 filas', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- Repetir el mismo estado no cuenta filas (solo cuenta las que cambian)
DELETE FROM @bulk;
BEGIN TRY
    INSERT INTO @bulk EXEC dbo.sp_BulkUpdateStatus @Ids = @ids, @Status=N'COMPLETED';
    SELECT @affected = Affected FROM @bulk;
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: estado repetido afecta 0', CASE WHEN @affected=0 THEN 1 ELSE 0 END, CONCAT('Affected=',@affected));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: estado repetido', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- Recurrencia en lote: completar una diaria crea su próxima ocurrencia (+1d)
DELETE FROM @task;
INSERT INTO @task EXEC dbo.sp_CreateTask @Title=N'ZZTEST rec lote', @DueDate='2030-05-01', @Recurrence=N'DAILY';
SELECT @id2 = Id FROM @task;
DELETE FROM @bulk;
SET @ids = CONCAT('[', @id2, ']');
BEGIN TRY
    INSERT INTO @bulk EXEC dbo.sp_BulkUpdateStatus @Ids = @ids, @Status=N'COMPLETED';
    SELECT @cnt = COUNT(*) FROM dbo.Tasks WHERE SourceTaskId=@id2 AND DueDate='2030-05-02' AND Status=N'PENDING';
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: recurrencia crea próxima ocurrencia (+1d)', CASE WHEN @cnt=1 THEN 1 ELSE 0 END, CONCAT('ocurrencias=',@cnt));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: recurrencia', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH
-- Restaura @id2 a la tarea con adjunto para la prueba de cascada.
SELECT @id2 = TaskId FROM @att;

-- FAIL: ids vacíos -> 50400
BEGIN TRY
    EXEC dbo.sp_BulkUpdateStatus @Ids=N'[]', @Status=N'PENDING';
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: ids vacíos debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: ids vacíos -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- FAIL: estado inválido -> 50400
BEGIN TRY
    EXEC dbo.sp_BulkUpdateStatus @Ids=N'[1]', @Status=N'FOO';
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: estado inválido debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkUpdateStatus: estado inválido -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- sp_DeleteTask: borra @id1 existente
DELETE FROM @del;
BEGIN TRY
    INSERT INTO @del EXEC dbo.sp_DeleteTask @TaskId=@id1;
    SELECT @cnt = COUNT(*) FROM dbo.Tasks WHERE Id=@id1;
    INSERT INTO #r VALUES ('sp_DeleteTask: borra existente', CASE WHEN @cnt=0 THEN 1 ELSE 0 END, CONCAT('restantes=',@cnt));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_DeleteTask: borra existente', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: sp_DeleteTask inexistente -> 50404
BEGIN TRY
    EXEC dbo.sp_DeleteTask @TaskId=2000000000;
    INSERT INTO #r VALUES ('sp_DeleteTask: inexistente debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_DeleteTask: inexistente -> 50404', CASE WHEN ERROR_NUMBER()=50404 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

-- Cascada: borrar @id2 debe borrar su adjunto 'cas.bin' y devolver su nombre en disco
BEGIN TRY
    DELETE FROM @del;
    INSERT INTO @del EXEC dbo.sp_DeleteTask @TaskId=@id2;
    SELECT @cnt = COUNT(*) FROM dbo.TaskAttachments WHERE Id=@attId;
    INSERT INTO #r VALUES ('FK cascada: borrar tarea elimina sus adjuntos', CASE WHEN @cnt=0 THEN 1 ELSE 0 END, CONCAT('adjuntos restantes=',@cnt));
    SELECT @json = StoredNames FROM @del;
    INSERT INTO #r VALUES ('sp_DeleteTask: devuelve archivos a borrar del disco',
        CASE WHEN EXISTS (SELECT 1 FROM OPENJSON(@json) WITH (StoredName NVARCHAR(200)) WHERE StoredName=N'cas.bin') THEN 1 ELSE 0 END,
        CONCAT('StoredNames=', ISNULL(@json,'NULL')));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('FK cascada', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- sp_BulkDeleteTasks: crea 2, los borra en lote
DELETE FROM @task; INSERT INTO @task EXEC dbo.sp_CreateTask @Title=N'ZZTEST lote A'; SELECT @id1 = Id FROM @task;
DELETE FROM @task; INSERT INTO @task EXEC dbo.sp_CreateTask @Title=N'ZZTEST lote B'; SELECT @id2 = Id FROM @task;
DELETE FROM @att;
INSERT INTO @att EXEC dbo.sp_AddAttachment @TaskId=@id1, @StoredName=N'lote.bin', @OriginalName=N'lote.pdf', @Size=10;
DELETE FROM @bulkdel;
SET @ids = CONCAT('[', @id1, ',', @id2, ']');
BEGIN TRY
    INSERT INTO @bulkdel EXEC dbo.sp_BulkDeleteTasks @Ids = @ids;
    SELECT @affected = Affected, @json = StoredNames FROM @bulkdel;
    INSERT INTO #r VALUES ('sp_BulkDeleteTasks: devuelve archivos a borrar del disco',
        CASE WHEN EXISTS (SELECT 1 FROM OPENJSON(@json) WITH (StoredName NVARCHAR(200)) WHERE StoredName=N'lote.bin') THEN 1 ELSE 0 END,
        CONCAT('StoredNames=', ISNULL(@json,'NULL')));
    SELECT @cnt = COUNT(*) FROM dbo.Tasks WHERE Id IN (@id1,@id2);
    INSERT INTO #r VALUES ('sp_BulkDeleteTasks: borra 2 en lote', CASE WHEN @affected=2 AND @cnt=0 THEN 1 ELSE 0 END, CONCAT('Affected=',@affected));
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkDeleteTasks: borra 2 en lote', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: sp_BulkDeleteTasks ids vacíos -> 50400
BEGIN TRY
    EXEC dbo.sp_BulkDeleteTasks @Ids=N'[]';
    INSERT INTO #r VALUES ('sp_BulkDeleteTasks: ids vacíos debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_BulkDeleteTasks: ids vacíos -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   sp_GetDueTasks / sp_GetNotifications / sp_GetTaskStats
   --------------------------------------------------------------------------- */
BEGIN TRY
    EXEC dbo.sp_GetDueTasks;
    INSERT INTO #r VALUES ('sp_GetDueTasks: ejecuta', 1, 'OK');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetDueTasks: ejecuta', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

BEGIN TRY
    EXEC dbo.sp_GetNotifications @Days=3, @Top=20;
    INSERT INTO #r VALUES ('sp_GetNotifications: ejecuta', 1, 'OK');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetNotifications: ejecuta', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

BEGIN TRY
    EXEC dbo.sp_GetTaskStats @Granularity=N'week';
    EXEC dbo.sp_GetTaskStats @Granularity=N'month';
    EXEC dbo.sp_GetTaskStats @Granularity=N'year';
    INSERT INTO #r VALUES ('sp_GetTaskStats: week/month/year ejecutan', 1, 'OK');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTaskStats: week/month/year', 0, CONCAT('Excepción ', ERROR_NUMBER()));
END CATCH

-- FAIL: granularidad inválida -> 50400
BEGIN TRY
    EXEC dbo.sp_GetTaskStats @Granularity=N'decade';
    INSERT INTO #r VALUES ('sp_GetTaskStats: granularidad inválida debe fallar', 0, 'No lanzó excepción');
END TRY BEGIN CATCH
    INSERT INTO #r VALUES ('sp_GetTaskStats: granularidad inválida -> 50400', CASE WHEN ERROR_NUMBER()=50400 THEN 1 ELSE 0 END, CONCAT('err=',ERROR_NUMBER()));
END CATCH

/* ---------------------------------------------------------------------------
   Limpieza de datos de prueba (incluye ocurrencias de recurrencia)
   --------------------------------------------------------------------------- */
DELETE FROM dbo.Tasks WHERE Title LIKE N'ZZTEST%';

/* ---------------------------------------------------------------------------
   Reporte
   --------------------------------------------------------------------------- */
DECLARE @pass INT = (SELECT COUNT(*) FROM #r WHERE ok=1);
DECLARE @fail INT = (SELECT COUNT(*) FROM #r WHERE ok=0);

SELECT RIGHT('00'+CONVERT(VARCHAR(2),id),2) AS [#],
       CASE WHEN ok=1 THEN 'PASS' ELSE 'FAIL' END AS Resultado,
       name AS Prueba, detail AS Detalle
FROM #r ORDER BY id;

PRINT '';
PRINT CONCAT('TOTAL: ', @pass+@fail, '  |  PASS: ', @pass, '  |  FAIL: ', @fail);

IF @fail > 0
    THROW 50999, N'Hay pruebas que fallaron.', 1;
ELSE
    PRINT 'Todas las pruebas de la base de datos pasaron.';

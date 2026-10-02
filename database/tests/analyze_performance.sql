/* =============================================================================
   Análisis de rendimiento / optimización de TasksDb
   -----------------------------------------------------------------------------
   No modifica datos. Muestra:
     A) Definición de los índices de Tasks / TaskAttachments
     B) Uso real de cada índice (seeks / scans / lookups / writes)
     C) Índices que el optimizador echa en falta (DMV)
     D) Plan de ejecución (operadores) de las consultas representativas:
        se busca Index Seek (bueno) vs Table/Index Scan + Sort (mejorable).
   ============================================================================= */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
USE TasksDb;
SET NOCOUNT ON;

PRINT '=== A) ÍNDICES ===';
SELECT
    OBJECT_NAME(i.object_id)                                   AS Tabla,
    i.name                                                     AS Indice,
    i.type_desc                                                AS Tipo,
    STUFF((SELECT ', ' + c.name
           FROM sys.index_columns ic JOIN sys.columns c
             ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
           ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS Clave,
    STUFF((SELECT ', ' + c.name
           FROM sys.index_columns ic JOIN sys.columns c
             ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
           FOR XML PATH('')), 1, 2, '')                        AS Incluidas,
    ISNULL(i.filter_definition, '')                            AS Filtro
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID('dbo.Tasks'), OBJECT_ID('dbo.TaskAttachments'))
  AND i.type <> 0
ORDER BY Tabla, i.index_id;

PRINT '';
PRINT '=== B) USO DE ÍNDICES (desde el último arranque del servidor) ===';
SELECT OBJECT_NAME(s.object_id) AS Tabla, i.name AS Indice,
       s.user_seeks AS Seeks, s.user_scans AS Scans, s.user_lookups AS Lookups, s.user_updates AS Writes
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.database_id = DB_ID() AND s.object_id IN (OBJECT_ID('dbo.Tasks'), OBJECT_ID('dbo.TaskAttachments'))
ORDER BY Tabla, i.name;

PRINT '';
PRINT '=== C) ÍNDICES FALTANTES (sugeridos por el optimizador) ===';
SELECT TOP 10
    ROUND(s.avg_total_user_cost * s.avg_user_impact * (s.user_seeks + s.user_scans), 0) AS Beneficio,
    d.equality_columns AS Igualdad, d.inequality_columns AS Desigualdad, d.included_columns AS Incluir,
    s.user_seeks + s.user_scans AS Usos
FROM sys.dm_db_missing_index_group_stats s
JOIN sys.dm_db_missing_index_groups g ON s.group_handle = g.index_group_handle
JOIN sys.dm_db_missing_index_details d ON g.index_handle = d.index_handle
WHERE d.database_id = DB_ID() AND d.object_id = OBJECT_ID('dbo.Tasks')
ORDER BY Beneficio DESC;
IF @@ROWCOUNT = 0 PRINT '(sin sugerencias: tabla pequeña o sin consultas suficientes)';
GO

/* -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== D) PLANES DE EJECUCIÓN ===';
GO
SET SHOWPLAN_TEXT ON;
GO
-- D1: listado por defecto "Todas", orden por fecha (esperado: IX_Tasks_CreatedAt, sin Sort)
SELECT TOP 10 Id, Title FROM dbo.Tasks ORDER BY CreatedAt DESC, Id DESC;
GO
-- D2: filtrado por estado PENDING, orden por fecha (esperado: IX_Tasks_Status_CreatedAt Seek, sin Sort)
SELECT TOP 10 Id, Title FROM dbo.Tasks WHERE Status = N'PENDING' ORDER BY CreatedAt DESC, Id DESC;
GO
-- D3: filtrado por categoría (esperado hoy: Scan, no hay índice por Category)
SELECT Id, Title FROM dbo.Tasks WHERE Category = N'Finanzas';
GO
-- D4: orden por prioridad con CASE (esperado: Sort; el CASE no es sargable)
SELECT TOP 10 Id, Title FROM dbo.Tasks
ORDER BY CASE Priority WHEN N'HIGH' THEN 3 WHEN N'MEDIUM' THEN 2 ELSE 1 END DESC;
GO
-- D5: búsqueda por texto con comodín inicial (esperado: Scan; LIKE '%x%' no usa índice)
SELECT Id, Title FROM dbo.Tasks WHERE Title LIKE N'%factura%';
GO
-- D6: notificaciones, pendientes con vencimiento (esperado: IX_Tasks_Due Seek/Scan del índice filtrado)
SELECT Id, Title, DueDate FROM dbo.Tasks WHERE Status = N'PENDING' AND DueDate IS NOT NULL ORDER BY DueDate;
GO
SET SHOWPLAN_TEXT OFF;
GO

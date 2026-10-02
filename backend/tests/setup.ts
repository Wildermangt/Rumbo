// Variables de entorno mínimas para cargar la configuración en las pruebas.
// Los tests usan un repositorio en memoria, así que no se conecta a la base real.
process.env.NODE_ENV ??= 'test';
process.env.DB_HOST ??= 'localhost';
process.env.DB_NAME ??= 'TasksDb';
process.env.DB_USER ??= 'test';
process.env.DB_PASSWORD ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-with-at-least-thirty-two-characters';
process.env.AUTH_PASSWORD ??= 'admin123';
process.env.UPLOAD_DIR ??= 'uploads-test';

# Plan de Implementación - Notificaciones Automáticas de Nuevo Acceso

Este plan detalla los pasos para integrar notificaciones automáticas por correo electrónico en Portal Pilot cuando un usuario inicia sesión. Se enviará un correo con el diseño de `EMAIL/Nuevo Acceso.html` rellenado con datos reales capturados dinámicamente (Dispositivo, IP, Ubicación y Fecha/Hora).

## Cambios Propuestos

### Componente: Backend (`backend/`)

Instalaremos la librería `nodemailer` para gestionar el envío de correos por SMTP y modificaremos la configuración del backend.

#### [MODIFY] [backend/.env](file:///c:/Users/DELL/Downloads/Portal-Pilot-WEB/backend/.env)
- Agregar las credenciales seguras proporcionadas por el usuario para `portalpilot.hn@gmail.com` y la contraseña de aplicación `xmpo iaet xtzg onuy`.

#### [MODIFY] [backend/server.js](file:///c:/Users/DELL/Downloads/Portal-Pilot-WEB/backend/server.js)
- Importar `nodemailer` y `fs`.
- Implementar la función auxiliar `obtenerUbicacion(ip)` para geolocalizar la IP usando el servicio gratuito `ip-api.com`.
- Implementar la función auxiliar `obtenerDispositivo(userAgent)` para parsear el navegador y sistema operativo desde las cabeceras HTTP.
- Implementar la función `enviarAlertaNuevoAcceso(emailDestinatario, req)` que lee la plantilla `EMAIL/Nuevo Acceso.html`, realiza los reemplazos de datos de prueba por dinámicos y envía el correo usando SMTP.
- Integrar la llamada a `enviarAlertaNuevoAcceso` en la ruta `/api/login` de forma asíncrona (segundo plano).

---

## Plan de Verificación

### Pruebas Automatizadas y Manuales
1. Ejecutar `npm install nodemailer` en la carpeta `backend`.
2. Probar el flujo iniciando sesión desde la aplicación o haciendo una petición POST de prueba a `/api/login`.
3. Verificar la llegada del correo dinámico a la cuenta del usuario con los datos reales de acceso.

# Modificación de tenant_detail.html – Vista previa vs. Detalle completo

## Goal Description

Adaptar **tenant_detail.html** para que, según la empresa y el rol del usuario autenticado, muestre una **vista previa** de la información del tenant o el **detalle completo**. El frontend debe solicitar los datos al backend mediante JWT (token de autenticación) y el backend debe validar el token y devolver los campos correspondientes.

## User Review Required

[!IMPORTANT]
- Confirmar qué campos deben incluirse en la **vista previa** y cuáles en el **detalle completo**.
- Indicar qué roles de usuario (por ejemplo, `admin`, `operator`, `viewer`) tienen permiso para ver el detalle completo.
- Si ya existe un endpoint para obtener tenants (ej. `/api/tenants`), especificar si se debe crear uno nuevo (ej. `/api/tenant/:id`) o reutilizarlo con parámetros de autorización.

## Open Questions

- ¿Qué campos exactos (nombre, dominio, plan, usuarios, etc.) forman la vista previa?
- ¿Qué campos adicionales (configuración, API keys, bots, actividad) se requieren en el detalle completo?
- ¿Qué nivel de token (JWT) se envía actualmente al frontend? ¿Se usa `localStorage` o `cookie`?
- ¿Deseas que la UI incluya un botón “Ver más” que solicite los datos completos bajo autorización?

## Proposed Changes

### Frontend (tenant_detail.html)
- Añadir script que **lee el JWT** desde `localStorage` (ej. `localStorage.getItem('authToken')`).
- Realizar **fetch** a `/api/tenant/:id` con encabezado `Authorization: Bearer <token>`.
- Mostrar inicialmente la **vista previa** (campos permitidos para todos los roles).
- Si el usuario tiene permiso (según `role` incluido en el token o respuesta del API), habilitar botón **“Ver detalle completo”** que carga los campos restantes.
- Reutilizar estilos existentes; añadir clases `.preview` y `.detail` para controlar visibilidad.
- Actualizar enlaces de la barra lateral para pasar `?id=<tenantId>` y **no exponer** datos sensibles.

### Backend (Express – server.js)
- Crear nuevo endpoint `GET /api/tenant/:id` que:
  1. **Verifique el JWT** (usar `jsonwebtoken` library, añadir middleware `authenticate`).
  2. Obtenga el `role` y `empresa_codigo` del token.
  3. Consulte NocoDB para el tenant vía `nocodbApi.get('/api/v2/tables/<tenantTable>/records/<id>')`.
  4. **Responda** con dos objetos:
     - `preview`: campos seguros para cualquier usuario autenticado.
     - `detail`: campos adicionales sólo si `role` es `admin` o `operator` y pertenece a la misma empresa.
- Manejar errores de autorización (`401 Unauthorized`) y devolver mensaje claro.
- Añadir **dependencia** `jsonwebtoken` al `package.json` (si no está).

### Seguridad
- El JWT debe incluir `sub` (user id), `role`, y `empresa_codigo`.
- El backend no debe confiar en el `?id=` del cliente sin validar que el token pertenezca a la misma empresa.
- Opcional: implementar **refresh token** y expiración corta.

## Verification Plan

- **Unit tests** para el middleware `authenticate` y el endpoint `/api/tenant/:id` (Jest + Supertest).
- **Manual test**: iniciar sesión, abrir `tenant_detail.html?id=xyz`, confirmar que solo se muestra la vista previa.
- Cambiar rol a `admin` (simular token) y pulsar “Ver detalle completo”; comprobar que aparecen los campos extra.
- Revisar que al modificar el `id` en la URL sin token válido se devuelve `401`.
- Verificar que el token se almacena de forma segura (no en URL).

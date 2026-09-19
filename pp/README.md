# Portal Pilot Admin (`pp/`)

## Propósito

`pp/` contiene el portal administrativo de Portal Pilot para usuarios ROOT y superadministradores. Las páginas son HTML estático servido por Vercel; la lógica de negocio consume la API Express mediante `/api/*`.

## Estructura

```text
pp/
├── *.html                 Pantallas del portal y su estructura visual.
├── css/                   Hojas de estilo por pantalla y estilos compartidos.
└── js/                    Lógica de pantalla, navegación y utilidades del portal.
```

### Páginas

| Área | Páginas |
|---|---|
| Supervisión | `dashboard.html`, `tenants.html`, `tenant_detail.html`, `alertas.html`, `logs_realtime.html`, `incidentes_tenant.html` |
| Operación | `tickets_soporte.html`, `bots_rpa.html`, `bot_detail.html`, `integraciones.html`, `provisionar_tenant.html`, `validacion_tenant.html` |
| Finanzas | `finanzas.html`, `billing_plans.html`, `renovaciones.html`, `facturas_cliente.html`, `consumo_ia.html`, `consumo_planes.html`, `reportes.html` |
| Seguridad | `seguridad_accesos.html`, `respaldos_y_rotacion.html`, `reglas_alertas.html` |
| Sistema | `auditoria.html`, `analytics.html`, `comunicados.html`, `system_health.html`, `usuarios.html`, `usuario_detail.html`, `global_settings.html`, `perfil.html` |
| Entrada | `welcome.html` |

## Ciclo de una página

1. El navegador solicita `/pp/<pagina>`.
2. Vercel entrega el HTML desde `pp/` mediante el backend serverless.
3. `auth-check.js` valida la sesión y `portal-admin-guard.js` limita el acceso ROOT cuando la página lo requiere.
4. Se muestran el preloader y el layout base.
5. `sidebar-loader.js` hidrata nombre, rol y avatar desde `localStorage`.
6. `pp/js/pp-sidebar.js` pinta la navegación común y aplica sus estilos compartidos.
7. El JS específico consulta `/api/*`, renderiza datos y registra eventos de interacción.
8. El preloader se oculta después del tiempo mínimo común de 3200 ms.

## Contrato visual común

Todas las páginas deben conservar estos elementos cuando correspondan:

- `.dashboard#dashboard`: grid de sidebar y contenido principal.
- `.sidebar#sidebar`: navegación lateral y botón `#toggleSidebar`.
- `.sidebar-nav#sidebarNav`: destino de la navegación generada.
- `.main-content`: contenido de la pantalla.
- `.topbar`: barra superior con título y acciones.
- `#preloader`: loader inicial con la estructura `.device`.
- `#overlay`: capa para navegación móvil.

La navegación se define únicamente en `js/pp-sidebar.js`. No se deben volver a escribir enlaces manuales dentro de una página.

## Capas de estilos

- CSS local dentro del HTML: tokens o ajustes exclusivos de una pantalla existente.
- `pp/css/<pagina>.css`: layout y componentes propios de una familia de pantallas.
- `pp/css/pp-pages.css`: componentes compartidos de las páginas nuevas, incluido el preloader.
- `pp/js/pp-sidebar.js`: estilos de sidebar compartidos que deben ganar a las variaciones antiguas.
- `../css/notifications.css`: notificaciones globales.

Al modificar el preloader, se debe conservar la implementación canónica de `dashboard.html` y sincronizarla en `pp-pages.css`.

## Capas de JavaScript

- `auth-check.js`: autenticación general y redirección al login.
- `js/portal-admin-guard.js`: autorización específica del portal ROOT.
- `js/sidebar-loader.js`: identidad visual del usuario y compatibilidad con páginas antiguas.
- `js/pp-sidebar.js`: navegación, grupos, estado activo y responsive de la sidebar.
- `js/notif-badge.js` y `../js/notifications.js`: contador y panel de notificaciones.
- `pp/js/<pagina>.js`: fetch, estado, renderizado y eventos propios de cada pantalla.

## Convenciones de código

- Mantener los nombres de IDs y clases existentes: son contratos entre HTML y JavaScript.
- Usar `fetch` con el token Bearer almacenado en `localStorage`.
- Escapar o validar valores que se interpolen en HTML.
- No mover autorización al frontend: los permisos reales deben mantenerse en la API.
- Evitar lógica de negocio dentro de HTML inline cuando pueda vivir en el JS de la página.
- Documentar decisiones, contratos de API y fallbacks; no comentar operaciones obvias.
- Usar ASCII en nuevos comentarios y conservar el idioma español del producto.

## Checklist para una página nueva

- [ ] Crear el HTML bajo `pp/` con `#dashboard`, `#sidebar`, `#sidebarNav` y `#toggleSidebar`.
- [ ] Incluir fuentes, iconos, estilos compartidos y `pp/css/pp-pages.css` si usa componentes nuevos.
- [ ] Incluir `auth-check.js`, el guard administrativo cuando aplique y `sidebar-loader.js`.
- [ ] Incluir `pp-sidebar.js` o permitir que `sidebar-loader.js` lo cargue como compatibilidad.
- [ ] Crear `pp/js/<pagina>.js` con funciones separadas para carga, estado y renderizado.
- [ ] Añadir la ruta al grupo correcto en `pp-sidebar.js`.
- [ ] Verificar que cada destino relativo `.html` exista.
- [ ] Ejecutar comprobación de sintaxis y revisar la página en escritorio y móvil.

## Validación rápida

```powershell
node --check pp/js/<pagina>.js
node --check pp/js/pp-sidebar.js
Get-ChildItem pp -Recurse -File
```

La documentación de esta carpeta describe la arquitectura actual; si una página se aparta de estas convenciones, debe explicar el motivo junto al código que introduce la excepción.

# Facturacion y recibos

Esta carpeta contiene las salidas imprimibles de Portal Pilot.

- `../../factura.html` es la plantilla visual actualmente integrada.
- `plantillas/` contiene reglas y futuras variantes de recibo.
- Una factura real se abre con `factura.html?id=<id>` desde un usuario autenticado.
- Un recibo real se abre con `recibo.html?id=<id>` desde un usuario autenticado.
- Una nota de crédito real se abre con `nota-credito.html?id=<id>` desde un usuario autenticado.

La plantilla obtiene los datos desde `GET /api/facturas/:id` y conserva una muestra visual cuando se abre sin `id`.

## Importante

La plantilla no sustituye la validacion fiscal del SAR. CAI, rango autorizado, numeracion, firma, codigo QR fiscal y envio al SAR deben venir de la configuracion fiscal valida del tenant y de la integracion autorizada correspondiente.

Antes de crear facturas con detalle, ejecuta `supabase/migracion_facturacion_documentos.sql` para conservar los productos o servicios en `facturas.items`.

Para habilitar recibos y notas de crédito, ejecuta `supabase/migracion_documentos_comerciales.sql`. Las tablas se relacionan por `factura_id` y se filtran por `empresa_id`.

# Plantillas

Usa esta carpeta para variantes de salida, por ejemplo:

- `factura-electronica.html`: factura fiscal.
- `recibo-pago.html`: comprobante simple de pago.
- `nota-credito.html`: documento de ajuste.

Las plantillas deben recibir un modelo normalizado con estos grupos:

```text
empresa.nombre, empresa.rtn, empresa.direccion
cliente.nombre, cliente.rtn, cliente.email
factura.numero, factura.fecha, factura.estado
items[], subtotal, impuesto, descuento, total, total_letras, qr
pago.metodo, pago.condicion, pago.estado
```

-- migracion_rrhh_campos_app.sql
--
-- La app de RRHH tiene tres campos que el esquema no contemplaba:
--   * apellido          -> el formulario separa nombre y apellido
--   * contacto_emergencia / telefono_emergencia -> sección "Contacto de emergencia"
--
-- Sin estas columnas la única opción era meterlos en `notas` (mezclándolos con
-- las observaciones de RRHH) o partir el nombre al leerlo, es decir, perder
-- datos en ambos sentidos. Son columnas nuevas y anulables: no tocan nada
-- existente ni cambian el comportamiento de RLS (la tabla ya está protegida).
--
-- Nota: `nombre` sigue siendo NOT NULL y en el servidor guarda el nombre
-- completo; `apellido` es una cópia editable que la app usa para no tener que
-- partir el texto cada vez que abre el formulario.

alter table public.empleados
  add column if not exists apellido text;

alter table public.empleados
  add column if not exists contacto_emergencia text;

alter table public.empleados
  add column if not exists telefono_emergencia text;

comment on column public.empleados.apellido is
  'Apellido editable usado por la app; `nombre` conserva el nombre completo.';
comment on column public.empleados.contacto_emergencia is
  'Nombre del contacto de emergencia del trabajador.';
comment on column public.empleados.telefono_emergencia is
  'Teléfono del contacto de emergencia del trabajador.';

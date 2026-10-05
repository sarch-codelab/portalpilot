# Reporte: Video de fondo en producción (`planes.html` y `download.html`)

**Objetivo:** que los videos de fondo se vean **idénticos a como se ven en local** en cualquier
entorno desplegado (producción). Local es la referencia de diseño: si cambia local, cambia producción.

---

## 1. Causa raíz de que no se vieran en producción

Eran **tres fallos encadenados**, todos de despliegue/archivos (no de CSS ni de autoplay):

| # | Hallazgo | Impacto en producción |
|---|---|---|
| 1 | `planes.html` era un archivo **nuevo sin versionar** (`?? planes.html`) | La página **no existía** en el repo. Los 5 archivos versionados que la enlazan (`index.html`, `download.html`, `registrov2.html`, `empresa/modules.html`, `pp/consumo_planes.html`) daban **404**. |
| 2 | La carpeta `vid/` **no estaba versionada** | `vid/fondo1.mp4`, `vid/fondo1_rev.mp4`, `vid/fondo2.mp4`, `vid/fondo2_rev.mp4` devolvían **404**. Ambas páginas los referencian, así que **ninguna** mostraba video. |
| 3 | `vercel.json` **no tenía ningún patrón para video** en `builds` | Aun con los MP4 en el repo, Vercel los **excluía del deployment**: la lista blanca de `builds` cubría `png/jpg/jpeg/svg/webp/ico` pero no `.mp4`. Un archivo que no matchea ningún patrón no se sube. |
| 4 | Los MP4 estaban codificados **sin *faststart*** | El átomo `moov` (metadatos) estaba **al final** del archivo y `mdat` (datos) en el offset 44. El navegador debe **descargar el archivo completo** antes de decodificar → el video nunca arrancaba en producción. |

### El detalle del punto 4 (el más difícil de detectar)

Con los 4 puntos anteriores arreglados, el sitio en vivo todavía mostraba el video en negro.
El diagnóstico en el navegador daba un resultado muy confuso:

```
paused=true   readyState=0   videoWidth=0   videoHeight=0
```

**Sin errores de consola y sin requests fallidos** — el MP4 respondía `200` con
`Content-Type: video/mp4`. El video simplemente nunca cargaba datos.

La causa: **falta de *faststart***. En un MP4 el átomo `moov` contiene los metadatos (dimensiones,
duración, índice). Si está al final, el navegador tiene que bajarse el archivo entero (8.75 MB)
antes de poder pintar el primer frame. En local eso es instantáneo y **el problema pasa
desapercibido**; en producción se ve como "el video no funciona".

Verificación del encabezado del archivo (los primeros 4 KB):

| | `moov` | `mdat` | Estado |
|---|---|---|---|
| Antes | ausente | offset 44 | Sin faststart |
| Después | offset 36 | offset 1865 | **Faststart OK** |

Remux aplicado (sin recodificar, sin pérdida de calidad):

```bash
ffmpeg -i vid/fondo1.mp4 -c copy -movflags +faststart vid/fondo1.new.mp4
```

**Si alguna vez se vuelve a codificar un video de fondo, hay que repetir este paso.**
x264 no activa *faststart* por defecto; hay que pedirlo explícitamente al codificar.

---

## 2. Inventario de assets (ahora versionados)

### Videos — `vid/`

| Archivo | Tamaño | Uso |
|---|---|---|
| `vid/fondo1.mp4` | 8.75 MB | Video de fondo **escritorio** (>= 768px) |
| `vid/fondo1_rev.mp4` | 3.78 MB | Reversa de escritorio para el loop ping-pong |
| `vid/fondo2.mp4` | 3.40 MB | Video de fondo **móvil** (<= 767px) |
| `vid/fondo2_rev.mp4` | 1.75 MB | Reversa de móvil para el loop ping-pong |

Total: **17.69 MB**. Los 4 son obligatorios: el loop ping-pong alterna ida/vuelta.

### Imágenes referenciadas por estas páginas

| Archivo | Tamaño |
|---|---|
| `img/telefonos.png` | 1.14 MB |
| `img/iconos/club_membresia.png` | 0.98 MB |
| `img/iconos/pulperia_mercadito.png` | 0.98 MB |
| `img/iconos/tienda_supermercado.png` | 0.85 MB |
| `img/iconos/logo_completo.png` | 0.18 MB |

---

## 3. Contrato de markup — NO cambiar

Idéntico en `planes.html` y `download.html`:

```html
<div class="video-bg video-desktop">
  <video autoplay muted playsinline preload="auto">
    <source src="vid/fondo1.mp4" type="video/mp4">
  </video>
</div>

<div class="video-bg video-mobile">
  <video autoplay muted playsinline preload="auto">
    <source src="vid/fondo2.mp4" type="video/mp4">
  </video>
</div>
```

Reglas de autoplay (obligatorias):

- **`muted`** — sin esto, Chrome/Edge y especialmente **iOS/Safari bloquean el autoplay**. Es el
  error más común cuando "el video no arranca en el móvil".
- **`playsinline`** — evita que iOS abra el video a pantalla completa.
- **`autoplay`** + **`preload="auto"`** — `preload="none"` deja el primer frame en negro hasta
  interactuar con la página.
- Rutas **relativas** (`vid/...`): resuelven contra el origen actual. Si las páginas se sirven en un
  subdirectorio, cambiar la ruta es un bug de producción.

## 4. Contrato CSS — NO cambiar

| Regla | Valor | Por qué importa |
|---|---|---|
| `.video-desktop` | `position: fixed; top: 68px; height: calc(100vh - 68px); z-index: -1` | Cubre todo lo que está debajo del navbar |
| `.video-mobile` | `position: fixed; top: 0; height: 100vh; z-index: 0` (≤767px) | Cubre toda la pantalla en móvil |
| `video` | `object-fit: cover` | Sin barras negras; recorta ~25% arriba/abajo |
| `video` | `filter: brightness(1.45) saturate(1.2)` | Ajusta el look del video al tema oscuro |
| `.video-*:after` | `linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.3) 55%, rgba(0,0,0,.4) 100%)` | Oscurece el video para que el texto sea legible |
| **`html`** | **`background: transparent`** | **Crítico** — ver abajo |

### Por qué `html { background: transparent }` es obligatorio

`body` usa `--bg: #000000` (opaco). El fondo del `body` se **propaga al canvas** solo si el `html`
es transparente. Si `html` tiene un fondo opaco, ese fondo se pinta **encima** del video que está en
`z-index: -1` y el video desaparece.

Este fue el bug que se corrigió en desarrollo: con `html` opaco el video no se veía; con
`html { background: transparent }` reaparece. **No volver a poner un fondo opaco en `html`.**

Además: ningún contenedor que envuelva al video debe tener fondo opaco, `overflow: hidden` ni un
`z-index` que lo tape por encima.

## 5. Loop ping-pong

El JS intercambia los clips para que el loop no se vea "cortado":

- Escritorio: `vid/fondo1.mp4` ⇄ `vid/fondo1_rev.mp4`
- Móvil: `vid/fondo2.mp4` ⇄ `vid/fondo2_rev.mp4`

Si falta cualquiera de los 4 archivos, el loop queda roto (salto al inicio).

## 6. Requisitos del hosting

- **`Content-Type: video/mp4`** en los `.mp4`.
- **Soporte de Range requests (respuestas `206`)** para streaming/seek.
- **`vercel.json` debe incluir el patrón del video en `builds`**:
  ```json
  { "src": "**/*.mp4", "use": "@vercel/static" }
  ```
  `builds` es una **lista blanca**: lo que no matchea no se despliega. Si se agrega un tipo de
  archivo nuevo hay que añadirlo aquí o no existirá en producción.
- El pipeline de deploy **no debe filtrar** `vid/`, `img/` ni `*.mp4` (`.vercelignore` ya está bien).
- GitHub: límite de **100 MB por archivo**. Hoy el mayor es 8.75 MB (OK). Si alguna vez se sube un
  video mayor, hay que usar Git LFS o un CDN.

### Checklist antes de commitear un video nuevo

1. `ffmpeg -i nuevo.mp4 -c copy -movflags +faststart salida.mp4`
2. Verificar que `moov` quedó antes de `mdat` en los primeros KB.
3. Confirmar que el patrón de la extensión está en `vercel.json` → `builds`.
4. Confirmar que el archivo aparece en `git status` como staged (no untracked).

## 7. Checklist de verificación (por hacer en cada despliegue)

1. **Network → 200 en los 4 MP4** (no 404). Es el chequeo más importante.
2. Consola sin errores.
3. En consola:
   ```js
   const v = document.querySelector('.video-desktop video');
   console.log(v.paused, v.readyState, v.videoWidth, v.currentSrc);
   // esperado: false, >=3, >0, ".../vid/fondo1.mp4"
   ```
   Si `readyState` es **0** y `videoWidth` **0** sin errores → falta *faststart* (punto 4 de la
   sección 1).
4. Verificar en **escritorio** (>= 768px, `fondo1`) y **móvil** (<= 767px, `fondo2`), idealmente
   redimensionando la ventana, no solo con emulación.
5. El texto debe ser legible sobre el video (overlay `::after` presente).
6. **Cache:** hard reload (`Ctrl+F5`) o incógnito. Los MP4 se cachean agresivamente; un deploy
   nuevo puede no verse hasta que expire la caché.
7. Confirmar que `planes.html` responde **200** (antes daba 404).

## 8. Preventivo

- Al crear una página o un asset nuevo, verificar `git status` antes de hacer deploy: un archivo
  sin versionar funciona en local y **no existe** en producción.
- Si el video "no aparece" pero el MP4 devuelve 200 y no hay errores de consola, el problema es
  **faststart**: el navegador descarga el archivo entero antes de pintar. Reverificar que `moov`
  esté antes de `mdat`.
- Si el MP4 da 404, el problema es `vercel.json` → `builds` (lista blanca) o que el archivo esté
  sin versionar.
- **Local no es evidencia de que producción funcione**: en local los 8.75 MB se descargan al
  instante y ocultan el problema de faststart. Verificar siempre contra el dominio real.

## 9. Commits relacionados

| Commit | Contenido |
|---|---|
| `8bbf0d5` | Versiona `planes.html`, `vid/` y las imágenes referenciadas |
| `04ecaf2` | Agrega `**/*.mp4` / `**/*.webm` a `vercel.json` → `builds` |
| `9ffc55f` | Remux con *faststart* de los 4 MP4 |
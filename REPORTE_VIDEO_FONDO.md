# Reporte: Video de fondo en producción (`planes.html` y `download.html`)

**Objetivo:** que los videos de fondo se vean **idénticos a como se ven en local** en cualquier
entorno desplegado (producción). Local es la referencia de diseño: si cambia local, cambia producción.

---

## 1. Causa raíz de que no se vieran en producción

No era un problema de CSS ni de autoplay. Eran **assets y una página que nunca se versionaron**:

| # | Hallazgo | Impacto en producción |
|---|---|---|
| 1 | `planes.html` era un archivo **nuevo sin versionar** (`?? planes.html`) | La página **no existía** en el repo. Los 5 archivos versionados que la enlazan (`index.html`, `download.html`, `registrov2.html`, `empresa/modules.html`, `pp/consumo_planes.html`) daban **404**. |
| 2 | La carpeta `vid/` **no estaba versionada** | `vid/fondo1.mp4`, `vid/fondo1_rev.mp4`, `vid/fondo2.mp4`, `vid/fondo2_rev.mp4` devolvían **404**. Ambas páginas los referencian, así que **ninguna** mostraba video. |
| 3 | Imágenes referenciadas por esas dos páginas tampoco versionadas | `img/telefonos.png` y 4 iconos en `img/iconos/` quedaban rotos al no existir en el despliegue. |

En local todo funcionaba porque los archivos existían en disco; el servidor estático de desarrollo
los servía. En producción, al no estar en el repo, simplemente no había nada que servir.

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
- El pipeline de deploy **no debe filtrar** `vid/`, `img/` ni `*.mp4`.
- GitHub: límite de **100 MB por archivo**. Hoy el mayor es 8.75 MB (OK). Si alguna vez se sube un
  video mayor, hay que usar Git LFS o un CDN.

## 7. Checklist de verificación (por hacer en cada despliegue)

1. **Network → 200 en los 4 MP4** (no 404). Es el chequeo más importante.
2. Consola sin errores.
3. En consola:
   ```js
   const v = document.querySelector('.video-desktop video');
   console.log(v.paused, v.readyState, v.videoWidth, v.currentSrc);
   // esperado: false, >=3, >0, ".../vid/fondo1.mp4"
   ```
4. Verificar en **escritorio** (>= 768px, `fondo1`) y **móvil** (<= 767px, `fondo2`), idealmente
   redimensionando la ventana, no solo con emulación.
5. El texto debe ser legible sobre el video (overlay `::after` presente).
6. **Cache:** hard reload (`Ctrl+F5`) o incógnito. Los MP4 se cachean agresivamente; un deploy
   nuevo puede no verse hasta que expire la caché.
7. Confirmar que `planes.html` responde **200** (antes daba 404).

## 8.preventivo

- Al crear una página o un asset nuevo, verificar `git status` antes de hacer deploy: un archivo
  sin versionar funciona en local y **no existe** en producción.
- Si alguna vez el video "desaparece" pero los 4 MP4 devuelven 200, el problema es CSS: revisar
  `html { background: transparent }` y cualquier overlay opaco nuevo.
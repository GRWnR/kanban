# Kanban

Tablero Kanban personal. Frontend en HTML, CSS y JavaScript puros (sin paso de compilación) y un backend pequeño en Node + SQLite que guarda los datos y protege el acceso con contraseña.

## Uso en local

Requiere Node 24 o superior.

```bash
npm install
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
npm run hash-password       # pide una contraseña y escribe la línea ADMIN_PASSWORD_HASH=...; pégala en .env
npm run dev                 # http://127.0.0.1:3000
npm test
```

- Varios tableros, cada uno con su color, columnas y etiquetas propias.
- Tarjetas con título, descripción, etiquetas y color.
- Arrastra tarjetas y columnas para reordenarlas (Esc cancela el arrastre). Desde el teclado: Tab hasta una tarjeta, Enter para editarla y el selector «Columna» para moverla.
- Los cambios se guardan solos en el servidor y se ven en otras pestañas y dispositivos.

## Datos

- Todo se guarda en `DATA_DIR/kanban.db` (SQLite). Además se conservan las últimas 50 instantáneas, una cada 10 minutos como máximo.
- Si dos dispositivos guardan a la vez, gana el primero y el otro recarga la versión del servidor (control de versión optimista, respuesta 409).
- La primera vez que entras con el servidor vacío, se suben los tableros que hubiera en el `localStorage` del navegador (clave `kanban-v1`).
- **Exportar** e **Importar** siguen disponibles para copias en JSON.

## API

| Ruta | Descripción |
|---|---|
| `GET /api/health` | Comprobación de estado (pública) |
| `POST /api/login` | `{ password }`; crea la sesión (cookie `HttpOnly`, `SameSite=Strict`); 5 intentos por minuto |
| `POST /api/logout` | Cierra la sesión |
| `GET /api/state` | `{ state, version }` (requiere sesión) |
| `PUT /api/state` | `{ state, version }`; 409 si `version` no es la actual |

## Estructura

- `public/`: frontend (`index.html`, `app.js`, `styles.css`) y `normalize.js`, compartido con el servidor.
- `server/`: `app.js` (rutas), `db.js` (SQLite), `auth.js` (scrypt y sesiones), `index.js` (arranque).
- `scripts/hash-password.js`: genera el hash de la contraseña.
- `test/`: pruebas con `node:test`.

# Desarrollo de Conector SSH / SFTP con Neutralinojs

Este documento detalla la arquitectura, estructura y el protocolo de comunicación de la aplicación Quirky SSH/SFTP.

## 🏗️ Arquitectura General

La aplicación está construida sobre **Neutralinojs** y utiliza una extensión de **Node.js** para realizar conexiones SSH directas (ya que el motor web del frontend no posee capacidades nativas de sockets TCP y SSH).

La comunicación se realiza mediante **WebSockets** (canal bidireccional en tiempo real) a través del servidor interno de Neutralinojs.

```
┌─────────────────────────────────┐
│     Frontend (WebView)          │
│  - index.html & style.css       │
│  - xterm.js (Terminal)          │
│  - main.js                      │
└────────────────┬────────────────┘
                 │ (Neutralino.extensions.dispatch)
                 ▼ (WebSocket IPC, sub-protocolo: 'neutralinojs')
┌─────────────────────────────────┐
│      Servidor Core Neutralino   │
└────────────────┬────────────────┘
                 │ (app.broadcast)
                 ▼
┌─────────────────────────────────┐
│     Backend Node.js Extension   │
│  - extensions/ssh-connector/... │
│  - ssh2 Client (SSH & SFTP)     │
└────────────────┬────────────────┘
                 │ (SSH / SFTP)
                 ▼
┌─────────────────────────────────┐
│       Servidor Remoto           │
└─────────────────────────────────┘
```

---

## 📁 Estructura del Proyecto

La estructura de archivos clave creados en el espacio de trabajo es la siguiente:

- `package.json`: Configura scripts y declara dependencias tanto del backend (`ssh2`, `ws`) como del frontend (`xterm`).
- `pnpm-workspace.yaml`: Habilita compilación nativa de dependencias C++ (`cpu-features`, `ssh2`, etc.) en pnpm v11+.
- `neutralino.config.json`: Registra y configura la aplicación y su ventana, además de dar de alta la extensión de Node.
- `scripts/prepare-frontend.js`: Script que se ejecuta en la fase `prepare` para copiar automáticamente las librerías `xterm` y `xterm-addon-fit` desde `node_modules` a la carpeta `resources` de forma local y offline.
- `extensions/ssh-connector/main.js`: Lógica del backend. Escucha de stdin, conecta al WebSocket de Neutralino, gestiona la conexión SSH, canal de terminal y operaciones SFTP.
- `resources/index.html`: Estructura HTML del explorador SFTP (a la izquierda) y terminal (a la derecha).
- `resources/css/style.css`: Estilo estético premium con colores oscuros elegantes, tipografía Outfit e Inter, bordes neon, glassmorphism y elementos interactivos.
- `resources/js/main.js`: Enlace interactivo en JS. Mapeo de perfiles de conexión mediante almacenamiento local (`Neutralino.storage`), inicializador de terminal, y despachador de eventos al backend.

---

## 🔌 Protocolo de Comunicación (WebSockets)

Las dos partes de la aplicación se comunican enviando eventos.

### Del Frontend al Backend (Mediante `Neutralino.extensions.dispatch`)

1. **`ssh.connect`**: Solicita conectar al host remoto.
   - Datos: `{ host, port, username, password, privateKeyPath, privateKeyText, passphrase }`
2. **`ssh.disconnect`**: Cierra la sesión activa.
3. **`terminal.write`**: Envía caracteres pulsados por el usuario.
   - Datos: `{ data }` (string)
4. **`terminal.resize`**: Sincroniza el tamaño de la pseudo-terminal remota.
   - Datos: `{ cols, rows }` (números)
5. **`sftp.list`**: Lista archivos del directorio indicado.
   - Datos: `{ path }`
6. **`sftp.download`**: Descarga un archivo.
   - Datos: `{ id, remotePath, localPath }`
7. **`sftp.upload`**: Sube un archivo.
   - Datos: `{ id, localPath, remotePath }`
8. **`sftp.delete`**: Elimina un archivo o directorio.
   - Datos: `{ path, isDir }`
9. **`sftp.rename`**: Renombra o mueve un recurso.
   - Datos: `{ src, dest }`
10. **`sftp.mkdir`**: Crea un nuevo directorio remoto.
    - Datos: `{ path }`

### Del Backend al Frontend (Mediante `app.broadcast`)

1. **`ssh.connected`**: Confirma conexión exitosa.
   - Datos: `{ host, username }`
2. **`ssh.disconnected`**: Notifica pérdida o cierre de la sesión.
   - Datos: `{ message }`
3. **`ssh.error`**: Error general en conexión.
   - Datos: `{ message }`
4. **`terminal.data`**: Texto a imprimir en el emulador de terminal.
   - Datos: `{ data }`
5. **`sftp.list.success`**: Devuelve lista de archivos de la carpeta.
   - Datos: `{ path, files: [{ name, size, mtime, isDir, isLink, permissions }] }`
6. **`sftp.list.error`**: Error al listar directorio.
   - Datos: `{ path, message }`
7. **`sftp.progress`**: Progreso en tiempo real de subida/descarga.
   - Datos: `{ id, action, transferred, total, percent }`
8. **`sftp.download.success`**: Descarga completada.
   - Datos: `{ id, remotePath, localPath }`
9. **`sftp.upload.success`**: Subida completada.
   - Datos: `{ id, localPath, remotePath }`
10. **`sftp.operation.success`**: Acción de manipulación de archivos completada.
    - Datos: `{ action, path }`
11. **`sftp.operation.error`**: Error en manipulación.
    - Datos: `{ action, path, message }`

---

## 🚀 Comandos de Ejecución

Para iniciar o compilar la aplicación, utiliza los siguientes comandos en tu consola:

### 1. Preparar dependencias del frontend (Copiar archivos de xterm)
```bash
pnpm prepare
```

### 2. Ejecutar la aplicación en modo desarrollo
```bash
pnpm dev
```
*(Este comando compila/prepara y levanta la ventana de Neutralinojs con inspector web activado).*

### 3. Compilar la aplicación final multiplataforma
```bash
pnpm build
```
*(Genera los binarios ejecutables para Windows, Linux y macOS en la carpeta `dist/`)*.

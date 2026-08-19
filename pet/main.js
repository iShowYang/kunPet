const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require("electron");
const http = require("http");
const path = require("path");
const {
  lerp,
  computeTweenDurationMs,
  computePrimaryCenter,
  walkDirection,
} = require("./tween");

let win;
let tray;
let rendererReady = false;
const pendingRendererEvents = [];

/** @type {"idle"|"walking-to-center"|"celebrate"|"walking-back"} */
let petState = "idle";
/** @type {{x:number,y:number}|null} */
let originPosition = null;
/** @type {ReturnType<typeof setInterval>|null} */
let activeTween = null;

function argNum(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

function sendToRenderer(channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (rendererReady) {
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
    return;
  }
  pendingRendererEvents.push({ channel, payload });
}

function flushRendererEvents() {
  rendererReady = true;
  while (pendingRendererEvents.length > 0) {
    const event = pendingRendererEvents.shift();
    if (!win || win.isDestroyed()) continue;
    if (event.payload === undefined) {
      win.webContents.send(event.channel);
    } else {
      win.webContents.send(event.channel, event.payload);
    }
  }
}

function cancelTween() {
  if (activeTween !== null) {
    clearInterval(activeTween);
    activeTween = null;
  }
}

function getWindowPos() {
  if (!win || win.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = win.getPosition();
  return { x, y };
}

function sendWalkStart(direction) {
  sendToRenderer("pet:walk-start", { direction });
}

function sendWalkEnd() {
  sendToRenderer("pet:walk-end");
}

function tweenTo(targetX, targetY, onDone) {
  cancelTween();
  if (!win || win.isDestroyed()) return;

  const { x: fromX, y: fromY } = getWindowPos();
  const durationMs = computeTweenDurationMs(fromX, fromY, targetX, targetY);
  sendWalkStart(walkDirection(fromX, targetX));

  if (durationMs === 0) {
    win.setPosition(targetX, targetY);
    sendWalkEnd();
    onDone();
    return;
  }

  const started = Date.now();
  activeTween = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelTween();
      return;
    }
    const t = Math.min(1, (Date.now() - started) / durationMs);
    const x = Math.round(lerp(fromX, targetX, t));
    const y = Math.round(lerp(fromY, targetY, t));
    win.setPosition(x, y);
    if (t >= 1) {
      cancelTween();
      sendWalkEnd();
      onDone();
    }
  }, 16);
}

function getPrimaryCenterPos() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return computePrimaryCenter(workArea);
}

function setPetState(next) {
  petState = next;
}

function beginCelebrate() {
  if (!win) return;
  win.showInactive();

  if (petState === "walking-back") {
    cancelTween();
    sendWalkEnd();
    const pos = getWindowPos();
    originPosition = { x: pos.x, y: pos.y };
    setPetState("walking-to-center");
    const center = getPrimaryCenterPos();
    tweenTo(center.x, center.y, () => {
      setPetState("celebrate");
      sendToRenderer("pet:celebrate");
    });
    return;
  }

  if (petState === "celebrate") {
    sendToRenderer("pet:celebrate");
    return;
  }

  if (petState === "walking-to-center") {
    return;
  }

  const pos = getWindowPos();
  originPosition = { x: pos.x, y: pos.y };
  setPetState("walking-to-center");
  const center = getPrimaryCenterPos();
  tweenTo(center.x, center.y, () => {
    setPetState("celebrate");
    sendToRenderer("pet:celebrate");
  });
}

function beginReturnIdle() {
  if (!win) return;
  if (petState === "idle" || petState === "walking-back") return;

  cancelTween();

  const target = originPosition ?? getWindowPos();
  setPetState("walking-back");
  tweenTo(target.x, target.y, () => {
    originPosition = null;
    setPetState("idle");
    sendWalkEnd();
  });
}

function createWindow() {
  const x = argNum("x", undefined);
  const y = argNum("y", undefined);
  win = new BrowserWindow({
    width: 160,
    height: 210,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === "win32") {
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch (_) {
      win.setAlwaysOnTop(true);
    }
  }
  win.webContents.on("did-finish-load", flushRendererEvents);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.setIgnoreMouseEvents(false);
  win.on("moved", () => {
    if (petState !== "idle") return;
    const [wx, wy] = win.getPosition();
    process.stdout.write(JSON.stringify({ type: "moved", x: wx, y: wy }) + "\n");
  });
}

function handleMessage(msg) {
  if (!win) return;
  switch (msg.type) {
    case "celebrate":
      beginCelebrate();
      break;
    case "return-idle":
      beginReturnIdle();
      break;
    case "show":
      win.showInactive();
      break;
    case "hide":
      win.hide();
      break;
    case "set-position":
      if (petState === "idle") {
        win.setPosition(msg.x, msg.y);
      }
      break;
  }
}

function setupRendererIpc() {
  ipcMain.on("pet:dismiss-celebrate", () => {
    if (petState === "celebrate") {
      beginReturnIdle();
    }
  });
}

function startIpcServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/ipc") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            handleMessage(msg);
            res.writeHead(200).end("ok");
          } catch (_) {
            res.writeHead(400).end("bad request");
          }
        });
        return;
      }
      res.writeHead(404).end("not found");
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no IPC address"));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

function loadTrayIcon() {
  const icon32Path = path.join(__dirname, "renderer", "tray-icon.png");
  const icon16Path = path.join(__dirname, "renderer", "tray-icon-16.png");
  const idlePath = path.join(__dirname, "renderer", "kun-idle.png");

  const tryPath = (p) => {
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? null : img;
  };

  let img =
    tryPath(icon16Path) ||
    tryPath(icon32Path) ||
    tryPath(idlePath);

  if (!img) {
    return nativeImage.createEmpty();
  }

  if (process.platform === "win32") {
    const small = tryPath(icon16Path);
    if (small) return small;
    return img.resize({ width: 16, height: 16 });
  }

  const large = tryPath(icon32Path);
  return large || img.resize({ width: 32, height: 32 });
}

function setupTray() {
  const img = loadTrayIcon();
  tray = new Tray(img);
  tray.setToolTip("kunPet");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示", click: () => win?.showInactive() },
      { label: "隐藏", click: () => win?.hide() },
    ])
  );
}

app.whenReady().then(async () => {
  setupRendererIpc();
  const { port } = await startIpcServer();
  createWindow();
  setupTray();
  process.stdout.write(JSON.stringify({ type: "ready", ipcPort: port }) + "\n");
});

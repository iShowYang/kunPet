const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require("electron");
const http = require("http");
const path = require("path");
const {
  computeTweenDurationMs,
  computePrimaryCenter,
  walkDirection,
  pickWalkStyleId,
  sampleWalkPose,
} = require("./tween");

let win;
let tray;
/** @type {Electron.Menu|null} */
let trayMenu = null;
let rendererReady = false;
const pendingRendererEvents = [];

/** @type {"idle"|"working"|"walking-to-center"|"celebrate"|"walking-back"} */
let petState = "idle";
/** @type {{x:number,y:number}|null} */
let originPosition = null;
/** @type {ReturnType<typeof setInterval>|null} */
let activeTween = null;
/** @type {boolean} */
let walkEnabledForCurrentCelebrate = true;
/** @type {boolean} */
let prefsWalkToCenter = true;
/** @type {"idle"|"working"|null} */
let pendingHomePose = null;
/** @type {"straight"|"arc"|"hop"|"dash"|null} */
let activeWalkStyle = null;

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
  sendToRenderer("pet:walk-frame", { scale: 1, rotate: 0 });
  sendToRenderer("pet:walk-end");
}

function tweenWithStyle(styleId, targetX, targetY, onDone) {
  cancelTween();
  if (!win || win.isDestroyed()) return;

  const from = getWindowPos();
  const to = { x: targetX, y: targetY };
  const durationMs = computeTweenDurationMs(from.x, from.y, to.x, to.y);
  sendWalkStart(walkDirection(from.x, to.x));

  if (durationMs === 0) {
    win.setPosition(to.x, to.y);
    sendWalkEnd();
    onDone();
    return;
  }

  const style = styleId || "straight";
  const started = Date.now();
  activeTween = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelTween();
      // 避免卡在 walking-* 导致后续 celebrate 异常
      if (petState === "walking-to-center" || petState === "walking-back") {
        setPetState("idle");
      }
      return;
    }
    const t = Math.min(1, (Date.now() - started) / durationMs);
    const pose = sampleWalkPose(style, from, to, t);
    win.setPosition(Math.round(pose.x), Math.round(pose.y));
    sendToRenderer("pet:walk-frame", { scale: pose.scale, rotate: pose.rotate });
    if (t >= 1) {
      cancelTween();
      win.setPosition(to.x, to.y);
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

function celebrateInPlace() {
  pendingHomePose = null;
  setPetState("celebrate");
  sendToRenderer("pet:celebrate");
}

function finishAtHome() {
  originPosition = null;
  activeWalkStyle = null;
  const pose = pendingHomePose || "idle";
  pendingHomePose = null;
  setPetState(pose);
  sendWalkEnd();
  if (pose === "working") {
    sendToRenderer("pet:working");
  } else {
    sendToRenderer("pet:idle");
  }
}

function beginWorking() {
  if (!win) return;
  win.showInactive();

  if (petState === "working") return;

  if (petState === "celebrate" || petState === "walking-to-center") {
    pendingHomePose = "working";
    beginReturnIdle();
    return;
  }

  if (petState === "walking-back") {
    pendingHomePose = "working";
    return;
  }

  setPetState("working");
  sendToRenderer("pet:working");
}

function beginCelebrate(walkToCenter) {
  if (!win) return;
  win.showInactive();
  pendingHomePose = null;

  const shouldWalk = walkToCenter !== false;
  walkEnabledForCurrentCelebrate = shouldWalk;
  const previous = petState;

  if (!shouldWalk) {
    cancelTween();
    if (previous === "walking-to-center" || previous === "walking-back") {
      sendWalkEnd();
    }
    activeWalkStyle = null;
    originPosition = getWindowPos();
    celebrateInPlace();
    return;
  }

  // 已在庆祝：只重播，不重新走路
  if (previous === "celebrate") {
    sendToRenderer("pet:celebrate");
    return;
  }

  // 取消进行中的走路（含 walking-to-center：旧逻辑直接 return 会导致永远无法再庆祝）
  if (previous === "walking-to-center" || previous === "walking-back") {
    cancelTween();
    sendWalkEnd();
  }

  activeWalkStyle = pickWalkStyleId();
  const pos = getWindowPos();
  // 从待机/对话位出发时刷新原点；中断回程时保留原 origin
  if (previous === "idle" || previous === "working" || !originPosition) {
    originPosition = { x: pos.x, y: pos.y };
  }
  setPetState("walking-to-center");
  const center = getPrimaryCenterPos();
  tweenWithStyle(activeWalkStyle, center.x, center.y, () => {
    celebrateInPlace();
  });
}

function beginReturnIdle() {
  if (!win) return;
  if (petState === "idle") return;
  if (petState === "walking-back") return;
  // 对话中（working）：sessionStart 的 return-idle 不应把插兜打回待机
  if (petState === "working") return;

  cancelTween();

  if (!walkEnabledForCurrentCelebrate) {
    finishAtHome();
    return;
  }

  const target = originPosition ?? getWindowPos();
  const style = activeWalkStyle || "straight";
  setPetState("walking-back");
  tweenWithStyle(style, target.x, target.y, () => {
    finishAtHome();
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
      beginCelebrate(msg.walkToCenter !== false);
      break;
    case "return-idle":
      pendingHomePose = "idle";
      beginReturnIdle();
      break;
    case "working":
      beginWorking();
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
    case "set-prefs":
      if (typeof msg.walkToCenter === "boolean") {
        prefsWalkToCenter = msg.walkToCenter;
        rebuildTrayMenu();
      }
      break;
  }
}

function setupRendererIpc() {
  ipcMain.on("pet:dismiss-celebrate", () => {
    if (petState === "celebrate") {
      pendingHomePose = "idle";
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

function emitToExtension(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function rebuildTrayMenu() {
  if (!tray) return;
  trayMenu = Menu.buildFromTemplate([
    { label: "显示", click: () => win?.showInactive() },
    { label: "隐藏", click: () => win?.hide() },
    { type: "separator" },
    {
      label: prefsWalkToCenter ? "关闭走到中间" : "开启走到中间",
      click: () => {
        const next = !prefsWalkToCenter;
        prefsWalkToCenter = next;
        emitToExtension({ type: "request-walk-to-center", value: next });
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "禁用桌宠",
      click: () => emitToExtension({ type: "request-disable" }),
    },
    {
      label: "打开设置",
      click: () => emitToExtension({ type: "request-open-settings" }),
    },
  ]);
  // macOS/Linux 依赖 setContextMenu；Windows 用 right-click + popUp，避免菜单不出现
  if (process.platform === "win32") {
    tray.setContextMenu(null);
  } else {
    tray.setContextMenu(trayMenu);
  }
}

function setupTray() {
  const img = loadTrayIcon();
  tray = new Tray(img);
  tray.setToolTip("kunPet");
  rebuildTrayMenu();
  if (process.platform === "win32") {
    tray.on("right-click", (_event, bounds) => {
      if (!trayMenu) rebuildTrayMenu();
      if (trayMenu) tray.popUpContextMenu(trayMenu, bounds);
    });
  }
}

app.whenReady().then(async () => {
  setupRendererIpc();
  const { port } = await startIpcServer();
  createWindow();
  setupTray();
  process.stdout.write(JSON.stringify({ type: "ready", ipcPort: port }) + "\n");
});

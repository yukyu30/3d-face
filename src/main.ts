import { EMOJIS, EmojiDef } from "./emojis";

interface Stamp {
  id: number;
  emoji: EmojiDef;
  img: HTMLImageElement;
  x: number; // 画像座標（naturalWidth基準）
  y: number;
  scale: number;
  rotation: number; // ラジアン
}

let stamps: Stamp[] = [];
let nextId = 1;
let selectedId: number | null = null;
let imageLoaded = false;
let currentFileName = "";
let sourceFileHandle: FileSystemFileHandle | null = null;

// DOM
const dropZone = document.getElementById("dropZone")!;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const preview = document.getElementById("preview") as HTMLImageElement;
const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const swapBtn = document.getElementById("swapBtn") as HTMLButtonElement;
const swapInput = document.getElementById("swapInput") as HTMLInputElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const saveAsBtn = document.getElementById("saveAsBtn") as HTMLButtonElement;
const overwriteCheck = document.getElementById("overwriteCheck") as HTMLInputElement;
const searchInput = document.getElementById("searchInput") as HTMLInputElement;
const emojiGrid = document.getElementById("emojiGrid") as HTMLDivElement;
const placedList = document.getElementById("placedList") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const fileNameEl = document.getElementById("fileName") as HTMLSpanElement;

// --- 座標変換 ---
function getImageLayout() {
  const rect = preview.getBoundingClientRect();
  const parent = preview.parentElement!.getBoundingClientRect();
  return {
    ox: rect.left - parent.left,
    oy: rect.top - parent.top,
    w: rect.width,
    h: rect.height,
    sx: rect.width / preview.naturalWidth,
    sy: rect.height / preview.naturalHeight,
  };
}

// --- ハンドル ---
const HR = 8;
function getStampScreenRect(stamp: Stamp) {
  const { ox, oy, sx, sy } = getImageLayout();
  const cx = stamp.x * sx + ox;
  const cy = stamp.y * sy + oy;
  const size = stamp.scale * Math.min(sx, sy);
  const hw = size / 2, hh = size / 2;
  return { cx, cy, hw, hh, size };
}

type HandleType = "move" | "scale-tl" | "scale-tr" | "scale-bl" | "scale-br" | "rotate";
interface Handle { type: HandleType; x: number; y: number; }

function getHandles(stamp: Stamp): Handle[] {
  const { cx, cy, hw, hh } = getStampScreenRect(stamp);
  return [
    { type: "scale-tl", x: cx - hw, y: cy - hh },
    { type: "scale-tr", x: cx + hw, y: cy - hh },
    { type: "scale-bl", x: cx - hw, y: cy + hh },
    { type: "scale-br", x: cx + hw, y: cy + hh },
    { type: "rotate", x: cx, y: cy - hh - 22 },
    { type: "move", x: cx, y: cy },
  ];
}

function drawHandles(stamp: Stamp) {
  const { cx, cy, hw, hh } = getStampScreenRect(stamp);
  ctx.strokeStyle = "#e94560"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
  ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2); ctx.setLineDash([]);

  // 回転接続線
  ctx.strokeStyle = "#4488ff"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx, cy - hh - 22); ctx.stroke();

  for (const h of getHandles(stamp)) {
    if (h.type.startsWith("scale")) {
      ctx.fillStyle = "#ffcc00"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
      ctx.fillRect(h.x - 4, h.y - 4, 8, 8); ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
    } else if (h.type === "rotate") {
      ctx.beginPath(); ctx.arc(h.x, h.y, HR, 0, Math.PI * 2);
      ctx.fillStyle = "#4488ff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("R", h.x, h.y);
    } else if (h.type === "move") {
      ctx.beginPath(); ctx.arc(h.x, h.y, HR + 1, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = "#333"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(h.x - 5, h.y); ctx.lineTo(h.x + 5, h.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(h.x, h.y - 5); ctx.lineTo(h.x, h.y + 5); ctx.stroke();
    }
  }
}

// --- レンダー ---
function render() {
  if (!imageLoaded) { requestAnimationFrame(render); return; }
  const parent = preview.parentElement!.getBoundingClientRect();
  if (canvas.width !== parent.width || canvas.height !== parent.height) {
    canvas.width = parent.width; canvas.height = parent.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { ox, oy, sx, sy } = getImageLayout();
  const minS = Math.min(sx, sy);

  for (const stamp of stamps) {
    const cx = stamp.x * sx + ox;
    const cy = stamp.y * sy + oy;
    const size = stamp.scale * minS;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(stamp.rotation);
    ctx.drawImage(stamp.img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  if (selectedId !== null) {
    const stamp = stamps.find((s) => s.id === selectedId);
    if (stamp) drawHandles(stamp);
  }

  requestAnimationFrame(render);
}
render();

// --- ドラッグ ---
type DragMode = "none" | "move" | "scale" | "rotate";
let isDragging = false, dragMode: DragMode = "none";
let dragStartX = 0, dragStartY = 0;
let dragStartVal = 0, dragStartVal2 = 0;

function hitHandle(px: number, py: number, stamp: Stamp): DragMode {
  for (const h of getHandles(stamp)) {
    if (Math.sqrt((px - h.x) ** 2 + (py - h.y) ** 2) <= HR + 4) {
      if (h.type === "move") return "move";
      if (h.type.startsWith("scale")) return "scale";
      if (h.type === "rotate") return "rotate";
    }
  }
  return "none";
}

function findStampAt(px: number, py: number): Stamp | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    const { cx, cy, hw, hh } = getStampScreenRect(stamps[i]);
    if (px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh) return stamps[i];
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;

  // ハンドルチェック
  if (selectedId !== null) {
    const stamp = stamps.find((s) => s.id === selectedId);
    if (stamp) {
      const hm = hitHandle(px, py, stamp);
      if (hm !== "none") {
        isDragging = true; dragMode = hm; dragStartX = px; dragStartY = py;
        if (hm === "move") { dragStartVal = stamp.x; dragStartVal2 = stamp.y; }
        else if (hm === "scale") { dragStartVal = stamp.scale; }
        else if (hm === "rotate") { dragStartVal = stamp.rotation; }
        canvas.style.cursor = hm === "move" ? "grabbing" : hm === "scale" ? "nwse-resize" : "alias";
        return;
      }
    }
  }

  const hit = findStampAt(px, py);
  if (hit) {
    selectedId = hit.id;
    isDragging = true; dragMode = "move"; dragStartX = px; dragStartY = py;
    dragStartVal = hit.x; dragStartVal2 = hit.y;
    canvas.style.cursor = "grabbing";
  } else {
    selectedId = null; dragMode = "none";
  }
  renderPlacedList();
});

canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;

  if (!isDragging || selectedId === null) {
    if (selectedId !== null) {
      const stamp = stamps.find((s) => s.id === selectedId);
      if (stamp && hitHandle(px, py, stamp) !== "none") {
        const hm = hitHandle(px, py, stamp);
        canvas.style.cursor = hm === "move" ? "grab" : hm === "scale" ? "nwse-resize" : "alias"; return;
      }
    }
    canvas.style.cursor = findStampAt(px, py) ? "grab" : "default"; return;
  }

  const stamp = stamps.find((s) => s.id === selectedId);
  if (!stamp) return;

  const { sx, sy } = getImageLayout();
  const dx = px - dragStartX, dy = py - dragStartY;

  if (dragMode === "move") {
    stamp.x = dragStartVal + dx / sx;
    stamp.y = dragStartVal2 + dy / sy;
  } else if (dragMode === "scale") {
    const d = Math.sqrt(dx * dx + dy * dy) * ((dx + dy) > 0 ? 1 : -1);
    stamp.scale = Math.max(20, dragStartVal + d / Math.min(sx, sy));
  } else if (dragMode === "rotate") {
    stamp.rotation = dragStartVal + dx * 0.01;
  }
});

canvas.addEventListener("pointerup", () => { isDragging = false; dragMode = "none"; canvas.style.cursor = "default"; });
canvas.addEventListener("pointerleave", () => { isDragging = false; dragMode = "none"; });

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (selectedId === null) return;
  const stamp = stamps.find((s) => s.id === selectedId);
  if (!stamp) return;
  stamp.scale = Math.max(20, stamp.scale * (e.deltaY > 0 ? 0.95 : 1.05));
}, { passive: false });

// --- ファイル処理 ---
dropZone.addEventListener("click", async () => {
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"] } }],
      });
      const file = await handle.getFile();
      handleFile(file, false, handle); return;
    } catch { return; /* cancelled */ }
  }
  fileInput.click();
});
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault(); dropZone.classList.remove("dragover");
  const items = (e as DragEvent).dataTransfer?.items;
  if (items?.[0]) {
    // File System Access APIでハンドル取得を試みる
    const item = items[0];
    if ("getAsFileSystemHandle" in item) {
      try {
        const handle = await (item as any).getAsFileSystemHandle() as FileSystemFileHandle;
        if (handle.kind === "file") {
          const file = await handle.getFile();
          handleFile(file, false, handle); return;
        }
      } catch { /* fallback */ }
    }
    const f = item.getAsFile();
    if (f) handleFile(f);
  }
});
fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });

swapBtn.addEventListener("click", () => swapInput.click());
swapInput.addEventListener("change", () => { if (swapInput.files?.[0]) handleFile(swapInput.files[0], true); swapInput.value = ""; });

function handleFile(file: File, keepStamps = false, handle?: FileSystemFileHandle) {
  currentFileName = file.name;
  fileNameEl.textContent = currentFileName;
  if (handle) sourceFileHandle = handle;
  else if (!keepStamps) sourceFileHandle = null;
  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target!.result as string;
    preview.onload = () => {
      preview.style.display = "block"; dropZone.classList.add("hidden");
      imageLoaded = true; swapBtn.disabled = false; saveBtn.disabled = false; saveAsBtn.disabled = false;
      statusEl.textContent = keepStamps ? "画像を切り替えました" : "";
    };
  };
  reader.readAsDataURL(file);
}

// --- Emoji ピッカー ---
function renderEmojiGrid(filter = "") {
  emojiGrid.innerHTML = "";
  const lf = filter.toLowerCase();
  const filtered = lf ? EMOJIS.filter((e) => e.name.includes(lf) || e.keywords.some((k) => k.includes(lf))) : EMOJIS;

  for (const emoji of filtered) {
    const img = document.createElement("img");
    img.src = emoji.url;
    img.alt = emoji.name;
    img.title = `${emoji.name} (${emoji.keywords.join(", ")})`;
    img.loading = "lazy";
    img.addEventListener("click", () => addStamp(emoji));
    emojiGrid.appendChild(img);
  }
}

searchInput.addEventListener("input", () => renderEmojiGrid(searchInput.value));
renderEmojiGrid();

function addStamp(emoji: EmojiDef) {
  if (!imageLoaded) { statusEl.textContent = "先に画像を読み込んでください"; return; }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = emoji.url;
  img.onload = () => {
    const stamp: Stamp = {
      id: nextId++,
      emoji,
      img,
      x: preview.naturalWidth / 2,
      y: preview.naturalHeight / 2,
      scale: Math.min(preview.naturalWidth, preview.naturalHeight) * 0.3,
      rotation: 0,
    };
    stamps.push(stamp);
    selectedId = stamp.id;
    renderPlacedList();
    statusEl.textContent = `${emoji.name} を配置しました`;
  };
  img.onerror = () => { statusEl.textContent = `${emoji.name} の読み込みに失敗しました`; };
}

// --- 配置済みリスト ---
function renderPlacedList() {
  placedList.innerHTML = "";
  for (const stamp of stamps) {
    const div = document.createElement("div");
    div.className = `placed-item ${stamp.id === selectedId ? "selected" : ""}`;
    div.innerHTML = `<span>${stamp.emoji.name}</span><button class="small danger" data-sid="${stamp.id}">x</button>`;
    div.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      selectedId = stamp.id; renderPlacedList();
    });
    placedList.appendChild(div);
  }
  placedList.querySelectorAll("button[data-sid]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = parseInt((e.target as HTMLElement).dataset.sid!);
    stamps = stamps.filter((s) => s.id !== id);
    if (selectedId === id) selectedId = null;
    renderPlacedList();
  }));
}

// --- 保存 ---
function renderToBlob(): Promise<Blob> {
  return new Promise((resolve) => {
    const w = preview.naturalWidth, h = preview.naturalHeight;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cctx = c.getContext("2d")!;
    cctx.drawImage(preview, 0, 0);
    for (const stamp of stamps) {
      cctx.save();
      cctx.translate(stamp.x, stamp.y);
      cctx.rotate(stamp.rotation);
      cctx.drawImage(stamp.img, -stamp.scale / 2, -stamp.scale / 2, stamp.scale, stamp.scale);
      cctx.restore();
    }
    c.toBlob((blob) => resolve(blob!), "image/png");
  });
}

async function writeToHandle(handle: FileSystemFileHandle, blob: Blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// 保存ボタン: 上書きチェックON → 元ファイルに上書き / OFF → 名前を付けて保存
saveBtn.addEventListener("click", async () => {
  const blob = await renderToBlob();

  if (overwriteCheck.checked && sourceFileHandle) {
    try {
      await writeToHandle(sourceFileHandle, blob);
      statusEl.textContent = `${currentFileName} に上書き保存しました`;
      return;
    } catch (err) {
      statusEl.textContent = "上書き保存に失敗しました。名前を付けて保存します。";
    }
  }

  // showSaveFilePicker で保存先選択
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${currentFileName.replace(/\.[^.]+$/, "")}.png`,
        types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
      });
      await writeToHandle(handle, blob);
      statusEl.textContent = `${handle.name} に保存しました`;
      return;
    } catch { return; /* cancelled */ }
  }

  // フォールバック: ダウンロード
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = `${currentFileName.replace(/\.[^.]+$/, "")}.png`;
  a.href = url; a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `${a.download} をダウンロードしました`;
});

// 名前を付けて保存ボタン: 常に保存先選択
saveAsBtn.addEventListener("click", async () => {
  const blob = await renderToBlob();

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${currentFileName.replace(/\.[^.]+$/, "")}.png`,
        types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
      });
      await writeToHandle(handle, blob);
      statusEl.textContent = `${handle.name} に保存しました`;
      return;
    } catch { return; }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = `${currentFileName.replace(/\.[^.]+$/, "")}.png`;
  a.href = url; a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `${a.download} をダウンロードしました`;
});

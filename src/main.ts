import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { calculateFaceAngles, Point3D } from "./faceAngle";
import { calculateFaceTransform } from "./faceTransform";
import { RegisteredPerson, findMatchingPerson, FaceDescriptor } from "./faceRegistry";
import type { StoredModel, ModelType } from "./db";

const NOSE_TIP = 1, FOREHEAD = 10, CHIN = 152, LEFT_EYE = 33, RIGHT_EYE = 263;

declare global {
  interface Window {
    electronAPI?: {
      getAllPersons: () => Promise<RegisteredPerson[]>;
      addPerson: (name: string, modelUrl: string, descriptors: FaceDescriptor[]) => Promise<RegisteredPerson>;
      deletePerson: (id: string) => Promise<void>;
      addDescriptor: (personId: string, descriptor: FaceDescriptor) => Promise<void>;
      getAllModels: () => Promise<StoredModel[]>;
      getModel: (id: string) => Promise<StoredModel | null>;
      importModel: () => Promise<StoredModel | null>;
      importImage: () => Promise<StoredModel | null>;
      deleteModel: (id: string) => Promise<void>;
      readModelFile: (storedPath: string) => Promise<Uint8Array | null>;
      saveFile: (defaultName: string, dataUrl: string) => Promise<string | null>;
    };
    FaceMesh: any;
  }
}

interface MaskEntry {
  id: number;
  label: string;
  mesh: THREE.Object3D;
  offsetX: number;
  offsetY: number;
  scaleMultiplier: number;
  rotOffsetX: number; // 領域のpitch
  rotOffsetY: number; // 領域のyaw
  rotOffsetZ: number; // 領域のroll
  modelQuat: THREE.Quaternion; // モデル自体のアークボール回転
  basePosition: { x: number; y: number };
  baseScale: number;
  baseAngles: { pitch: number; yaw: number; roll: number };
  modelId: string;
}

function landmarksToDescriptor(landmarks: { x: number; y: number; z: number }[]): FaceDescriptor {
  const keyIndices = [1, 10, 33, 61, 133, 152, 199, 263, 291, 362];
  const embedding: number[] = [];
  for (let i = 0; i < keyIndices.length; i++) {
    for (let j = i + 1; j < keyIndices.length; j++) {
      const a = landmarks[keyIndices[i]], b = landmarks[keyIndices[j]];
      embedding.push(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2));
    }
  }
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) embedding.forEach((_, i, arr) => (arr[i] /= norm));
  return { embedding };
}

function createDefaultBox(hue = 220): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1.3, 0.6);
  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(`hsl(${hue}, 70%, 50%)`),
    opacity: 0.85,
    transparent: true,
  });
  return new THREE.Mesh(geo, mat);
}

async function main() {
  const dropZone = document.getElementById("dropZone")!;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const preview = document.getElementById("preview") as HTMLImageElement;
  const canvas = document.getElementById("interactionCanvas") as HTMLCanvasElement;
  const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
  const addMaskBtn = document.getElementById("addMaskBtn") as HTMLButtonElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const swapImageBtn = document.getElementById("swapImageBtn") as HTMLButtonElement;
  const swapFileInput = document.getElementById("swapFileInput") as HTMLInputElement;
  const importModelBtn = document.getElementById("importModelBtn") as HTMLButtonElement;
  const importImageBtn = document.getElementById("importImageBtn") as HTMLButtonElement;
  const registerBtn = document.getElementById("registerBtn") as HTMLButtonElement;
  const maskListEl = document.getElementById("maskList") as HTMLDivElement;
  const modelListEl = document.getElementById("modelList") as HTMLDivElement;
  const registryListEl = document.getElementById("registryList") as HTMLDivElement;
  const personNameInput = document.getElementById("personName") as HTMLInputElement;
  const personModelSelect = document.getElementById("personModelSelect") as HTMLSelectElement;
  const fileNameEl = document.getElementById("fileName") as HTMLSpanElement;
  const statusEl = document.getElementById("status") as HTMLDivElement;

  const useElectron = !!window.electronAPI;
  let currentFileName = "";
  let registry: RegisteredPerson[] = [];
  let models: StoredModel[] = [];
  let maskEntries: MaskEntry[] = [];
  let nextMaskId = 1;
  let lastLandmarks: { x: number; y: number; z: number }[][] = [];
  let imageLoaded = false;
  let selectedMaskId: number | null = null;

  // --- Three.js ---
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 1000);
  camera.position.z = 500;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(0, -200, 500);
  scene.add(dirLight);

  const gltfLoader = new GLTFLoader();
  const modelCache = new Map<string, THREE.Object3D>();

  // --- 2Dコンテキスト（合成レンダリング用） ---
  const ctx = canvas.getContext("2d")!;

  // --- データ読み込み ---
  async function loadRegistry() {
    if (useElectron) registry = await window.electronAPI!.getAllPersons();
    else { const d = localStorage.getItem("face3d_registry"); registry = d ? JSON.parse(d) : []; }
  }
  async function loadModels() {
    if (useElectron) models = await window.electronAPI!.getAllModels();
    else models = [];
  }
  await loadRegistry();
  await loadModels();

  // --- レンダーループ ---
  function render() {
    if (!imageLoaded) { requestAnimationFrame(render); return; }
    const img = preview;
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement!.getBoundingClientRect();
    const ox = rect.left - parent.left;
    const oy = rect.top - parent.top;
    const w = rect.width, h = rect.height;
    const sx = w / img.naturalWidth, sy = h / img.naturalHeight;

    // キャンバスサイズをカンバスエリアに合わせる
    if (canvas.width !== parent.width || canvas.height !== parent.height) {
      canvas.width = parent.width;
      canvas.height = parent.height;
    }

    // 2Dキャンバスクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Three.jsレンダラーサイズ合わせ
    renderer.setSize(w, h);
    camera.right = w;
    camera.bottom = h;
    camera.updateProjectionMatrix();

    // メッシュ更新
    for (const entry of maskEntries) {
      const px = entry.basePosition.x * sx + entry.offsetX;
      const py = entry.basePosition.y * sy + entry.offsetY;
      const s = entry.baseScale * Math.min(sx, sy) * entry.scaleMultiplier;
      entry.mesh.position.set(px, py, 0);
      entry.mesh.scale.set(s, s, s);
      // 領域回転 + モデル自体のアークボール回転を合成
      const baseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        entry.baseAngles.pitch + entry.rotOffsetX,
        -(entry.baseAngles.yaw) + entry.rotOffsetY,
        -(entry.baseAngles.roll) + entry.rotOffsetZ
      ));
      const finalQ = baseQ.multiply(entry.modelQuat);
      entry.mesh.quaternion.copy(finalQ);
    }

    renderer.render(scene, camera);

    // Three.js結果を2Dキャンバスの画像位置に描画
    ctx.drawImage(renderer.domElement, ox, oy);

    // 選択マスクのハンドル描画
    if (selectedMaskId !== null) {
      const entry = maskEntries.find((m) => m.id === selectedMaskId);
      if (entry) {
        drawHandles(ctx, entry, sx, sy, ox, oy);
      }
    }

    requestAnimationFrame(render);
  }
  render();

  // --- ハンドル描画 ---
  const HANDLE_SIZE = 8;
  const HANDLE_RADIUS = 7;
  const COLORS = { move: "#ffffff", scale: "#ffcc00", rotX: "#ff4444", rotY: "#44ff44", rotZ: "#4488ff", outline: "#e94560" };

  function getMaskRect(entry: MaskEntry, sx: number, sy: number, ox: number, oy: number) {
    const cx = entry.basePosition.x * sx + entry.offsetX + ox;
    const cy = entry.basePosition.y * sy + entry.offsetY + oy;
    const s = entry.baseScale * Math.min(sx, sy) * entry.scaleMultiplier;
    const hw = s * 0.65, hh = s * 0.8;
    return { cx, cy, hw, hh, s };
  }

  type HandleType = "move" | "scale-tl" | "scale-tr" | "scale-bl" | "scale-br" | "rotX-top" | "rotX-bot" | "rotY-left" | "rotY-right" | "rotZ" | "move-handle";

  interface HandleDef { type: HandleType; x: number; y: number; }

  function getHandles(entry: MaskEntry, sx: number, sy: number, ox: number, oy: number): HandleDef[] {
    const { cx, cy, hw, hh } = getMaskRect(entry, sx, sy, ox, oy);
    return [
      // 四隅: スケール
      { type: "scale-tl", x: cx - hw, y: cy - hh },
      { type: "scale-tr", x: cx + hw, y: cy - hh },
      { type: "scale-bl", x: cx - hw, y: cy + hh },
      { type: "scale-br", x: cx + hw, y: cy + hh },
      // 上下: X回転 (赤)
      { type: "rotX-top", x: cx, y: cy - hh - 20 },
      { type: "rotX-bot", x: cx, y: cy + hh + 20 },
      // 左右: Y回転 (緑)
      { type: "rotY-left", x: cx - hw - 20, y: cy },
      { type: "rotY-right", x: cx + hw + 20, y: cy },
      // 右上外側: Z回転 (青)
      { type: "rotZ", x: cx + hw + 14, y: cy - hh - 14 },
      // 中央: 移動ハンドル (白)
      { type: "move-handle", x: cx, y: cy },
    ];
  }

  function drawHandles(c: CanvasRenderingContext2D, entry: MaskEntry, sx: number, sy: number, ox: number, oy: number) {
    const { cx, cy, hw, hh } = getMaskRect(entry, sx, sy, ox, oy);

    // バウンディングボックス
    c.strokeStyle = COLORS.outline;
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    c.setLineDash([]);

    const handles = getHandles(entry, sx, sy, ox, oy);
    for (const h of handles) {
      if (h.type.startsWith("scale")) {
        // 四角ハンドル (黄)
        c.fillStyle = COLORS.scale;
        c.strokeStyle = "#000";
        c.lineWidth = 1;
        c.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        c.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      } else if (h.type.startsWith("rotX")) {
        // X回転 (赤丸)
        c.beginPath();
        c.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        c.fillStyle = COLORS.rotX;
        c.fill();
        c.strokeStyle = "#000";
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = "#fff";
        c.font = "bold 8px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("X", h.x, h.y);
      } else if (h.type.startsWith("rotY")) {
        // Y回転 (緑丸)
        c.beginPath();
        c.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        c.fillStyle = COLORS.rotY;
        c.fill();
        c.strokeStyle = "#000";
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = "#fff";
        c.font = "bold 8px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("Y", h.x, h.y);
      } else if (h.type === "rotZ") {
        // Z回転 (青丸)
        c.beginPath();
        c.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        c.fillStyle = COLORS.rotZ;
        c.fill();
        c.strokeStyle = "#000";
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = "#fff";
        c.font = "bold 8px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("Z", h.x, h.y);
      } else if (h.type === "move-handle") {
        // 移動ハンドル (白い十字)
        c.beginPath();
        c.arc(h.x, h.y, HANDLE_RADIUS + 2, 0, Math.PI * 2);
        c.fillStyle = COLORS.move;
        c.fill();
        c.strokeStyle = "#000";
        c.lineWidth = 1;
        c.stroke();
        // 十字矢印
        c.strokeStyle = "#333";
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(h.x - 5, h.y); c.lineTo(h.x + 5, h.y); c.stroke();
        c.beginPath(); c.moveTo(h.x, h.y - 5); c.lineTo(h.x, h.y + 5); c.stroke();
      }
    }

    // 接続線 (ハンドル ← ボックス)
    c.strokeStyle = COLORS.rotX;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy - hh); c.lineTo(cx, cy - hh - 20); c.stroke();
    c.beginPath(); c.moveTo(cx, cy + hh); c.lineTo(cx, cy + hh + 20); c.stroke();
    c.strokeStyle = COLORS.rotY;
    c.beginPath(); c.moveTo(cx - hw, cy); c.lineTo(cx - hw - 20, cy); c.stroke();
    c.beginPath(); c.moveTo(cx + hw, cy); c.lineTo(cx + hw + 20, cy); c.stroke();
    c.strokeStyle = COLORS.rotZ;
    c.beginPath(); c.moveTo(cx + hw, cy - hh); c.lineTo(cx + hw + 14, cy - hh - 14); c.stroke();
  }

  // --- ドラッグ操作 ---
  type DragMode = "none" | "move" | "scale" | "rotX" | "rotY" | "rotZ" | "arcball";
  let isDragging = false;
  let dragMode: DragMode = "none";
  let dragStartX = 0, dragStartY = 0;
  let dragStartOffsetX = 0, dragStartOffsetY = 0;
  let dragStartScale = 1;
  let dragStartRotX = 0, dragStartRotY = 0, dragStartRotZ = 0;
  let dragStartQuat = new THREE.Quaternion();
  let lastArcballX = 0, lastArcballY = 0;

  function hitTestHandles(px: number, py: number, entry: MaskEntry): DragMode {
    const img = preview;
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement!.getBoundingClientRect();
    const ox = rect.left - parent.left, oy = rect.top - parent.top;
    const sx = rect.width / img.naturalWidth, sy = rect.height / img.naturalHeight;

    const handles = getHandles(entry, sx, sy, ox, oy);
    for (const h of handles) {
      const dist = Math.sqrt((px - h.x) ** 2 + (py - h.y) ** 2);
      if (dist <= HANDLE_RADIUS + 4) {
        if (h.type === "move-handle") return "move";
        if (h.type.startsWith("scale")) return "scale";
        if (h.type.startsWith("rotX")) return "rotX";
        if (h.type.startsWith("rotY")) return "rotY";
        if (h.type === "rotZ") return "rotZ";
      }
    }
    return "none";
  }

  function findMaskAtPoint(px: number, py: number): MaskEntry | null {
    const img = preview;
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement!.getBoundingClientRect();
    const ox = rect.left - parent.left, oy = rect.top - parent.top;
    const sx = rect.width / img.naturalWidth, sy = rect.height / img.naturalHeight;

    for (let i = maskEntries.length - 1; i >= 0; i--) {
      const entry = maskEntries[i];
      const { cx, cy, hw, hh } = getMaskRect(entry, sx, sy, ox, oy);
      if (px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh) return entry;
    }
    return null;
  }

  const cursors: Record<DragMode, string> = {
    none: "default", move: "grabbing", scale: "nwse-resize",
    rotX: "ns-resize", rotY: "ew-resize", rotZ: "alias", arcball: "all-scroll",
  };

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;

    // 1) 選択中のマスクのハンドルを先にチェック
    if (selectedMaskId !== null) {
      const entry = maskEntries.find((m) => m.id === selectedMaskId);
      if (entry) {
        const handleMode = hitTestHandles(px, py, entry);
        if (handleMode !== "none") {
          isDragging = true;
          dragMode = handleMode;
          dragStartX = px; dragStartY = py;
          dragStartOffsetX = entry.offsetX; dragStartOffsetY = entry.offsetY;
          dragStartScale = entry.scaleMultiplier;
          dragStartRotX = entry.rotOffsetX; dragStartRotY = entry.rotOffsetY; dragStartRotZ = entry.rotOffsetZ;
          canvas.style.cursor = cursors[dragMode];
          return;
        }
      }
    }

    // 2) マスク本体のクリック判定
    //    - 選択済みのマスク本体 → arcball回転
    //    - 未選択のマスク本体 → 選択 + arcball回転
    const hit = findMaskAtPoint(px, py);
    if (hit) {
      selectedMaskId = hit.id;
      isDragging = true;
      dragMode = "arcball";
      dragStartX = px; dragStartY = py;
      lastArcballX = px; lastArcballY = py;
      dragStartQuat = hit.modelQuat.clone();
      dragStartOffsetX = hit.offsetX; dragStartOffsetY = hit.offsetY;
      dragStartScale = hit.scaleMultiplier;
      dragStartRotX = hit.rotOffsetX; dragStartRotY = hit.rotOffsetY; dragStartRotZ = hit.rotOffsetZ;
      canvas.style.cursor = "all-scroll";
    } else {
      selectedMaskId = null;
      dragMode = "none";
    }
    renderMaskList();
  });

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const dx = px - dragStartX, dy = py - dragStartY;

    if (!isDragging || selectedMaskId === null) {
      // ホバー: ハンドル上ならカーソル変更
      if (selectedMaskId !== null) {
        const entry = maskEntries.find((m) => m.id === selectedMaskId);
        if (entry) {
          const hm = hitTestHandles(px, py, entry);
          if (hm !== "none") { canvas.style.cursor = cursors[hm]; return; }
        }
      }
      const hit = findMaskAtPoint(px, py);
      canvas.style.cursor = hit ? "grab" : "default";
      return;
    }

    const entry = maskEntries.find((m) => m.id === selectedMaskId);
    if (!entry) return;

    switch (dragMode) {
      case "move":
        entry.offsetX = dragStartOffsetX + dx;
        entry.offsetY = dragStartOffsetY + dy;
        break;
      case "scale": {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sign = (dx + dy) > 0 ? 1 : -1;
        entry.scaleMultiplier = Math.max(0.1, Math.min(5, dragStartScale + sign * dist * 0.005));
        break;
      }
      case "rotX":
        entry.rotOffsetX = dragStartRotX + dy * 0.01;
        break;
      case "rotY":
        entry.rotOffsetY = dragStartRotY + dx * 0.01;
        break;
      case "rotZ":
        entry.rotOffsetZ = dragStartRotZ + dx * 0.01;
        break;
      case "arcball": {
        // アークボール: ドラッグ差分から回転クォータニオンを生成
        const adx = px - lastArcballX;
        const ady = py - lastArcballY;
        lastArcballX = px;
        lastArcballY = py;
        const speed = 0.005;
        // Yドラッグ → X軸回転、Xドラッグ → Y軸回転
        const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ady * speed);
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), adx * speed);
        const delta = qx.multiply(qy);
        entry.modelQuat.premultiply(delta);
        break;
      }
    }
  });

  canvas.addEventListener("pointerup", () => {
    isDragging = false;
    dragMode = "none";
    canvas.style.cursor = "default";
  });

  canvas.addEventListener("pointerleave", () => {
    isDragging = false;
    dragMode = "none";
  });

  // スクロールで拡縮 (選択なしでもホバー中のマスクに適用)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (selectedMaskId === null) return;
    const entry = maskEntries.find((m) => m.id === selectedMaskId);
    if (!entry) return;
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    entry.scaleMultiplier = Math.max(0.1, Math.min(5, entry.scaleMultiplier * delta));
  }, { passive: false });

  // --- ファイル処理 ---
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); dropZone.classList.remove("dragover");
    const f = (e as DragEvent).dataTransfer?.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });

  // 画像切替（マスク設定を保持）
  swapImageBtn.addEventListener("click", () => swapFileInput.click());
  swapFileInput.addEventListener("change", () => {
    if (swapFileInput.files?.[0]) handleFile(swapFileInput.files[0], true);
    swapFileInput.value = "";
  });

  function handleFile(file: File, keepMasks = false) {
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target!.result as string;
      preview.onload = () => {
        preview.style.display = "block";
        dropZone.classList.add("hidden");
        imageLoaded = true;
        detectBtn.disabled = false;
        addMaskBtn.disabled = false;
        saveBtn.disabled = false;
        swapImageBtn.disabled = false;
        if (!keepMasks) {
          statusEl.textContent = "";
        } else {
          statusEl.textContent = "画像を切り替えました（マスク設定を引き継ぎ）";
        }
      };
    };
    reader.readAsDataURL(file);
  }

  // --- 顔検出 ---
  detectBtn.addEventListener("click", async () => {
    detectBtn.disabled = true;
    detectBtn.textContent = "検出中...";
    statusEl.textContent = "顔を検出しています...";
    try { await detectFaces(); }
    catch (err) { console.error(err); statusEl.textContent = "顔検出に失敗しました"; }
    finally { detectBtn.disabled = false; detectBtn.textContent = "顔検出"; }
  });

  async function detectFaces(): Promise<void> {
    return new Promise((resolve, reject) => {
      const FaceMesh = window.FaceMesh;
      if (!FaceMesh) { reject(new Error("FaceMesh not loaded")); return; }

      const faceMesh = new FaceMesh({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({ maxNumFaces: 10, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

      faceMesh.onResults(async (results: any) => {
        // 既存マスク全削除
        for (const e of maskEntries) scene.remove(e.mesh);
        maskEntries = [];
        lastLandmarks = [];
        selectedMaskId = null;

        if (results.multiFaceLandmarks?.length > 0) {
          const w = preview.naturalWidth, h = preview.naturalHeight;

          for (let i = 0; i < results.multiFaceLandmarks.length; i++) {
            const lm = results.multiFaceLandmarks[i];
            lastLandmarks.push(lm);

            const angles = calculateFaceAngles(lm[NOSE_TIP], lm[FOREHEAD], lm[CHIN], lm[LEFT_EYE], lm[RIGHT_EYE]);
            const allPts: Point3D[] = lm.map((l: any) => ({ x: l.x, y: l.y, z: l.z }));
            const tf = calculateFaceTransform(allPts, w, h, angles);

            const desc = landmarksToDescriptor(lm);
            const person = findMatchingPerson(desc, registry);
            const modelId = person?.modelUrl || "";

            const mesh = await loadMeshForModel(modelId, i);
            const entry: MaskEntry = {
              id: nextMaskId++,
              label: person ? person.name : `顔 ${i + 1}`,
              mesh, offsetX: 0, offsetY: 0, scaleMultiplier: 1.0, rotOffsetX: 0, rotOffsetY: 0, rotOffsetZ: 0, modelQuat: new THREE.Quaternion(), modelQuat: new THREE.Quaternion(),
              basePosition: { x: tf.position.x, y: tf.position.y },
              baseScale: tf.scale,
              baseAngles: { pitch: angles.pitch, yaw: angles.yaw, roll: angles.roll },
              modelId,
            };
            scene.add(mesh);
            maskEntries.push(entry);
          }
          statusEl.textContent = `${results.multiFaceLandmarks.length}人の顔を検出しました`;
        } else {
          statusEl.textContent = "顔が検出されませんでした";
        }
        renderMaskList();
        resolve();
      });
      faceMesh.send({ image: preview }).catch(reject);
    });
  }

  // --- 手動マスク追加 ---
  addMaskBtn.addEventListener("click", async () => {
    const mesh = await loadMeshForModel("", maskEntries.length);
    const entry: MaskEntry = {
      id: nextMaskId++,
      label: `マスク ${nextMaskId - 1}`,
      mesh, offsetX: 0, offsetY: 0, scaleMultiplier: 1.0, rotOffsetX: 0, rotOffsetY: 0, rotOffsetZ: 0, modelQuat: new THREE.Quaternion(),
      basePosition: { x: preview.naturalWidth / 2, y: preview.naturalHeight / 2 },
      baseScale: Math.min(preview.naturalWidth, preview.naturalHeight) * 0.25,
      baseAngles: { pitch: 0, yaw: 0, roll: 0 },
      modelId: "",
    };
    scene.add(mesh);
    maskEntries.push(entry);
    selectedMaskId = entry.id;
    renderMaskList();
    statusEl.textContent = "マスクを追加しました。ドラッグで移動できます。";
  });

  // --- モデル/画像ロード ---
  async function loadMeshForModel(modelId: string, index = 0): Promise<THREE.Object3D> {
    if (!modelId) return createDefaultBox((index * 60 + 220) % 360);

    if (modelCache.has(modelId)) return modelCache.get(modelId)!.clone();

    if (!useElectron) return createDefaultBox((index * 60 + 220) % 360);

    const model = await window.electronAPI!.getModel(modelId);
    if (!model) return createDefaultBox();

    if (model.type === "image") {
      return await loadImagePlane(model);
    }

    const rawBuffer = await window.electronAPI!.readModelFile(model.storedPath);
    if (!rawBuffer) return createDefaultBox();
    // Uint8ArrayからArrayBufferに変換（GLTFLoaderに必要）
    const buffer = rawBuffer instanceof Uint8Array ? rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength) : rawBuffer;

    return new Promise((resolve) => {
      gltfLoader.parse(buffer, "", (gltf) => {
        const obj = gltf.scene;
        // バウンディングボックスで正規化＆中央寄せ
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        // ラッパーGroupで中心をオフセット
        const wrapper = new THREE.Group();
        if (maxDim > 0) obj.scale.multiplyScalar(1 / maxDim);
        // センタリング: スケール後の中心を原点へ
        obj.position.set(
          -center.x / maxDim,
          -center.y / maxDim,
          -center.z / maxDim
        );
        wrapper.add(obj);
        modelCache.set(modelId, wrapper.clone());
        resolve(wrapper);
      }, () => resolve(createDefaultBox()));
    });
  }

  async function loadImagePlane(model: StoredModel): Promise<THREE.Object3D> {
    const rawBuffer = await window.electronAPI!.readModelFile(model.storedPath);
    if (!rawBuffer) return createDefaultBox();

    const blob = new Blob([rawBuffer]);
    const url = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, (texture) => {
        URL.revokeObjectURL(url);
        const aspect = texture.image.width / texture.image.height;
        const geo = new THREE.PlaneGeometry(aspect, 1);
        const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        modelCache.set(model.id, mesh.clone());
        resolve(mesh);
      }, undefined, () => {
        URL.revokeObjectURL(url);
        resolve(createDefaultBox());
      });
    });
  }

  // --- マスクリストUI ---
  function renderMaskList() {
    maskListEl.innerHTML = "";
    for (const entry of maskEntries) {
      const div = document.createElement("div");
      div.className = `mask-item ${entry.id === selectedMaskId ? "selected" : ""}`;
      div.innerHTML = `
        <div class="mask-info">
          <span>${entry.label}</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <select data-mask-id="${entry.id}" style="width:80px;padding:2px;font-size:10px;background:#1a1a2e;color:#eee;border:1px solid #333;border-radius:3px;">
            <option value="" ${entry.modelId === "" ? "selected" : ""}>デフォルト</option>
            ${models.map((m) => `<option value="${m.id}" ${entry.modelId === m.id ? "selected" : ""}>${m.name}${m.type === "image" ? " [画像]" : ""}</option>`).join("")}
          </select>
          <button class="small danger" data-del-id="${entry.id}">×</button>
        </div>
      `;
      div.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "SELECT" || (e.target as HTMLElement).tagName === "OPTION") return;
        selectedMaskId = entry.id;
        renderMaskList();
      });
      maskListEl.appendChild(div);
    }

    maskListEl.querySelectorAll("button[data-del-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt((e.target as HTMLElement).dataset.delId!);
        const idx = maskEntries.findIndex((m) => m.id === id);
        if (idx >= 0) {
          scene.remove(maskEntries[idx].mesh);
          maskEntries.splice(idx, 1);
          if (selectedMaskId === id) selectedMaskId = null;
          renderMaskList();
        }
      });
    });

    maskListEl.querySelectorAll("select[data-mask-id]").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        e.stopPropagation();
        const el = e.target as HTMLSelectElement;
        const id = parseInt(el.dataset.maskId!);
        const entry = maskEntries.find((m) => m.id === id);
        if (entry) {
          scene.remove(entry.mesh);
          entry.modelId = el.value;
          entry.mesh = await loadMeshForModel(el.value);
          scene.add(entry.mesh);
        }
      });
    });
  }

  // --- モデル管理UI ---
  function renderModelList() {
    modelListEl.innerHTML = "";
    for (const model of models) {
      const typeLabel = model.type === "image" ? "[画像]" : "[3D]";
      const div = document.createElement("div");
      div.className = "model-item";
      div.innerHTML = `
        <span>${typeLabel} ${model.name}</span>
        <button class="small danger" data-model-id="${model.id}">×</button>
      `;
      modelListEl.appendChild(div);
    }
    modelListEl.querySelectorAll("button[data-model-id]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = (e.target as HTMLElement).dataset.modelId!;
        if (useElectron) await window.electronAPI!.deleteModel(id);
        await loadModels();
        renderModelList();
        updateModelSelects();
      });
    });
  }

  function updateModelSelects() {
    const val = personModelSelect.value;
    personModelSelect.innerHTML = `<option value="">デフォルト</option>`;
    for (const m of models) {
      const label = m.type === "image" ? `${m.name} [画像]` : m.name;
      personModelSelect.innerHTML += `<option value="${m.id}">${label}</option>`;
    }
    personModelSelect.value = val;
    renderMaskList();
  }

  importModelBtn.addEventListener("click", async () => {
    if (!useElectron) { statusEl.textContent = "Electron版でのみ利用可能"; return; }
    const model = await window.electronAPI!.importModel();
    if (model) { await loadModels(); renderModelList(); updateModelSelects(); statusEl.textContent = `${model.name} をインポートしました`; }
  });

  importImageBtn.addEventListener("click", async () => {
    if (!useElectron) { statusEl.textContent = "Electron版でのみ利用可能"; return; }
    const model = await window.electronAPI!.importImage();
    if (model) { await loadModels(); renderModelList(); updateModelSelects(); statusEl.textContent = `${model.name} [画像] をインポートしました`; }
  });

  renderModelList();
  updateModelSelects();

  // --- 人物登録UI ---
  function renderRegistryList() {
    registryListEl.innerHTML = "";
    for (const person of registry) {
      const modelName = models.find((m) => m.id === person.modelUrl)?.name || "デフォルト";
      const div = document.createElement("div");
      div.className = "registry-item";
      div.innerHTML = `<span>${person.name} <small style="color:#888">[${modelName}]</small></span><button class="small danger" data-pid="${person.id}">×</button>`;
      registryListEl.appendChild(div);
    }
    registryListEl.querySelectorAll("button[data-pid]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = (e.target as HTMLElement).dataset.pid!;
        if (useElectron) await window.electronAPI!.deletePerson(id);
        registry = registry.filter((p) => p.id !== id);
        if (!useElectron) localStorage.setItem("face3d_registry", JSON.stringify(registry));
        renderRegistryList();
      });
    });
  }
  renderRegistryList();

  registerBtn.addEventListener("click", async () => {
    const name = personNameInput.value.trim();
    if (!name) { statusEl.textContent = "名前を入力してください"; return; }
    if (lastLandmarks.length === 0) { statusEl.textContent = "まず顔検出を行ってください"; return; }
    const desc = landmarksToDescriptor(lastLandmarks[0]);
    const modelId = personModelSelect.value;
    if (useElectron) { await window.electronAPI!.addPerson(name, modelId, [desc]); await loadRegistry(); }
    else { registry.push({ id: crypto.randomUUID(), name, modelUrl: modelId, descriptors: [desc] }); localStorage.setItem("face3d_registry", JSON.stringify(registry)); }
    renderRegistryList();
    personNameInput.value = "";
    statusEl.textContent = `${name} を登録しました`;
  });

  // --- 保存 ---
  saveBtn.addEventListener("click", async () => {
    // フル解像度でレンダリング
    const w = preview.naturalWidth, h = preview.naturalHeight;
    const saveRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    saveRenderer.setClearColor(0x000000, 0);
    saveRenderer.setSize(w, h);

    const saveCam = new THREE.OrthographicCamera(0, w, 0, h, 0.1, 1000);
    saveCam.position.z = 500;

    // メッシュ位置をフル解像度座標に変換
    for (const entry of maskEntries) {
      const px = entry.basePosition.x + entry.offsetX * (preview.naturalWidth / preview.getBoundingClientRect().width);
      const py = entry.basePosition.y + entry.offsetY * (preview.naturalHeight / preview.getBoundingClientRect().height);
      const s = entry.baseScale * entry.scaleMultiplier;
      entry.mesh.position.set(px, py, 0);
      entry.mesh.scale.set(s, s, s);
      const saveBaseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        entry.baseAngles.pitch + entry.rotOffsetX,
        -(entry.baseAngles.yaw) + entry.rotOffsetY,
        -(entry.baseAngles.roll) + entry.rotOffsetZ
      ));
      entry.mesh.quaternion.copy(saveBaseQ.multiply(entry.modelQuat));
    }
    saveRenderer.render(scene, saveCam);

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = w;
    compositeCanvas.height = h;
    const cctx = compositeCanvas.getContext("2d")!;
    cctx.drawImage(preview, 0, 0);
    cctx.drawImage(saveRenderer.domElement, 0, 0);

    saveRenderer.dispose();

    const dataUrl = compositeCanvas.toDataURL("image/png");
    const baseName = currentFileName.replace(/\.[^.]+$/, "");
    const saveName = `${baseName}.png`;

    if (useElectron) {
      const path = await window.electronAPI!.saveFile(saveName, dataUrl);
      if (path) statusEl.textContent = `保存しました: ${path}`;
    } else {
      const link = document.createElement("a");
      link.download = saveName;
      link.href = dataUrl;
      link.click();
      statusEl.textContent = `${saveName} をダウンロードしました`;
    }
  });
}

main();

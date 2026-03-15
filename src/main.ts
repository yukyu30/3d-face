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
      readModelFile: (storedPath: string) => Promise<ArrayBuffer | null>;
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
  rotOffsetX: number; // pitch (上下)
  rotOffsetY: number; // yaw (左右)
  rotOffsetZ: number; // roll (傾き)
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
      entry.mesh.rotation.set(
        entry.baseAngles.pitch + entry.rotOffsetX,
        -(entry.baseAngles.yaw) + entry.rotOffsetY,
        -(entry.baseAngles.roll) + entry.rotOffsetZ
      );
    }

    renderer.render(scene, camera);

    // Three.js結果を2Dキャンバスの画像位置に描画
    ctx.drawImage(renderer.domElement, ox, oy);

    // 選択マスクのハイライト
    if (selectedMaskId !== null) {
      const entry = maskEntries.find((m) => m.id === selectedMaskId);
      if (entry) {
        const px = entry.basePosition.x * sx + entry.offsetX + ox;
        const py = entry.basePosition.y * sy + entry.offsetY + oy;
        const s = entry.baseScale * Math.min(sx, sy) * entry.scaleMultiplier;
        ctx.strokeStyle = "#e94560";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(px - s * 0.6, py - s * 0.75, s * 1.2, s * 1.5);
        ctx.setLineDash([]);
      }
    }

    requestAnimationFrame(render);
  }
  render();

  // --- ドラッグ操作 ---
  type DragMode = "none" | "move" | "rotateXY" | "rotateZ";
  let isDragging = false;
  let dragMode: DragMode = "none";
  let dragStartX = 0, dragStartY = 0;
  let dragStartOffsetX = 0, dragStartOffsetY = 0;
  let dragStartRotX = 0, dragStartRotY = 0, dragStartRotZ = 0;

  function findMaskAtPoint(px: number, py: number): MaskEntry | null {
    const img = preview;
    const rect = img.getBoundingClientRect();
    const parent = img.parentElement!.getBoundingClientRect();
    const ox = rect.left - parent.left;
    const oy = rect.top - parent.top;
    const sx = rect.width / img.naturalWidth;
    const sy = rect.height / img.naturalHeight;

    // 逆順（最前面から）チェック
    for (let i = maskEntries.length - 1; i >= 0; i--) {
      const entry = maskEntries[i];
      const mx = entry.basePosition.x * sx + entry.offsetX + ox;
      const my = entry.basePosition.y * sy + entry.offsetY + oy;
      const s = entry.baseScale * Math.min(sx, sy) * entry.scaleMultiplier;
      const halfW = s * 0.6, halfH = s * 0.75;
      if (px >= mx - halfW && px <= mx + halfW && py >= my - halfH && py <= my + halfH) {
        return entry;
      }
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const hit = findMaskAtPoint(px, py);
    if (hit) {
      selectedMaskId = hit.id;
      isDragging = true;
      dragStartX = px;
      dragStartY = py;
      dragStartOffsetX = hit.offsetX;
      dragStartOffsetY = hit.offsetY;
      dragStartRotX = hit.rotOffsetX;
      dragStartRotY = hit.rotOffsetY;
      dragStartRotZ = hit.rotOffsetZ;

      if (e.altKey || e.metaKey) {
        dragMode = "rotateZ";
        canvas.style.cursor = "alias";
      } else if (e.shiftKey) {
        dragMode = "rotateXY";
        canvas.style.cursor = "crosshair";
      } else {
        dragMode = "move";
        canvas.style.cursor = "grabbing";
      }
    } else {
      selectedMaskId = null;
      dragMode = "none";
    }
    renderMaskList();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDragging || selectedMaskId === null) {
      const rect = canvas.getBoundingClientRect();
      const hit = findMaskAtPoint(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = hit ? "grab" : "default";
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dx = px - dragStartX;
    const dy = py - dragStartY;
    const entry = maskEntries.find((m) => m.id === selectedMaskId);
    if (!entry) return;

    switch (dragMode) {
      case "move":
        entry.offsetX = dragStartOffsetX + dx;
        entry.offsetY = dragStartOffsetY + dy;
        break;
      case "rotateXY":
        // 横方向 → Y軸回転、縦方向 → X軸回転
        entry.rotOffsetY = dragStartRotY + dx * 0.01;
        entry.rotOffsetX = dragStartRotX + dy * 0.01;
        break;
      case "rotateZ":
        // 横方向 → Z軸回転
        entry.rotOffsetZ = dragStartRotZ + dx * 0.01;
        break;
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

  // スクロールで拡縮
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

  function handleFile(file: File) {
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
        statusEl.textContent = "";
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
              mesh, offsetX: 0, offsetY: 0, scaleMultiplier: 1.0, rotOffsetX: 0, rotOffsetY: 0, rotOffsetZ: 0,
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
      mesh, offsetX: 0, offsetY: 0, scaleMultiplier: 1.0, rotOffsetX: 0, rotOffsetY: 0, rotOffsetZ: 0,
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

    const buffer = await window.electronAPI!.readModelFile(model.storedPath);
    if (!buffer) return createDefaultBox();

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
    const buffer = await window.electronAPI!.readModelFile(model.storedPath);
    if (!buffer) return createDefaultBox();

    const blob = new Blob([buffer]);
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
      entry.mesh.rotation.set(
        entry.baseAngles.pitch + entry.rotOffsetX,
        -(entry.baseAngles.yaw) + entry.rotOffsetY,
        -(entry.baseAngles.roll) + entry.rotOffsetZ
      );
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

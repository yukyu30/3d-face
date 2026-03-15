import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { calculateFaceAngles, Point3D } from "./faceAngle";
import { calculateFaceTransform } from "./faceTransform";
import { RegisteredPerson, findMatchingPerson, FaceDescriptor } from "./faceRegistry";
import type { StoredModel } from "./db";

// MediaPipe ランドマークインデックス
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;

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
      deleteModel: (id: string) => Promise<void>;
      readModelFile: (storedPath: string) => Promise<ArrayBuffer | null>;
      saveFile: (defaultName: string, dataUrl: string) => Promise<string | null>;
    };
    FaceMesh: any;
  }
}

// --- マスクエントリ（UI上の各マスク） ---
interface MaskEntry {
  id: number;
  label: string;
  mesh: THREE.Object3D;
  // ユーザー調整値
  offsetX: number;
  offsetY: number;
  scaleMultiplier: number;
  rotationOffsetY: number;
  // 検出情報
  detectedPosition: { x: number; y: number } | null;
  detectedScale: number;
  detectedAngles: { pitch: number; yaw: number; roll: number };
  modelId: string; // "" = デフォルトボックス
}

function landmarksToDescriptor(landmarks: { x: number; y: number; z: number }[]): FaceDescriptor {
  const keyIndices = [1, 10, 33, 61, 133, 152, 199, 263, 291, 362];
  const embedding: number[] = [];
  for (let i = 0; i < keyIndices.length; i++) {
    for (let j = i + 1; j < keyIndices.length; j++) {
      const a = landmarks[keyIndices[i]];
      const b = landmarks[keyIndices[j]];
      embedding.push(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2));
    }
  }
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) embedding.forEach((_, i, arr) => (arr[i] /= norm));
  return { embedding };
}

function createDefaultBox(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1.3, 0.6);
  const mat = new THREE.MeshPhongMaterial({ color: 0x4488ff, opacity: 0.85, transparent: true });
  return new THREE.Mesh(geo, mat);
}

async function main() {
  // DOM
  const dropZone = document.getElementById("dropZone")!;
  const fileInput = document.getElementById("fileInput") as HTMLInputElement;
  const preview = document.getElementById("preview") as HTMLImageElement;
  const threeCanvas = document.getElementById("threeCanvas") as HTMLCanvasElement;
  const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
  const addMaskBtn = document.getElementById("addMaskBtn") as HTMLButtonElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const importModelBtn = document.getElementById("importModelBtn") as HTMLButtonElement;
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

  // --- Three.js ---
  const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 1000);
  camera.position.z = 500;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(0, -200, 500);
  scene.add(dirLight);

  const gltfLoader = new GLTFLoader();
  const loadedModelCache = new Map<string, THREE.Object3D>();

  // --- Data loading ---
  async function loadRegistry() {
    if (useElectron) registry = await window.electronAPI!.getAllPersons();
    else {
      const d = localStorage.getItem("face3d_registry");
      registry = d ? JSON.parse(d) : [];
    }
  }
  async function loadModels() {
    if (useElectron) models = await window.electronAPI!.getAllModels();
    else models = [];
  }
  await loadRegistry();
  await loadModels();

  // --- Render loop ---
  function renderLoop() {
    if (imageLoaded) {
      updateMaskMeshes();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  function syncCanvasSize() {
    const img = preview;
    if (!img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height);
    threeCanvas.style.left = `${rect.left - img.parentElement!.getBoundingClientRect().left}px`;
    threeCanvas.style.top = `${rect.top - img.parentElement!.getBoundingClientRect().top}px`;
    camera.right = rect.width;
    camera.bottom = rect.height;
    camera.updateProjectionMatrix();
  }

  function updateMaskMeshes() {
    const img = preview;
    if (!img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    for (const entry of maskEntries) {
      if (!entry.detectedPosition) continue;
      const px = entry.detectedPosition.x * scaleX + entry.offsetX;
      const py = entry.detectedPosition.y * scaleY + entry.offsetY;
      const s = entry.detectedScale * Math.min(scaleX, scaleY) * entry.scaleMultiplier;

      entry.mesh.position.set(px, py, 0);
      entry.mesh.scale.set(s, s, s);
      entry.mesh.rotation.set(
        entry.detectedAngles.pitch,
        -(entry.detectedAngles.yaw + entry.rotationOffsetY),
        -entry.detectedAngles.roll
      );
    }
  }

  // --- File handling ---
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
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
        syncCanvasSize();
        statusEl.textContent = "";
      };
    };
    reader.readAsDataURL(file);
  }

  window.addEventListener("resize", () => { if (imageLoaded) syncCanvasSize(); });

  // --- Face detection ---
  detectBtn.addEventListener("click", async () => {
    detectBtn.disabled = true;
    detectBtn.textContent = "検出中...";
    statusEl.textContent = "顔を検出しています...";

    try {
      await detectFaces();
    } catch (err) {
      console.error(err);
      statusEl.textContent = "顔検出に失敗しました";
    } finally {
      detectBtn.disabled = false;
      detectBtn.textContent = "顔検出";
    }
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
        // 既存の自動検出マスクを削除
        clearAutoMasks();
        lastLandmarks = [];

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const w = preview.naturalWidth;
          const h = preview.naturalHeight;

          for (let i = 0; i < results.multiFaceLandmarks.length; i++) {
            const landmarks = results.multiFaceLandmarks[i];
            lastLandmarks.push(landmarks);

            const noseTip: Point3D = landmarks[NOSE_TIP];
            const forehead: Point3D = landmarks[FOREHEAD];
            const chin: Point3D = landmarks[CHIN];
            const leftEye: Point3D = landmarks[LEFT_EYE];
            const rightEye: Point3D = landmarks[RIGHT_EYE];
            const angles = calculateFaceAngles(noseTip, forehead, chin, leftEye, rightEye);
            const allPoints: Point3D[] = landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z }));
            const transform = calculateFaceTransform(allPoints, w, h, angles);

            // 人物識別してモデル選択
            const descriptor = landmarksToDescriptor(landmarks);
            const person = findMatchingPerson(descriptor, registry);
            const modelId = person?.modelUrl || "";

            const mesh = await loadMeshForModel(modelId);
            const entry: MaskEntry = {
              id: nextMaskId++,
              label: person ? person.name : `顔 ${i + 1}`,
              mesh,
              offsetX: 0,
              offsetY: 0,
              scaleMultiplier: 1.0,
              rotationOffsetY: 0,
              detectedPosition: { x: transform.position.x, y: transform.position.y },
              detectedScale: transform.scale,
              detectedAngles: { pitch: angles.pitch, yaw: angles.yaw, roll: angles.roll },
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
        syncCanvasSize();
        resolve();
      });
      faceMesh.send({ image: preview }).catch(reject);
    });
  }

  function clearAutoMasks() {
    for (const entry of maskEntries) {
      scene.remove(entry.mesh);
    }
    maskEntries = [];
  }

  // --- 手動マスク追加 ---
  addMaskBtn.addEventListener("click", async () => {
    const img = preview;
    const mesh = await loadMeshForModel("");
    const entry: MaskEntry = {
      id: nextMaskId++,
      label: `手動マスク ${nextMaskId - 1}`,
      mesh,
      offsetX: 0,
      offsetY: 0,
      scaleMultiplier: 1.0,
      rotationOffsetY: 0,
      detectedPosition: { x: img.naturalWidth / 2, y: img.naturalHeight / 2 },
      detectedScale: Math.min(img.naturalWidth, img.naturalHeight) * 0.3,
      detectedAngles: { pitch: 0, yaw: 0, roll: 0 },
      modelId: "",
    };
    scene.add(mesh);
    maskEntries.push(entry);
    renderMaskList();
    statusEl.textContent = "手動マスクを追加しました。スライダーで位置を調整してください。";
  });

  // --- モデル読み込み ---
  async function loadMeshForModel(modelId: string): Promise<THREE.Object3D> {
    if (!modelId) return createDefaultBox();

    if (loadedModelCache.has(modelId)) {
      return loadedModelCache.get(modelId)!.clone();
    }

    if (useElectron) {
      const model = await window.electronAPI!.getModel(modelId);
      if (!model) return createDefaultBox();

      const buffer = await window.electronAPI!.readModelFile(model.storedPath);
      if (!buffer) return createDefaultBox();

      return new Promise((resolve) => {
        gltfLoader.parse(buffer, "", (gltf) => {
          const obj = gltf.scene;
          // モデルをバウンディングボックスで正規化
          const box = new THREE.Box3().setFromObject(obj);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) obj.scale.multiplyScalar(1 / maxDim);
          const center = box.getCenter(new THREE.Vector3());
          obj.position.sub(center.multiplyScalar(1 / maxDim));
          loadedModelCache.set(modelId, obj.clone());
          resolve(obj);
        }, () => {
          resolve(createDefaultBox());
        });
      });
    }
    return createDefaultBox();
  }

  // --- Mask list UI ---
  function renderMaskList() {
    maskListEl.innerHTML = "";
    for (const entry of maskEntries) {
      const div = document.createElement("div");
      div.className = "mask-item";
      div.innerHTML = `
        <div class="mask-header">
          <span>${entry.label}</span>
          <button class="small danger" data-mask-id="${entry.id}">削除</button>
        </div>
        <div class="slider-row"><label>X</label><input type="range" min="-300" max="300" value="${entry.offsetX}" data-mask-id="${entry.id}" data-prop="offsetX" /><span>${entry.offsetX}</span></div>
        <div class="slider-row"><label>Y</label><input type="range" min="-300" max="300" value="${entry.offsetY}" data-mask-id="${entry.id}" data-prop="offsetY" /><span>${entry.offsetY}</span></div>
        <div class="slider-row"><label>大</label><input type="range" min="0.1" max="3" step="0.05" value="${entry.scaleMultiplier}" data-mask-id="${entry.id}" data-prop="scaleMultiplier" /><span>${entry.scaleMultiplier.toFixed(2)}</span></div>
        <div class="slider-row"><label>回</label><input type="range" min="-3.14" max="3.14" step="0.05" value="${entry.rotationOffsetY}" data-mask-id="${entry.id}" data-prop="rotationOffsetY" /><span>${entry.rotationOffsetY.toFixed(2)}</span></div>
        <div class="slider-row">
          <label>型</label>
          <select data-mask-id="${entry.id}" data-prop="modelId" style="flex:1;padding:3px;font-size:11px;background:#16213e;color:#eee;border:1px solid #333;border-radius:3px;">
            <option value="" ${entry.modelId === "" ? "selected" : ""}>デフォルト</option>
            ${models.map((m) => `<option value="${m.id}" ${entry.modelId === m.id ? "selected" : ""}>${m.name}</option>`).join("")}
          </select>
        </div>
      `;
      maskListEl.appendChild(div);
    }

    // イベント
    maskListEl.querySelectorAll("button.danger").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = parseInt((e.target as HTMLElement).dataset.maskId!);
        removeMask(id);
      });
    });
    maskListEl.querySelectorAll("input[type=range]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const el = e.target as HTMLInputElement;
        const id = parseInt(el.dataset.maskId!);
        const prop = el.dataset.prop as keyof MaskEntry;
        const entry = maskEntries.find((m) => m.id === id);
        if (entry) {
          (entry as any)[prop] = parseFloat(el.value);
          el.nextElementSibling!.textContent = prop === "scaleMultiplier" || prop === "rotationOffsetY"
            ? parseFloat(el.value).toFixed(2)
            : el.value;
        }
      });
    });
    maskListEl.querySelectorAll("select[data-prop=modelId]").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
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

  function removeMask(id: number) {
    const idx = maskEntries.findIndex((m) => m.id === id);
    if (idx >= 0) {
      scene.remove(maskEntries[idx].mesh);
      maskEntries.splice(idx, 1);
      renderMaskList();
    }
  }

  // --- Model management UI ---
  function renderModelList() {
    modelListEl.innerHTML = "";
    for (const model of models) {
      const div = document.createElement("div");
      div.className = "model-item";
      div.innerHTML = `
        <span>${model.name} <small style="color:#888">(${model.originalName})</small></span>
        <button class="small danger" data-model-id="${model.id}">削除</button>
      `;
      modelListEl.appendChild(div);
    }
    modelListEl.querySelectorAll("button.danger").forEach((btn) => {
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
    // personModelSelect更新
    const currentVal = personModelSelect.value;
    personModelSelect.innerHTML = `<option value="">デフォルト（ボックス）</option>`;
    for (const m of models) {
      personModelSelect.innerHTML += `<option value="${m.id}">${m.name}</option>`;
    }
    personModelSelect.value = currentVal;
    // マスクリスト内のselectも更新
    renderMaskList();
  }

  importModelBtn.addEventListener("click", async () => {
    if (!useElectron) {
      statusEl.textContent = "モデルインポートはElectron版でのみ利用可能です";
      return;
    }
    const model = await window.electronAPI!.importModel();
    if (model) {
      await loadModels();
      renderModelList();
      updateModelSelects();
      statusEl.textContent = `${model.name} をインポートしました`;
    }
  });

  renderModelList();
  updateModelSelects();

  // --- Registry UI ---
  function renderRegistryList() {
    registryListEl.innerHTML = "";
    for (const person of registry) {
      const modelName = models.find((m) => m.id === person.modelUrl)?.name || "デフォルト";
      const div = document.createElement("div");
      div.className = "registry-item";
      div.innerHTML = `
        <span>${person.name} <small style="color:#888">[${modelName}]</small></span>
        <button class="small danger" data-person-id="${person.id}">削除</button>
      `;
      registryListEl.appendChild(div);
    }
    registryListEl.querySelectorAll("button.danger").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = (e.target as HTMLElement).dataset.personId!;
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

    const descriptor = landmarksToDescriptor(lastLandmarks[0]);
    const modelId = personModelSelect.value;

    if (useElectron) {
      await window.electronAPI!.addPerson(name, modelId, [descriptor]);
      await loadRegistry();
    } else {
      registry.push({ id: crypto.randomUUID(), name, modelUrl: modelId, descriptors: [descriptor] });
      localStorage.setItem("face3d_registry", JSON.stringify(registry));
    }
    renderRegistryList();
    personNameInput.value = "";
    statusEl.textContent = `${name} を登録しました`;
  });

  // --- Save ---
  saveBtn.addEventListener("click", async () => {
    syncCanvasSize();
    updateMaskMeshes();
    renderer.render(scene, camera);

    // 合成用キャンバス
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = preview.naturalWidth;
    compositeCanvas.height = preview.naturalHeight;
    const ctx = compositeCanvas.getContext("2d")!;

    ctx.drawImage(preview, 0, 0);

    // Three.jsキャンバスをリサイズして合成
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = preview.naturalWidth;
    tmpCanvas.height = preview.naturalHeight;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.drawImage(threeCanvas, 0, 0, preview.naturalWidth, preview.naturalHeight);
    ctx.drawImage(tmpCanvas, 0, 0);

    const dataUrl = compositeCanvas.toDataURL("image/png");
    const baseName = currentFileName.replace(/\.[^.]+$/, "");
    const saveName = `${baseName}.png`;

    if (useElectron) {
      const savedPath = await window.electronAPI!.saveFile(saveName, dataUrl);
      if (savedPath) statusEl.textContent = `保存しました: ${savedPath}`;
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

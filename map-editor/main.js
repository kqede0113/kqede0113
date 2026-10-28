import * as THREE from 'three';
import { MOUSE } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { clone as cloneObject } from 'three/addons/utils/SkeletonUtils.js';

const GRID = 40;
const HALF = GRID / 2;
const STORAGE_KEY = 'map-editor-autosave-v1';
const EYE = 1.6;
const PLAYER_RADIUS = 0.28;
const PLAYER_HEIGHT = 1.75;
const HIT_EPS = 0.04;
const TARGET_SIZE = 1.6;

const $ = (id) => document.getElementById(id);

const dom = {
  palette: $('palette'),
  status: $('status'),
  hint: $('hint'),
  loading: $('loading'),
  help: $('help'),
  selection: $('selection'),
  selName: $('sel-name'),
  crosshair: $('crosshair'),
  modeBadge: $('mode-badge'),
  viewport: $('viewport'),
  btnAdd: $('btn-add'),
  addActions: $('add-actions'),
  pickFiles: $('pick-files'),
  pickFolder: $('pick-folder'),
  modelFiles: $('model-files'),
  modelFolder: $('model-folder'),
  btnSave: $('btn-save'),
  btnLoad: $('btn-load'),
  btnClear: $('btn-clear'),
  btnWalk: $('btn-walk'),
  jsonInput: $('json-input'),
  btnMove: $('btn-move'),
  btnRot: $('btn-rot'),
  btnRot90: $('btn-rot90'),
  btnDup: $('btn-dup'),
  btnDel: $('btn-del'),
  btnDeselect: $('btn-deselect'),
};

const keys = Object.create(null);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const state = {
  mode: 'edit',
  selectedPaletteId: 'box',
  selected: null,
  transformMode: 'translate',
};

const instances = [];
const localItems = new Map();
let seq = 1;
let suspendSave = false;
let saveTimer = 0;
let statusExtra = '';
let ghost = null;
let boxHelper = null;
let savedView = null;
let velocityY = 0;
let onGround = true;
let jumpArmed = false;
let lastSaveUrl = null;

const colliderBoxes = [];
const playerBox = new THREE.Box3();
// PointerLockControls logs a console error when the browser refuses the lock
// (headless runs, or a click that is not treated as a gesture). The walk loop
// still handles the keyboard, and the status line explains it.
const pointerLockError = console.error.bind(console);
console.error = (...args) => {
  const text = args.map((item) => String(item)).join(' ');
  if (text.includes('Unable to use Pointer Lock API')) return;
  pointerLockError(...args);
};

const labelCache = new Map();

function uid() {
  seq += 1;
  return `obj-${Date.now().toString(36)}-${seq}`;
}

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 });
}

function sitBox(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, h / 2, 0);
  return geometry;
}

const materials = {
  box: mat(0x3d7eff),
  cylinder: mat(0xf08a24),
  sphere: mat(0xe6457a),
  trunk: mat(0x8a5a32),
  leaves: mat(0x2e9d4a),
  wall: mat(0xe6d3b0),
  ramp: mat(0x7a5cff),
  pillar: mat(0xb7c0cc),
  plate: mat(0x1aa6a6),
  missing: new THREE.MeshStandardMaterial({
    color: 0xff8a3d,
    roughness: 0.55,
    transparent: true,
    opacity: 0.9,
  }),
};
materials.ramp.side = THREE.DoubleSide;

const geometries = {
  box: sitBox(0.86, 0.86, 0.86),
  cylinder: new THREE.CylinderGeometry(0.38, 0.38, 0.9, 20),
  sphere: new THREE.SphereGeometry(0.42, 24, 16),
  trunk: new THREE.CylinderGeometry(0.12, 0.16, 0.48, 8),
  leaves: new THREE.ConeGeometry(0.42, 0.78, 8),
  wall: sitBox(0.92, 1.2, 0.18),
  pillar: new THREE.CylinderGeometry(0.18, 0.22, 1.55, 12),
  plate: sitBox(0.92, 0.14, 0.92),
  missing: sitBox(0.8, 0.8, 0.8),
};
geometries.cylinder.translate(0, 0.45, 0);
geometries.sphere.translate(0, 0.42, 0);
geometries.trunk.translate(0, 0.24, 0);
geometries.leaves.translate(0, 0.48 + 0.39, 0);
geometries.pillar.translate(0, 0.775, 0);

function rampGeometry() {
  const w = 0.92;
  const d = 0.92;
  const h = 0.78;
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const positions = new Float32Array([
    x0, 0, z0, x1, 0, z1, x1, 0, z0,
    x0, 0, z0, x0, 0, z1, x1, 0, z1,
    x0, 0, z0, x1, 0, z0, x1, h, z1,
    x0, 0, z0, x1, h, z1, x0, h, z1,
    x0, 0, z1, x1, h, z1, x1, 0, z1,
    x0, 0, z1, x0, h, z1, x1, h, z1,
    x0, 0, z0, x0, h, z1, x0, 0, z1,
    x1, 0, z0, x1, 0, z1, x1, h, z1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
geometries.ramp = rampGeometry();

function paint(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function groupOf(...meshes) {
  const group = new THREE.Group();
  for (const mesh of meshes) group.add(paint(mesh));
  return group;
}

const builtins = [
  { id: 'box', name: '箱', color: '#3d7eff', create: () => groupOf(new THREE.Mesh(geometries.box, materials.box)) },
  { id: 'cylinder', name: '円柱', color: '#f08a24', create: () => groupOf(new THREE.Mesh(geometries.cylinder, materials.cylinder)) },
  { id: 'sphere', name: '球', color: '#e6457a', create: () => groupOf(new THREE.Mesh(geometries.sphere, materials.sphere)) },
  {
    id: 'tree',
    name: '木',
    color: '#2e9d4a',
    create: () => groupOf(
      new THREE.Mesh(geometries.trunk, materials.trunk),
      new THREE.Mesh(geometries.leaves, materials.leaves),
    ),
  },
  { id: 'wall', name: '壁', color: '#e6d3b0', create: () => groupOf(new THREE.Mesh(geometries.wall, materials.wall)) },
  { id: 'ramp', name: '坂', color: '#7a5cff', create: () => groupOf(new THREE.Mesh(geometries.ramp, materials.ramp)) },
  { id: 'pillar', name: '柱', color: '#b7c0cc', create: () => groupOf(new THREE.Mesh(geometries.pillar, materials.pillar)) },
  { id: 'plate', name: '板', color: '#1aa6a6', create: () => groupOf(new THREE.Mesh(geometries.plate, materials.plate)) },
];

function allItems() {
  return [...builtins, ...localItems.values()];
}

function getItem(id) {
  return builtins.find((item) => item.id === id) || localItems.get(id) || null;
}

function paletteName(id) {
  const item = getItem(id);
  return item ? item.name : '';
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(dom.viewport.clientWidth, dom.viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
dom.viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7dcff);

const camera = new THREE.PerspectiveCamera(55, 1, 0.08, 300);
camera.position.set(15, 11, 15);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI / 2 - 0.03;
orbit.minPolarAngle = 0.08;
orbit.minDistance = 2;
orbit.maxDistance = 70;
orbit.mouseButtons.LEFT = -1;
orbit.mouseButtons.RIGHT = MOUSE.ROTATE;
orbit.mouseButtons.MIDDLE = MOUSE.DOLLY;

const pointerLock = new PointerLockControls(camera, renderer.domElement);

const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(0.85);
scene.add(transform.getHelper());
transform.detach();
transform.addEventListener('dragging-changed', (event) => {
  orbit.enabled = !event.value && state.mode === 'edit';
});
transform.addEventListener('objectChange', () => {
  const object = transform.object;
  if (object && transform.mode === 'translate') {
    const cell = snapCell(object.position.x, object.position.z);
    object.position.x = cell.x;
    object.position.z = cell.z;
    object.position.y = Math.max(0, object.position.y);
  }
  if (boxHelper) boxHelper.update();
  autosave();
});
transform.addEventListener('mouseUp', () => writeAutosave());

scene.add(new THREE.HemisphereLight(0xd7ecff, 0x8a9178, 0.55));
scene.add(new THREE.AmbientLight(0xffffff, 0.38));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(18, 28, 12);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 80;
keyLight.shadow.camera.left = -26;
keyLight.shadow.camera.right = 26;
keyLight.shadow.camera.top = 26;
keyLight.shadow.camera.bottom = -26;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);
const fill = new THREE.DirectionalLight(0xd6e6ff, 0.4);
fill.position.set(-14, 10, -8);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID, GRID),
  new THREE.MeshStandardMaterial({ color: 0xe4e9f2, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = 'ground';
scene.add(ground);

const skirt = new THREE.Mesh(
  new THREE.BoxGeometry(GRID, 0.45, GRID),
  new THREE.MeshStandardMaterial({ color: 0xc5cedc, roughness: 1 }),
);
skirt.position.y = -0.226;
skirt.receiveShadow = true;
scene.add(skirt);

const grid = new THREE.GridHelper(GRID, GRID, 0x66748d, 0xb4bdcc);
grid.position.y = 0.012;
grid.material.transparent = true;
grid.material.opacity = 0.9;
scene.add(grid);

const placedGroup = new THREE.Group();
placedGroup.name = 'placed';
scene.add(placedGroup);

function resize() {
  const width = dom.viewport.clientWidth || 1;
  const height = dom.viewport.clientHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener('resize', resize);
resize();
orbit.update();

function snapCell(x, z) {
  const min = -HALF + 0.5;
  const max = HALF - 0.5;
  return {
    x: THREE.MathUtils.clamp(Math.floor(x) + 0.5, min, max),
    z: THREE.MathUtils.clamp(Math.floor(z) + 0.5, min, max),
  };
}

function num3(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return fallback.slice();
  return [0, 1, 2].map((index) => {
    const number = Number(value[index]);
    return Number.isFinite(number) ? number : fallback[index];
  });
}

function normalizeRecord(raw) {
  const source = raw || {};
  const paletteId = String(source.paletteId || source.type || 'box');
  let fileName = source.fileName ? String(source.fileName) : null;
  if (!fileName && paletteId.startsWith('local:')) fileName = paletteId.slice('local:'.length);
  const name = String(source.name || fileName || paletteName(paletteId) || paletteId);
  const position = num3(source.position, [0.5, 0, 0.5]);
  const rotation = num3(source.rotation, [0, 0, 0]);
  const scale = num3(source.scale, [1, 1, 1]);
  const cell = snapCell(position[0], position[2]);
  position[0] = cell.x;
  position[1] = Math.max(0, position[1]);
  position[2] = cell.z;
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(scale[i]) || scale[i] === 0) scale[i] = 1;
  }
  return { paletteId, name, fileName, position, rotation, scale };
}

function makeLabel(text) {
  const shown = text.length > 22 ? `${text.slice(0, 21)}…` : text;
  let texture = labelCache.get(shown);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(20, 16, 12, 0.78)';
    ctx.beginPath();
    ctx.roundRect(16, 28, 480, 72, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, 256, 64);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    labelCache.set(shown, texture);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = 1.15;
  sprite.raycast = () => {};
  return sprite;
}

function createMissing(name) {
  const group = new THREE.Group();
  group.add(paint(new THREE.Mesh(geometries.missing, materials.missing)));
  group.add(makeLabel(name || '未読込'));
  return group;
}

function instanceFromObject(object) {
  return instances.find((inst) => inst.object === object) || null;
}

function findRoot(object) {
  let current = object;
  while (current) {
    if (current.userData && current.userData.placedId) return current;
    current = current.parent;
  }
  return null;
}

function createObject(record) {
  const item = getItem(record.paletteId);
  if (item && item.local) return { object: cloneObject(item.template), missing: false };
  if (item && item.create) return { object: item.create(), missing: false };
  const fileName = record.fileName || (record.paletteId.startsWith('local:') ? record.paletteId.slice(6) : record.name);
  return { object: createMissing(fileName), missing: true };
}

function spawn(raw) {
  const record = normalizeRecord(raw);
  const created = createObject(record);
  const object = created.object;
  object.position.set(record.position[0], record.position[1], record.position[2]);
  object.rotation.set(record.rotation[0], record.rotation[1], record.rotation[2]);
  object.scale.set(record.scale[0], record.scale[1], record.scale[2]);
  object.userData = {
    placedId: uid(),
    paletteId: record.paletteId,
    name: record.name,
    fileName: record.fileName,
    missing: created.missing,
  };
  placedGroup.add(object);
  const inst = {
    object,
    paletteId: record.paletteId,
    name: record.name,
    fileName: record.fileName,
    missing: created.missing,
  };
  instances.push(inst);
  autosave();
  updateHint();
  return inst;
}

function readInstance(inst) {
  const object = inst.object;
  return {
    type: inst.paletteId,
    paletteId: inst.paletteId,
    name: inst.name,
    fileName: inst.fileName,
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function serialize() {
  return {
    version: 1,
    grid: GRID,
    objects: instances.map(readInstance),
  };
}

function writeAutosave() {
  if (suspendSave) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch {
    statusExtra = '自動保存に失敗しました';
    renderStatus();
  }
}

function autosave() {
  if (suspendSave) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(writeAutosave, 250);
}

function missingFileNames() {
  const names = new Set();
  for (const inst of instances) {
    if (inst.missing) names.add(inst.fileName || inst.name);
  }
  return [...names];
}

function renderStatus(extra) {
  if (extra !== undefined) statusExtra = extra || '';
  const missing = missingFileNames();
  let text = `オブジェクト ${instances.length}`;
  if (missing.length) {
    text += ` ／ 未読込: ${missing.join(', ')}（同じファイル名で追加すると置き換わります）`;
  }
  if (statusExtra) text += ` ／ ${statusExtra}`;
  dom.status.textContent = text;
}

function updateHint() {
  const show = state.mode === 'edit' && instances.length === 0;
  dom.hint.hidden = !show;
}

function renderSelection() {
  const inst = state.selected ? instanceFromObject(state.selected) : null;
  dom.selection.hidden = !inst || state.mode !== 'edit';
  if (!inst) return;
  const suffix = inst.missing ? '（未読込）' : '';
  dom.selName.textContent = `${inst.name}${suffix}`;
  dom.btnMove.classList.toggle('on', state.transformMode === 'translate');
  dom.btnRot.classList.toggle('on', state.transformMode === 'rotate');
}

function renderPalette() {
  dom.palette.replaceChildren();
  for (const item of allItems()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pal-item${item.id === state.selectedPaletteId ? ' active' : ''}`;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = item.color || '#8ea0b8';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    button.append(swatch, name);
    if (item.local) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'ローカル';
      button.append(badge);
    }
    button.addEventListener('click', () => selectPalette(item.id));
    dom.palette.append(button);
  }
}

function disposeGhost() {
  if (!ghost) return;
  scene.remove(ghost);
  ghost.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  ghost = null;
}

function rebuildGhost() {
  disposeGhost();
  const item = getItem(state.selectedPaletteId);
  if (!item || state.mode !== 'edit') return;
  ghost = item.local ? cloneObject(item.template) : item.create();
  ghost.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = list.map((material) => {
      const copy = material.clone();
      copy.transparent = true;
      copy.opacity = 0.4;
      copy.depthWrite = false;
      return copy;
    });
    object.material = Array.isArray(object.material) ? cloned : cloned[0];
    object.castShadow = false;
    object.raycast = () => {};
  });
  ghost.visible = false;
  scene.add(ghost);
}

function selectPalette(id) {
  if (!getItem(id)) return;
  state.selectedPaletteId = id;
  renderPalette();
  rebuildGhost();
}

function clearBoxHelper() {
  if (!boxHelper) return;
  scene.remove(boxHelper);
  boxHelper.geometry.dispose();
  boxHelper.material.dispose();
  boxHelper = null;
}

function select(object) {
  state.selected = object;
  transform.attach(object);
  transform.setMode(state.transformMode);
  transform.enabled = state.mode === 'edit';
  clearBoxHelper();
  boxHelper = new THREE.BoxHelper(object, 0xffcc4d);
  scene.add(boxHelper);
  renderSelection();
}

function deselect() {
  state.selected = null;
  transform.detach();
  clearBoxHelper();
  renderSelection();
}

function setTransformMode(mode) {
  state.transformMode = mode;
  transform.setMode(mode);
  renderSelection();
}

function rotate90(object = state.selected) {
  if (!object) return;
  object.rotation.y += Math.PI / 2;
  object.rotation.y = ((object.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (boxHelper) boxHelper.update();
  autosave();
}

function duplicateSelected() {
  const inst = state.selected ? instanceFromObject(state.selected) : null;
  if (!inst) return;
  const data = readInstance(inst);
  let cell = snapCell(data.position[0] + 1, data.position[2]);
  if (Math.abs(cell.x - data.position[0]) < 0.01 && Math.abs(cell.z - data.position[2]) < 0.01) {
    cell = snapCell(data.position[0], data.position[2] + 1);
  }
  const copy = spawn({
    ...data,
    position: [cell.x, data.position[1], cell.z],
  });
  select(copy.object);
  renderStatus(`${inst.name} を複製しました`);
  updateHint();
}

function deleteSelected() {
  const inst = state.selected ? instanceFromObject(state.selected) : null;
  if (!inst) return;
  const index = instances.indexOf(inst);
  if (index >= 0) instances.splice(index, 1);
  placedGroup.remove(inst.object);
  deselect();
  autosave();
  updateHint();
  renderStatus('削除しました');
}

function clearMap() {
  deselect();
  for (const inst of instances) placedGroup.remove(inst.object);
  instances.length = 0;
  autosave();
  updateHint();
  renderStatus('マップを消去しました');
}

function loadData(data) {
  if (!data || !Array.isArray(data.objects)) {
    throw new Error('不正なマップデータです');
  }
  suspendSave = true;
  deselect();
  for (const inst of instances) placedGroup.remove(inst.object);
  instances.length = 0;
  let skipped = 0;
  for (const raw of data.objects) {
    try {
      spawn(raw);
    } catch {
      skipped += 1;
    }
  }
  suspendSave = false;
  writeAutosave();
  updateHint();
  renderStatus(skipped ? `${instances.length} 件読み込み（${skipped} 件はスキップ）` : `${instances.length} 件読み込みました`);
}

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycast(event, objects) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(objects, true);
}

function handlePick(event) {
  const objectHits = raycast(event, placedGroup.children);
  const groundHits = raycast(event, [ground]);
  const objectHit = objectHits.find((hit) => findRoot(hit.object));
  const groundHit = groundHits[0];
  if (objectHit && (!groundHit || objectHit.distance <= groundHit.distance + 1e-4)) {
    const root = findRoot(objectHit.object);
    if (root) {
      select(root);
      renderStatus(`${root.userData.name || 'オブジェクト'} を選択`);
      return;
    }
  }
  if (!groundHit) return;
  const item = getItem(state.selectedPaletteId);
  if (!item) return;
  const cell = snapCell(groundHit.point.x, groundHit.point.z);
  const inst = spawn({
    paletteId: item.id,
    name: item.name,
    fileName: item.fileName || null,
    position: [cell.x, 0, cell.z],
  });
  updateHint();
  renderStatus(`${item.name} を配置しました`);
  return inst;
}

function updateGhost(event) {
  if (!ghost || state.mode !== 'edit') return;
  const hits = raycast(event, [ground]);
  if (!hits.length) {
    ghost.visible = false;
    return;
  }
  const cell = snapCell(hits[0].point.x, hits[0].point.z);
  ghost.position.set(cell.x, 0, cell.z);
  ghost.visible = true;
}

function extension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

function buildUrlMap(files) {
  const map = new Map();
  const add = (key, url) => {
    if (!key) return;
    const normalized = key.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    map.set(normalized, url);
    const parts = normalized.split('/').filter((part) => part && part !== '.');
    for (let i = 0; i < parts.length; i += 1) map.set(parts.slice(i).join('/'), url);
    try {
      map.set(decodeURIComponent(normalized), url);
    } catch {
      /* keep the raw key */
    }
  };
  for (const file of files) {
    const url = URL.createObjectURL(file);
    add(file.name, url);
    if (file.webkitRelativePath) add(file.webkitRelativePath, url);
  }
  return map;
}

function rewriteURL(url, map) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  let clean = url.split('#')[0].split('?')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep clean */
  }
  clean = clean.replace(/\\/g, '/');
  const stripped = clean.replace(/^[a-z]+:\/\/[^/]+\//i, '');
  const candidates = [clean, stripped];
  for (const candidate of candidates) {
    const parts = candidate.split('/').filter((part) => part && part !== '.');
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts.slice(i).join('/');
      if (map.has(key)) return map.get(key);
    }
  }
  return url;
}

function stripUtility(root) {
  const remove = [];
  root.traverse((object) => {
    if (object.isLight || object.isCamera) remove.push(object);
  });
  for (const object of remove) {
    if (object.parent) object.parent.remove(object);
  }
}

function normalizeImported(root, { stl }) {
  const wrapper = new THREE.Group();
  wrapper.add(root);
  if (stl) root.rotation.x = -Math.PI / 2;
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('モデルの境界が空です');
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-8) throw new Error('モデルのサイズが不正です');
  root.scale.multiplyScalar(TARGET_SIZE / maxDim);
  root.updateWorldMatrix(true, true);
  const fitted = new THREE.Box3().setFromObject(root);
  const center = fitted.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= fitted.min.y;
  wrapper.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return wrapper;
}

async function loadModelFile(file, ext, loaders) {
  const buffer = await file.arrayBuffer();
  if (ext === 'stl') {
    const geometry = loaders.stl.parse(buffer);
    const position = geometry.getAttribute('position');
    if (!position || position.count < 3) throw new Error('形状が空です');
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xd5dbe6,
      metalness: 0.08,
      roughness: 0.42,
      side: THREE.DoubleSide,
    });
    return normalizeImported(new THREE.Mesh(geometry, material), { stl: true });
  }
  const gltf = await loaders.gltf.parseAsync(buffer, '');
  const sceneRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!sceneRoot) throw new Error('シーンがありません');
  stripUtility(sceneRoot);
  return normalizeImported(sceneRoot, { stl: false });
}

function vertexCount(object) {
  let count = 0;
  object.traverse((child) => {
    if (child.isMesh && child.geometry?.getAttribute('position')) {
      count += child.geometry.getAttribute('position').count;
    }
  });
  return count;
}

function replaceInstances(fileName, template) {
  const id = `local:${fileName}`;
  let swapped = 0;
  for (const inst of [...instances]) {
    if (inst.fileName !== fileName && inst.paletteId !== id) continue;
    const data = readInstance(inst);
    const wasSelected = state.selected === inst.object;
    const placedId = inst.object.userData.placedId;
    placedGroup.remove(inst.object);
    const object = cloneObject(template);
    object.position.set(data.position[0], data.position[1], data.position[2]);
    object.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    object.scale.set(data.scale[0], data.scale[1], data.scale[2]);
    object.userData = {
      placedId,
      paletteId: id,
      name: fileName,
      fileName,
      missing: false,
    };
    placedGroup.add(object);
    inst.object = object;
    inst.missing = false;
    inst.name = fileName;
    inst.paletteId = id;
    inst.fileName = fileName;
    if (wasSelected) select(object);
    swapped += 1;
  }
  return swapped;
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return { added: [], errors: [] };
  const map = buildUrlMap(files);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => rewriteURL(url, map));
  const loaders = { gltf: new GLTFLoader(manager), stl: new STLLoader(manager) };
  const added = [];
  const errors = [];
  renderStatus('モデルを読み込み中…');
  for (const file of files) {
    const ext = extension(file.name);
    if (!['glb', 'gltf', 'stl'].includes(ext)) continue;
    try {
      const template = await loadModelFile(file, ext, loaders);
      const id = `local:${file.name}`;
      localItems.set(id, {
        id,
        name: file.name,
        fileName: file.name,
        local: true,
        color: '#9eb0c8',
        template,
      });
      replaceInstances(file.name, template);
      added.push(file.name);
    } catch (error) {
      errors.push(`${file.name}: ${error.message || error}`);
    }
  }
  if (added.length) selectPalette(`local:${added[added.length - 1]}`);
  else renderPalette();
  writeAutosave();
  let message = added.length ? `追加: ${added.join(', ')}` : '追加できるモデルがありませんでした';
  if (errors.length) message += ` ／ 失敗: ${errors.join(' / ')}`;
  renderStatus(message);
  updateHint();
  return { added, errors };
}

function downloadJSON() {
  const data = serialize();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  lastSaveUrl = url;
  const link = document.createElement('a');
  link.href = url;
  link.download = 'map.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  writeAutosave();
  renderStatus('map.json を保存しました');
}

async function onJsonChosen(file) {
  if (!file) return;
  if (instances.length > 0 && !window.confirm('現在のマップを読み込んだデータで置き換えますか？')) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    renderStatus('JSON を読み取れませんでした');
    return;
  }
  try {
    loadData(data);
  } catch (error) {
    renderStatus(error.message || '読み込みに失敗しました');
  }
}

function playerBounds() {
  const feet = camera.position.y - EYE;
  playerBox.min.set(
    camera.position.x - PLAYER_RADIUS,
    feet,
    camera.position.z - PLAYER_RADIUS,
  );
  playerBox.max.set(
    camera.position.x + PLAYER_RADIUS,
    feet + PLAYER_HEIGHT,
    camera.position.z + PLAYER_RADIUS,
  );
  return playerBox;
}

function boxesHit(a, b) {
  return (
    a.min.x < b.max.x - HIT_EPS &&
    a.max.x > b.min.x + HIT_EPS &&
    a.min.y < b.max.y - HIT_EPS &&
    a.max.y > b.min.y + HIT_EPS &&
    a.min.z < b.max.z - HIT_EPS &&
    a.max.z > b.min.z + HIT_EPS
  );
}

function rebuildColliders() {
  while (colliderBoxes.length < instances.length) colliderBoxes.push(new THREE.Box3());
  colliderBoxes.length = instances.length;
  for (let i = 0; i < instances.length; i += 1) {
    colliderBoxes[i].setFromObject(instances[i].object);
  }
}

function playerHits() {
  const box = playerBounds();
  for (let i = 0; i < colliderBoxes.length; i += 1) {
    if (boxesHit(box, colliderBoxes[i])) return true;
  }
  return false;
}

function clampPlayer() {
  const limit = HALF - 0.4;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -limit, limit);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -limit, limit);
}

function findSpawn() {
  const preferred = [
    [0.5, 12.5],
    [0.5, 8.5],
    [-5.5, 10.5],
    [6.5, 9.5],
    [0.5, 0.5],
  ];
  const tryPoint = (x, z) => {
    camera.position.set(x, EYE, z);
    return !playerHits();
  };
  for (const [x, z] of preferred) {
    if (tryPoint(x, z)) return;
  }
  for (let z = HALF - 1.5; z > -HALF; z -= 1) {
    for (let x = -HALF + 1.5; x < HALF; x += 1) {
      if (tryPoint(x, z)) return;
    }
  }
  camera.position.set(0.5, EYE, 0.5);
}

function enterWalk() {
  if (state.mode === 'walk') return;
  deselect();
  if (ghost) ghost.visible = false;
  savedView = {
    position: camera.position.clone(),
    target: orbit.target.clone(),
  };
  orbit.enabled = false;
  state.mode = 'walk';
  velocityY = 0;
  onGround = true;
  rebuildColliders();
  findSpawn();
  const lookTarget = camera.position.clone();
  lookTarget.x = 0;
  lookTarget.z = 0;
  camera.lookAt(lookTarget);
  camera.updateMatrixWorld(true);
  dom.crosshair.hidden = false;
  dom.modeBadge.hidden = false;
  dom.btnWalk.textContent = '編集に戻る';
  dom.btnWalk.classList.add('on');
  updateHint();
  renderSelection();
  renderStatus('歩行モード');
  pointerLock.lock();
}

function exitWalk() {
  if (state.mode !== 'walk') return;
  state.mode = 'edit';
  if (document.pointerLockElement) document.exitPointerLock();
  if (savedView) {
    camera.position.copy(savedView.position);
    orbit.target.copy(savedView.target);
  }
  orbit.enabled = true;
  orbit.update();
  velocityY = 0;
  for (const code of Object.keys(keys)) keys[code] = false;
  dom.crosshair.hidden = true;
  dom.modeBadge.hidden = true;
  dom.btnWalk.textContent = '歩いて見る';
  dom.btnWalk.classList.remove('on');
  updateHint();
  renderSelection();
  renderStatus('編集モード');
}

function toggleWalk() {
  if (state.mode === 'walk') exitWalk();
  else enterWalk();
}

pointerLock.addEventListener('unlock', () => {
  if (state.mode === 'walk') exitWalk();
});
document.addEventListener('pointerlockerror', () => {
  if (state.mode === 'walk') {
    renderStatus('マウス視点をロックできませんでした。WASD と Space は使えます');
  }
});

function moveAxis(apply) {
  const before = camera.position.clone();
  apply();
  clampPlayer();
  if (!playerHits()) return;
  camera.position.y = before.y + 0.35;
  clampPlayer();
  if (!playerHits()) return;
  camera.position.copy(before);
}

function updateWalk(dt) {
  rebuildColliders();
  let forward = 0;
  let right = 0;
  if (keys.KeyW) forward += 1;
  if (keys.KeyS) forward -= 1;
  if (keys.KeyA) right -= 1;
  if (keys.KeyD) right += 1;
  const length = Math.hypot(forward, right);
  if (length > 0) {
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5;
    const distance = speed * dt;
    moveAxis(() => pointerLock.moveRight((right / length) * distance));
    moveAxis(() => pointerLock.moveForward((forward / length) * distance));
  }

  if (jumpArmed && onGround) {
    velocityY = 7.2;
    onGround = false;
  }
  jumpArmed = false;

  velocityY = Math.max(-20, velocityY - 22 * dt);
  const previousY = camera.position.y;
  camera.position.y += velocityY * dt;
  if (camera.position.y < EYE) {
    camera.position.y = EYE;
    velocityY = 0;
    onGround = true;
  } else if (playerHits()) {
    camera.position.y = previousY;
    if (velocityY < 0) onGround = true;
    velocityY = 0;
  } else {
    onGround = camera.position.y <= EYE + 0.001;
  }
}

function isTyping(event) {
  const tag = event.target && event.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

window.addEventListener('keydown', (event) => {
  if (isTyping(event)) return;
  const held = event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD'
    || event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.code === 'Space';
  if (event.repeat && !held) return;
  keys[event.code] = true;
  if (event.code === 'Space') event.preventDefault();
  if (event.code === 'Escape') {
    if (state.mode === 'walk') exitWalk();
    else deselect();
    return;
  }
  if (event.code === 'KeyV') {
    toggleWalk();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
    event.preventDefault();
    downloadJSON();
    return;
  }
  if (state.mode === 'walk') {
    if (event.code === 'Space' && !event.repeat) jumpArmed = true;
    return;
  }
  if (event.code === 'KeyG') setTransformMode('translate');
  else if (event.code === 'KeyT') setTransformMode('rotate');
  else if (event.code === 'KeyR') rotate90();
  else if (event.code === 'KeyD') duplicateSelected();
  else if (event.code === 'Delete' || event.code === 'Backspace') {
    event.preventDefault();
    deleteSelected();
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

window.addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code] = false;
});

window.addEventListener('beforeunload', () => writeAutosave());

let pointerDown = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'edit' || event.button !== 0) return;
  pointerDown = {
    x: event.clientX,
    y: event.clientY,
    gizmo: Boolean(transform.dragging || transform.axis),
  };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown || event.button !== 0 || state.mode !== 'edit') return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  const gizmo = pointerDown.gizmo || transform.dragging;
  pointerDown = null;
  if (gizmo || dx * dx + dy * dy > 25) return;
  handlePick(event);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (state.mode === 'edit') updateGhost(event);
});
renderer.domElement.addEventListener('pointerleave', () => {
  if (ghost) ghost.visible = false;
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

dom.btnAdd.addEventListener('click', () => {
  dom.addActions.hidden = !dom.addActions.hidden;
});
dom.pickFiles.addEventListener('click', () => dom.modelFiles.click());
dom.pickFolder.addEventListener('click', () => dom.modelFolder.click());
dom.modelFiles.addEventListener('change', () => {
  const files = [...dom.modelFiles.files];
  dom.modelFiles.value = '';
  dom.addActions.hidden = true;
  if (files.length) importFiles(files);
});
dom.modelFolder.addEventListener('change', () => {
  const files = [...dom.modelFolder.files];
  dom.modelFolder.value = '';
  dom.addActions.hidden = true;
  if (files.length) importFiles(files);
});
dom.btnSave.addEventListener('click', () => downloadJSON());
dom.btnLoad.addEventListener('click', () => dom.jsonInput.click());
dom.jsonInput.addEventListener('change', () => {
  const file = dom.jsonInput.files && dom.jsonInput.files[0];
  dom.jsonInput.value = '';
  if (file) onJsonChosen(file);
});
dom.btnClear.addEventListener('click', () => {
  if (instances.length === 0) return;
  if (window.confirm('配置したオブジェクトをすべて消去しますか？')) clearMap();
});
dom.btnWalk.addEventListener('click', () => toggleWalk());
dom.btnMove.addEventListener('click', () => setTransformMode('translate'));
dom.btnRot.addEventListener('click', () => setTransformMode('rotate'));
dom.btnRot90.addEventListener('click', () => rotate90());
dom.btnDup.addEventListener('click', () => duplicateSelected());
dom.btnDel.addEventListener('click', () => deleteSelected());
dom.btnDeselect.addEventListener('click', () => deselect());

function screenPointOf(index) {
  const inst = instances[index];
  if (!inst) return null;
  const vector = inst.object.position.clone();
  vector.y += 0.45;
  camera.updateMatrixWorld();
  vector.project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top,
  };
}

function objectSummaries() {
  return instances.map((inst) => ({
    paletteId: inst.paletteId,
    name: inst.name,
    fileName: inst.fileName,
    missing: inst.missing,
    vertices: vertexCount(inst.object),
    position: [inst.object.position.x, inst.object.position.y, inst.object.position.z],
    rotation: [inst.object.rotation.x, inst.object.rotation.y, inst.object.rotation.z],
  }));
}

function bootAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.objects) || data.objects.length === 0) return;
    loadData(data);
    renderStatus('自動保存を復元しました');
  } catch {
    renderStatus('自動保存の読み込みに失敗しました');
  }
}

function tick() {
  requestAnimationFrame(tick);
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (state.mode === 'walk') updateWalk(dt);
    else orbit.update();
    if (boxHelper) boxHelper.update();
    renderer.render(scene, camera);
  } catch (error) {
    if (!tick.reported) {
      tick.reported = true;
      console.error(error);
    }
  }
}

renderPalette();
rebuildGhost();
bootAutosave();
updateHint();
if (!statusExtra && instances.length === 0) renderStatus('地面をクリックして配置');
dom.loading.hidden = true;
tick();

window.mapEditor = {
  ready: true,
  getMode: () => state.mode,
  objectCount: () => instances.length,
  serialize,
  loadData,
  clear: () => clearMap(),
  flushSave: () => writeAutosave(),
  selectPalette,
  paletteIds: () => allItems().map((item) => item.id),
  importFiles,
  selection: () => {
    const inst = state.selected ? instanceFromObject(state.selected) : null;
    if (!inst) return null;
    return { name: inst.name, paletteId: inst.paletteId, missing: inst.missing };
  },
  screenPointOf,
  objectSummaries,
  placeAt(x, z, y = 0) {
    const item = getItem(state.selectedPaletteId);
    if (!item) return null;
    const inst = spawn({
      paletteId: item.id,
      name: item.name,
      fileName: item.fileName || null,
      position: [x, y, z],
    });
    updateHint();
    return inst.object.userData.placedId;
  },
  setEditView(position, target) {
    if (state.mode === 'walk') exitWalk();
    camera.position.set(position[0], position[1], position[2]);
    orbit.target.set(target[0], target[1], target[2]);
    orbit.update();
  },
  enterWalk,
  exitWalk,
  playerPosition: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  setPlayerPosition(x, z, lookX = 0, lookZ = 0) {
    if (state.mode !== 'walk') enterWalk();
    camera.position.set(x, EYE, z);
    camera.lookAt(lookX, EYE, lookZ);
    camera.updateMatrixWorld(true);
    velocityY = 0;
    onGround = true;
  },
  get lastSaveUrl() {
    return lastSaveUrl;
  },
  missingFileNames,
};

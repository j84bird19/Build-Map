import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'https://unpkg.com/three-bvh-csg@0.0.16/build/index.module.js';

const host = document.getElementById('canvasHost');
const statusText = document.getElementById('statusText');
const partsList = document.getElementById('partsList');
const layersList = document.getElementById('layersList');
const selectedInfo = document.getElementById('selectedInfo');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(12, 9, 12);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 1, 0);
const transform = new TransformControls(camera, renderer.domElement);
scene.add(transform);
transform.addEventListener('dragging-changed', e => orbit.enabled = !e.value);
transform.addEventListener('objectChange', () => {
  if (selected) syncMeshToPart(selected);
  autosave();
  renderPanels();
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x4b3626, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(12, 20, 9);
scene.add(sun);
const grid = new THREE.GridHelper(80, 80, 0x8a6a3f, 0x39291d);
scene.add(grid);

let parts = [];
let selected = null;
let selectedIds = new Set();
let history = [];
let future = [];
const meshes = new Map();
const labels = new Map();

const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
const $ = id => document.getElementById(id);
const readForm = () => ({
  label: $('partLabel').value.trim() || `Part-${parts.length + 1}`,
  layer: $('partLayer').value.trim() || 'Unsorted',
  material: $('partMaterial').value.trim() || 'wood',
  color: $('partColor').value || '#8b6b45',
  length: Math.max(parseFloat($('partLength').value) || 1, 0.1),
  depth: Math.max(parseFloat($('partDepth').value) || 1, 0.1),
  height: Math.max(parseFloat($('partHeight').value) || 1, 0.1),
  units: $('partUnits').value,
  leftAngle: parseFloat($('leftAngle').value) || 0,
  rightAngle: parseFloat($('rightAngle').value) || 0,
  notes: $('partNotes').value.trim()
});
const snapshot = () => JSON.stringify(parts);
function pushHistory(){ history.push(snapshot()); if(history.length>80) history.shift(); future = []; }
function restore(json){ parts = JSON.parse(json || '[]'); selected = null; selectedIds = new Set(); rebuildScene(); renderPanels(); autosave(false); }
function autosave(setStatus=true){ localStorage.setItem('cabinRebuildProject', snapshot()); if(setStatus) setStatusText('Saved locally.'); }
function setStatusText(text){ statusText.textContent = text; }
function meshScaleFromPart(p){ return new THREE.Vector3(p.length, p.height, p.depth); }

function makeLabelSprite(text){
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,14,9,.82)'; ctx.roundRect(8, 25, 496, 90, 18); ctx.fill();
  ctx.strokeStyle = '#d9ad5f'; ctx.lineWidth = 6; ctx.stroke();
  ctx.fillStyle = '#f2e6cf'; ctx.font = 'bold 48px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 22), 256, 70);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, transparent:true, depthTest:false }));
  sprite.scale.set(2.6, .8, 1); return sprite;
}

function makeGeometry(p){
  if(p.shape === 'boolean' && p.geometry){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p.geometry.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.geometry.normals, 3));
    if(p.geometry.index) geo.setIndex(p.geometry.index);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
  if(p.shape === 'custom' && p.profile?.length > 2){
    const shape = new THREE.Shape();
    p.profile.forEach((pt, i) => i ? shape.lineTo(pt.x, pt.y) : shape.moveTo(pt.x, pt.y));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth:p.depth, bevelEnabled:false });
    geo.center();
    geo.scale(p.length, p.height, 1);
    return geo;
  }
  return new THREE.BoxGeometry(p.length, p.height, p.depth);
}
function createMesh(p){
  const mat = new THREE.MeshStandardMaterial({ color:p.color, roughness:.72, metalness:.04 });
  const mesh = new THREE.Mesh(makeGeometry(p), mat);
  mesh.userData.id = p.id;
  mesh.position.fromArray(p.position || [0, p.height/2, 0]);
  mesh.rotation.fromArray(p.rotation || [0,0,0]);
  mesh.scale.fromArray(p.scale || [1,1,1]);
  scene.add(mesh); meshes.set(p.id, mesh);
  const sprite = makeLabelSprite(p.label);
  sprite.position.set(mesh.position.x, mesh.position.y + p.height/2 + .45, mesh.position.z);
  scene.add(sprite); labels.set(p.id, sprite);
  return mesh;
}
function clearSceneParts(){ meshes.forEach(m=>{scene.remove(m); m.geometry.dispose(); m.material.dispose();}); labels.forEach(l=>scene.remove(l)); meshes.clear(); labels.clear(); transform.detach(); }
function rebuildScene(){ clearSceneParts(); parts.forEach(p => createMesh(p)); updateVisibility(); }
function syncMeshToPart(p){
  const mesh = meshes.get(p.id); if(!mesh) return;
  p.position = mesh.position.toArray(); p.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]; p.scale = mesh.scale.toArray();
  const label = labels.get(p.id); if(label) label.position.set(mesh.position.x, mesh.position.y + (p.height * mesh.scale.y)/2 + .45, mesh.position.z);
}
function highlightSelection(){
  parts.forEach(p => {
    const mesh = meshes.get(p.id);
    if(mesh?.material){
      mesh.material.emissive = new THREE.Color(selectedIds.has(p.id) ? 0x6b4a1e : 0x000000);
      mesh.material.emissiveIntensity = selectedIds.has(p.id) ? 0.35 : 0;
    }
  });
}
function selectPart(id, append=false){
  const part = parts.find(p => p.id === id) || null;
  if(!part){ selected = null; selectedIds.clear(); transform.detach(); renderPanels(); return; }
  if(append){
    if(selectedIds.has(id) && selectedIds.size > 1) selectedIds.delete(id);
    else selectedIds.add(id);
  } else {
    selectedIds = new Set([id]);
  }
  selected = parts.find(p => p.id === id) || [...selectedIds].map(x=>parts.find(p=>p.id===x)).filter(Boolean).at(-1) || null;
  if(selectedIds.size === 1 && selected){ transform.attach(meshes.get(selected.id)); fillForm(selected); }
  else { transform.detach(); if(selected) fillForm(selected); }
  highlightSelection();
  setStatusText(selectedIds.size > 1 ? `${selectedIds.size} parts selected.` : `Selected ${selected.label}`);
  renderPanels();
}
function fillForm(p){
  $('partLabel').value=p.label; $('partLayer').value=p.layer; $('partMaterial').value=p.material; $('partColor').value=p.color;
  $('partLength').value=p.length; $('partDepth').value=p.depth; $('partHeight').value=p.height; $('partUnits').value=p.units || 'ft';
  $('leftAngle').value=p.leftAngle || 0; $('rightAngle').value=p.rightAngle || 0; $('partNotes').value=p.notes || '';
}
function addPart(shape='block'){
  pushHistory();
  const data = readForm();
  const p = { id:uid(), shape, ...data, position:[0, data.height/2, 0], rotation:[0,0,0], scale:[1,1,1], fastenedTo:null };
  if(shape === 'custom') p.profile = normalizeProfile();
  parts.push(p); createMesh(p); selectPart(p.id); renderPanels(); autosave();
}
function updateSelected(){
  if(!selected) return setStatusText('Select a part first.');
  pushHistory();
  const data = readForm(); Object.assign(selected, data);
  const mesh = meshes.get(selected.id); const oldPos = mesh.position.toArray(); const oldRot = [mesh.rotation.x,mesh.rotation.y,mesh.rotation.z]; const oldScale = mesh.scale.toArray();
  scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshes.delete(selected.id);
  const oldLabel = labels.get(selected.id); if(oldLabel) scene.remove(oldLabel); labels.delete(selected.id);
  selected.position = oldPos; selected.rotation = oldRot; selected.scale = oldScale;
  createMesh(selected); selectPart(selected.id); renderPanels(); autosave(); setStatusText('Selected part updated.');
}
function duplicateSelected(){
  if(!selectedIds.size) return;
  pushHistory();
  const copies = parts.filter(p=>selectedIds.has(p.id)).map(p=>{
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid(); copy.label = `${copy.label}-copy`; copy.position[0]+=1; copy.position[2]+=1;
    return copy;
  });
  parts.push(...copies); copies.forEach(createMesh); selectedIds = new Set(copies.map(p=>p.id)); selected = copies.at(-1);
  if(copies.length === 1) transform.attach(meshes.get(selected.id)); else transform.detach();
  highlightSelection(); renderPanels(); autosave(); setStatusText(`${copies.length} part(s) duplicated.`);
}
function deleteSelected(){
  if(!selectedIds.size) return;
  pushHistory(); const count = selectedIds.size; parts = parts.filter(p=>!selectedIds.has(p.id)); selected=null; selectedIds.clear(); rebuildScene(); renderPanels(); autosave(); setStatusText(`${count} part(s) deleted.`);
}

function worldBrushFromPart(p){
  const mesh = meshes.get(p.id);
  if(!mesh) return null;
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color:p.color, roughness:.72, metalness:.04 });
  const brush = new Brush(geo, mat);
  brush.updateMatrixWorld(true);
  return brush;
}
function geometryPayload(geo){
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return {
    positions: Array.from(geo.attributes.position.array),
    normals: Array.from(geo.attributes.normal.array)
  };
}
function addBooleanResult(resultMesh, label, sourceParts){
  resultMesh.geometry.computeBoundingBox();
  const box = resultMesh.geometry.boundingBox;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const primary = sourceParts[0];
  const p = {
    id: uid(), shape: 'boolean', label, layer: primary.layer, material: primary.material,
    color: primary.color, length: Number(size.x.toFixed(3)) || primary.length,
    height: Number(size.y.toFixed(3)) || primary.height, depth: Number(size.z.toFixed(3)) || primary.depth,
    units: primary.units || 'ft', leftAngle: 0, rightAngle: 0,
    notes: `Custom shape made from: ${sourceParts.map(x=>x.label).join(', ')}`,
    position:[0,0,0], rotation:[0,0,0], scale:[1,1,1], fastenedTo:null,
    geometry: geometryPayload(resultMesh.geometry)
  };
  parts = parts.filter(x=>!selectedIds.has(x.id));
  parts.push(p);
  rebuildScene();
  selectPart(p.id);
  renderPanels(); autosave();
  return p;
}
function mergeSelected(){
  const chosen = parts.filter(p=>selectedIds.has(p.id));
  if(chosen.length < 2) return setStatusText('Select at least 2 parts to merge.');
  pushHistory();
  try{
    const evaluator = new Evaluator();
    let result = worldBrushFromPart(chosen[0]);
    for(const p of chosen.slice(1)) result = evaluator.evaluate(result, worldBrushFromPart(p), ADDITION);
    const made = addBooleanResult(result, `${chosen[0].label}-merged`, chosen);
    setStatusText(`Merged ${chosen.length} pieces into ${made.label}.`);
  }catch(err){ console.error(err); setStatusText('Merge failed. Try using simpler overlapping block shapes.'); }
}
function subtractSelected(){
  const chosen = parts.filter(p=>selectedIds.has(p.id));
  if(chosen.length < 2 || !selected) return setStatusText('Select the main part first, then Shift-click cutter parts.');
  const primary = selected;
  const cutters = chosen.filter(p=>p.id !== primary.id);
  pushHistory();
  try{
    const evaluator = new Evaluator();
    let result = worldBrushFromPart(primary);
    for(const cutter of cutters) result = evaluator.evaluate(result, worldBrushFromPart(cutter), SUBTRACTION);
    const made = addBooleanResult(result, `${primary.label}-cut`, [primary, ...cutters]);
    setStatusText(`Subtracted ${cutters.length} cutter piece(s) from ${primary.label}.`);
  }catch(err){ console.error(err); setStatusText('Subtract failed. Try making cutter blocks overlap clearly through the target part.'); }
}
function fastenSelected(){ if(!selected) return; pushHistory(); selected.fastenedTo = selected.layer; autosave(); renderPanels(); setStatusText(`${selected.label} fastened/grouped to ${selected.layer}.`); }
function updateVisibility(){
  const visibleLayers = getVisibleLayers();
  parts.forEach(p=>{ const show = visibleLayers[p.layer] !== false; const m=meshes.get(p.id), l=labels.get(p.id); if(m) m.visible=show; if(l) l.visible=show; });
}
function getVisibleLayers(){ return JSON.parse(localStorage.getItem('cabinRebuildLayers') || '{}'); }
function setLayerVisible(layer, visible){ const state=getVisibleLayers(); state[layer]=visible; localStorage.setItem('cabinRebuildLayers', JSON.stringify(state)); updateVisibility(); }
function renderPanels(){
  if(selectedIds.size > 1){
    const chosen = parts.filter(p=>selectedIds.has(p.id));
    selectedInfo.innerHTML = `<div><strong>${chosen.length} parts selected</strong></div><div class="meta">Primary: ${selected?.label || 'none'}</div><div class="meta">Use Merge to combine, or Subtract to cut all other selected pieces out of the primary.</div>`;
  } else if(selected){
    selectedInfo.innerHTML = `<div><strong>${selected.label}</strong></div><div>${selected.length} × ${selected.depth} × ${selected.height} ${selected.units||'ft'}</div><div><span class="pill">${selected.layer}</span><span class="pill">${selected.material}</span><span class="pill">${selected.shape}</span></div><div class="meta">Cuts: L ${selected.leftAngle||0}° / R ${selected.rightAngle||0}°</div><div class="meta">${selected.notes||'No notes.'}</div>`;
  } else selectedInfo.textContent = 'Nothing selected.';
  partsList.innerHTML = parts.map(p=>`<div class="part-row ${selectedIds.has(p.id)?'selected':''}" data-id="${p.id}"><strong>${p.label}</strong><div class="meta">${p.length}×${p.depth}×${p.height} ${p.units||'ft'} • ${p.layer} • ${p.material}</div></div>`).join('') || '<div class="meta">No parts yet.</div>';
  document.querySelectorAll('.part-row').forEach(row=>row.onclick=(e)=>selectPart(row.dataset.id, e.shiftKey || e.ctrlKey || e.metaKey));
  const layers = [...new Set(parts.map(p=>p.layer))]; const state = getVisibleLayers();
  layersList.innerHTML = layers.map(layer=>`<label class="layer-row"><span>${layer}</span><input type="checkbox" data-layer="${layer}" ${state[layer]===false?'':'checked'} /></label>`).join('') || '<div class="meta">No layers yet.</div>';
  document.querySelectorAll('.layer-row input').forEach(cb=>cb.onchange=()=>setLayerVisible(cb.dataset.layer, cb.checked));
}

const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', ev => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...meshes.values()], false);
  if(hits[0]) selectPart(hits[0].object.userData.id, ev.shiftKey || ev.ctrlKey || ev.metaKey);
  else if(!ev.shiftKey && !ev.ctrlKey && !ev.metaKey){ selected=null; selectedIds.clear(); transform.detach(); highlightSelection(); renderPanels(); }
});

function setView(view){
  const dist = 22;
  if(view==='top') camera.position.set(0,dist,0.01);
  if(view==='front') camera.position.set(0,6,dist);
  if(view==='side') camera.position.set(dist,6,0);
  if(view==='iso') camera.position.set(12,9,12);
  orbit.target.set(0,1,0); orbit.update();
}

$('addBlockBtn').onclick=()=>addPart('block'); $('updatePartBtn').onclick=updateSelected;
$('duplicateBtn').onclick=duplicateSelected; $('mergeBtn').onclick=mergeSelected; $('subtractBtn').onclick=subtractSelected; $('mergePanelBtn').onclick=mergeSelected; $('subtractPanelBtn').onclick=subtractSelected; $('deleteBtn').onclick=deleteSelected; $('fastenBtn').onclick=fastenSelected;
$('undoBtn').onclick=()=>{ if(!history.length) return; future.push(snapshot()); restore(history.pop()); };
$('redoBtn').onclick=()=>{ if(!future.length) return; history.push(snapshot()); restore(future.pop()); };
document.querySelectorAll('.mode').forEach(btn=>btn.onclick=()=>{ document.querySelectorAll('.mode').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); transform.setMode(btn.dataset.mode); });
document.querySelectorAll('.viewBtn').forEach(btn=>btn.onclick=()=>setView(btn.dataset.view));
$('saveBtn').onclick=()=>autosave();
$('exportBtn').onclick=()=>{ const blob=new Blob([JSON.stringify({version:1,parts},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cabin-rebuild-project.json'; a.click(); URL.revokeObjectURL(a.href); };
$('importInput').onchange=e=>{ const file=e.target.files[0]; if(!file)return; const reader=new FileReader(); reader.onload=()=>{ pushHistory(); const data=JSON.parse(reader.result); parts=data.parts||data||[]; rebuildScene(); renderPanels(); autosave(); }; reader.readAsText(file); };
$('clearBtn').onclick=()=>{ if(confirm('Clear this project from the app? Export first if needed.')){ pushHistory(); parts=[]; selected=null; rebuildScene(); renderPanels(); autosave(); } };
function resize(){ const w=host.clientWidth,h=host.clientHeight; renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(host); resize();
function animate(){ requestAnimationFrame(animate); orbit.update(); labels.forEach((sprite,id)=>{ const m=meshes.get(id), p=parts.find(x=>x.id===id); if(m&&p) sprite.position.set(m.position.x, m.position.y + (p.height*m.scale.y)/2 + .45, m.position.z); }); renderer.render(scene,camera); }
animate();
try{ const stored=localStorage.getItem('cabinRebuildProject'); if(stored) restore(stored); else renderPanels(); } catch { renderPanels(); }
setStatusText('Ready. Everything auto-saves locally in this browser.');

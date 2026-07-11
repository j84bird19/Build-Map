import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const state = {
  objects: [], selected: [], layers: [{name:'Front Wall', visible:true, locked:false, color:'#22c44b'}],
  unit:'ft', zoom:42, panX:70, panY:55, snap:true, grid:0.5, undo:[], redo:[],
  activeView:'design', measureMode:false, measurePts:[], lastMeasurement:null, marquee:null
};

const canvas = $('#designCanvas'), ctx = canvas.getContext('2d');
const topRuler = $('#topRuler'), tr = topRuler.getContext('2d');
const leftRuler = $('#leftRuler'), lr = leftRuler.getContext('2d');
let drag = null;

function snapshot(){ state.undo.push(JSON.stringify({objects:state.objects,layers:state.layers})); if(state.undo.length>60)state.undo.shift(); state.redo=[]; }
function restore(raw){ const d=JSON.parse(raw); state.objects=d.objects||[]; state.layers=d.layers||state.layers; state.selected=[]; renderAll(); }
function saveLocal(){ localStorage.setItem('cabin-rebuild-mapper-v2', JSON.stringify({objects:state.objects,layers:state.layers,grid:state.grid,snap:state.snap})); toast('Project saved'); }
function loadLocal(){ try{const d=JSON.parse(localStorage.getItem('cabin-rebuild-mapper-v2')); if(d){Object.assign(state,d);}}catch{} }
function toast(msg){ $('#selectionReadout').textContent=msg; clearTimeout(toast.t); toast.t=setTimeout(updateReadout,1800); }

function resize(){
  const wrap=$('#canvasWrap'), dpr=devicePixelRatio||1;
  canvas.width=wrap.clientWidth*dpr; canvas.height=wrap.clientHeight*dpr; canvas.style.width=wrap.clientWidth+'px'; canvas.style.height=wrap.clientHeight+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  topRuler.width=topRuler.clientWidth*dpr; topRuler.height=topRuler.clientHeight*dpr; tr.setTransform(dpr,0,0,dpr,0,0);
  leftRuler.width=leftRuler.clientWidth*dpr; leftRuler.height=leftRuler.clientHeight*dpr; lr.setTransform(dpr,0,0,dpr,0,0);
  render2d(); resize3d();
}
window.addEventListener('resize',resize);
const worldToScreen=(x,y)=>({x:state.panX+x*state.zoom,y:state.panY+y*state.zoom});
const screenToWorld=(x,y)=>({x:(x-state.panX)/state.zoom,y:(y-state.panY)/state.zoom});
const snap=v=>state.snap?Math.round(v/state.grid)*state.grid:v;

function pathFor(o,c=ctx){
  const w=o.w*state.zoom,h=o.h*state.zoom; c.beginPath();
  if(o.type==='circle'||o.type==='log'){c.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);}
  else if(o.type==='triangle'){c.moveTo(0,-h/2);c.lineTo(w/2,h/2);c.lineTo(-w/2,h/2);c.closePath();}
  else if(o.type==='trapezoid'){c.moveTo(-w*.32,-h/2);c.lineTo(w*.32,-h/2);c.lineTo(w/2,h/2);c.lineTo(-w/2,h/2);c.closePath();}
  else if(o.type==='wedge'){c.moveTo(-w/2,h/2);c.lineTo(w/2,h/2);c.lineTo(w/2,-h/2);c.closePath();}
  else c.rect(-w/2,-h/2,w,h);
}
function drawCompoundObject(o,p){
  // Boolean work is composited on a transparent offscreen canvas first. This keeps
  // Subtract/Exclude from erasing the drafting grid or any unrelated objects.
  const pad=24;
  const width=Math.max(2,Math.ceil(o.w*state.zoom+pad*2));
  const height=Math.max(2,Math.ceil(o.h*state.zoom+pad*2));
  const off=document.createElement('canvas');off.width=width;off.height=height;
  const oc=off.getContext('2d');oc.translate(width/2,height/2);
  const drawPart=(part,mode='source-over')=>{
    oc.save();oc.globalCompositeOperation=mode;
    oc.translate((part.x-o.x)*state.zoom,(part.y-o.y)*state.zoom);
    oc.rotate((part.rot||0)-(o.rot||0));pathFor(part,oc);oc.fillStyle=o.color||'#8b6b45';oc.fill();oc.restore();
  };
  for(const cid of o.children||[]){const ch=state.objects.find(x=>x.id===cid);if(ch)drawPart(ch);}
  for(const hole of o.holes||[])drawPart(hole,'destination-out');
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);ctx.drawImage(off,-width/2,-height/2);
  ctx.strokeStyle='#45494c';ctx.lineWidth=1.2;ctx.strokeRect(-o.w*state.zoom/2,-o.h*state.zoom/2,o.w*state.zoom,o.h*state.zoom);ctx.restore();
}
function drawObject(o){
  const layer=state.layers.find(l=>l.name===o.layer); if(layer && !layer.visible)return;
  const p=worldToScreen(o.x,o.y);
  if(o.operation==='compound') drawCompoundObject(o,p);
  else {ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);pathFor(o);ctx.fillStyle=o.color||'#8b6b45';ctx.fill();ctx.strokeStyle='#45494c';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}
  if(o.label){ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle='#111';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(o.label,0,4);ctx.restore();}
  if(state.selected.includes(o.id)) drawSelection(o);
}
function drawSelection(o){
  const p=worldToScreen(o.x,o.y),w=o.w*state.zoom,h=o.h*state.zoom;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);ctx.strokeStyle='#15958e';ctx.lineWidth=2;ctx.strokeRect(-w/2,-h/2,w,h);ctx.fillStyle='#fff';ctx.strokeStyle='#15958e';for(const [x,y] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]){ctx.fillRect(x-5,y-5,10,10);ctx.strokeRect(x-5,y-5,10,10)}ctx.beginPath();ctx.moveTo(0,-h/2);ctx.lineTo(0,-h/2-28);ctx.stroke();ctx.beginPath();ctx.arc(0,-h/2-36,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
}
function render2d(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const minor=state.zoom*state.grid, major=minor*4;ctx.lineWidth=1;
  for(let x=((state.panX%minor)+minor)%minor;x<w;x+=minor){ctx.strokeStyle='#eef0f1';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
  for(let y=((state.panY%minor)+minor)%minor;y<h;y+=minor){ctx.strokeStyle='#eef0f1';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  for(let x=((state.panX%major)+major)%major;x<w;x+=major){ctx.strokeStyle='#d9dcde';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
  for(let y=((state.panY%major)+major)%major;y<h;y+=major){ctx.strokeStyle='#d9dcde';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  state.objects.filter(o=>!o.hidden&&!o.parentId).forEach(drawObject);
  if(state.lastMeasurement){
    const a=worldToScreen(state.lastMeasurement.a.x,state.lastMeasurement.a.y),b=worldToScreen(state.lastMeasurement.b.x,state.lastMeasurement.b.y);
    ctx.save();ctx.strokeStyle='#e65d35';ctx.fillStyle='#e65d35';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    for(const pt of [a,b]){ctx.beginPath();ctx.arc(pt.x,pt.y,5,0,Math.PI*2);ctx.fill()}
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,label=`${state.lastMeasurement.distance.toFixed(3)} ${state.unit}`;ctx.font='700 13px system-ui';const tw=ctx.measureText(label).width;ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(mx-tw/2-7,my-24,tw+14,22);ctx.fillStyle='#b53e20';ctx.textAlign='center';ctx.fillText(label,mx,my-8);ctx.restore();
  } else if(state.measurePts.length){ctx.fillStyle='#e65d35';for(const p of state.measurePts){const sp=worldToScreen(p.x,p.y);ctx.beginPath();ctx.arc(sp.x,sp.y,5,0,Math.PI*2);ctx.fill()}}
  if(state.marquee){const x=Math.min(state.marquee.start.x,state.marquee.end.x),y=Math.min(state.marquee.start.y,state.marquee.end.y),w=Math.abs(state.marquee.end.x-state.marquee.start.x),h=Math.abs(state.marquee.end.y-state.marquee.start.y);ctx.save();ctx.fillStyle='rgba(21,149,142,.12)';ctx.strokeStyle='#15958e';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore()}
  drawRulers(); updateReadout();
}
function drawRulers(){const w=topRuler.clientWidth,h=leftRuler.clientHeight;tr.clearRect(0,0,w,32);lr.clearRect(0,0,36,h);tr.fillStyle=lr.fillStyle='#f4f5f5';tr.fillRect(0,0,w,32);lr.fillRect(0,0,36,h);tr.strokeStyle=lr.strokeStyle='#aeb3b6';tr.fillStyle=lr.fillStyle='#666';tr.font=lr.font='11px system-ui';
  const step=state.zoom; let start=Math.floor((-state.panX)/step)-1;for(let i=start;i<start+w/step+3;i++){let x=state.panX+i*step;tr.beginPath();tr.moveTo(x,32);tr.lineTo(x,i%5===0?14:23);tr.stroke();if(i%5===0)tr.fillText(i,x+3,12)}
  start=Math.floor((-state.panY)/step)-1;for(let i=start;i<start+h/step+3;i++){let y=state.panY+i*step;lr.beginPath();lr.moveTo(36,y);lr.lineTo(i%5===0?17:27,y);lr.stroke();if(i%5===0){lr.save();lr.translate(12,y-3);lr.rotate(-Math.PI/2);lr.fillText(i,0,0);lr.restore()}}
}
function hitTest(x,y){
  for(let i=state.objects.length-1;i>=0;i--){
    const o=state.objects[i];
    if(o.hidden||o.parentId)continue;
    const p=screenToWorld(x,y),dx=p.x-o.x,dy=p.y-o.y;
    const cs=Math.cos(-(o.rot||0)),sn=Math.sin(-(o.rot||0));
    const lx=dx*cs-dy*sn,ly=dx*sn+dy*cs;
    if(Math.abs(lx)<=o.w/2&&Math.abs(ly)<=o.h/2)return o;
  }
  return null;
}
function pointerPos(e){
  const r=canvas.getBoundingClientRect();
  return{x:e.clientX-r.left,y:e.clientY-r.top};
}
function selectedHandleAt(p){
  if(state.selected.length!==1)return null;
  const o=state.objects.find(x=>x.id===state.selected[0]);
  if(!o||o.locked)return null;
  const center=worldToScreen(o.x,o.y),dx=p.x-center.x,dy=p.y-center.y;
  const cs=Math.cos(-(o.rot||0)),sn=Math.sin(-(o.rot||0));
  const lx=dx*cs-dy*sn,ly=dx*sn+dy*cs;
  const hw=o.w*state.zoom/2,hh=o.h*state.zoom/2,hit=18;
  const corners=[[-hw,-hh,'nw'],[hw,-hh,'ne'],[hw,hh,'se'],[-hw,hh,'sw']];
  for(const [x,y,name] of corners)if(Math.hypot(lx-x,ly-y)<=hit)return{type:'resize',corner:name,object:o};
  if(Math.hypot(lx,ly-(-hh-36))<=20)return{type:'rotate',object:o};
  return null;
}
const activePointers=new Map();
let pinch=null;
function selectInsideMarquee(rect){
  const x1=Math.min(rect.start.x,rect.end.x),x2=Math.max(rect.start.x,rect.end.x),y1=Math.min(rect.start.y,rect.end.y),y2=Math.max(rect.start.y,rect.end.y);
  state.selected=state.objects.filter(o=>{
    if(o.hidden||o.parentId||o.locked)return false;
    const p=worldToScreen(o.x,o.y),hw=o.w*state.zoom/2,hh=o.h*state.zoom/2;
    return p.x-hw>=x1&&p.x+hw<=x2&&p.y-hh>=y1&&p.y+hh<=y2;
  }).map(o=>o.id);
}
function startPinch(){
  if(activePointers.size<2)return;
  const pts=[...activePointers.values()].slice(0,2);
  const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
  pinch={
    startDistance:Math.max(10,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)),
    startZoom:state.zoom,
    anchorWorld:screenToWorld(mid.x,mid.y)
  };
  drag=null;state.marquee=null;
}
canvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  const p=pointerPos(e);
  activePointers.set(e.pointerId,p);
  if(activePointers.size===2){startPinch();return;}
  if(activePointers.size>2)return;
  const world=screenToWorld(p.x,p.y);
  if(state.measureMode){
    state.measurePts.push(world);
    if(state.measurePts.length===2){
      const [a,b]=state.measurePts,d=Math.hypot(b.x-a.x,b.y-a.y);
      state.lastMeasurement={a,b,distance:d};state.measurePts=[];state.measureMode=false;
      toast(`Measured ${d.toFixed(3)} ${state.unit}`);
    }
    render2d();return;
  }
  const handle=selectedHandleAt(p);
  if(handle){
    snapshot();
    drag={type:handle.type,objectId:handle.object.id,corner:handle.corner,startScreen:p,startRot:handle.object.rot||0,startW:handle.object.w,startH:handle.object.h,moved:false};
    return;
  }
  const o=hitTest(p.x,p.y);
  if(o&&!o.locked){
    if(e.shiftKey||e.ctrlKey){state.selected=state.selected.includes(o.id)?state.selected.filter(id=>id!==o.id):[...state.selected,o.id]}
    else if(!state.selected.includes(o.id))state.selected=[o.id];
    snapshot();
    drag={type:'move',start:world,startScreen:p,moved:false,orig:state.selected.map(id=>{const q=state.objects.find(o=>o.id===id);return{id,x:q.x,y:q.y}})};
  }else{
    state.selected=[];state.marquee={start:p,end:p};drag={type:'marquee',startScreen:p,moved:false};
  }
  render2d();
});
canvas.addEventListener('pointermove',e=>{
  if(!activePointers.has(e.pointerId))return;
  const p=pointerPos(e);activePointers.set(e.pointerId,p);
  if(activePointers.size>=2){
    if(!pinch)startPinch();
    const pts=[...activePointers.values()].slice(0,2);
    const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    const dist=Math.max(10,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y));
    state.zoom=Math.max(8,Math.min(320,pinch.startZoom*(dist/pinch.startDistance)));
    state.panX=mid.x-pinch.anchorWorld.x*state.zoom;
    state.panY=mid.y-pinch.anchorWorld.y*state.zoom;
    render2d();return;
  }
  if(!drag)return;
  drag.moved=drag.moved||Math.hypot(p.x-drag.startScreen.x,p.y-drag.startScreen.y)>4;
  if(drag.type==='marquee'){
    if(drag.moved){state.marquee.end=p;selectInsideMarquee(state.marquee)}
    render2d();return;
  }
  const o=drag.objectId&&state.objects.find(x=>x.id===drag.objectId);
  if(drag.type==='rotate'&&o){
    const w=screenToWorld(p.x,p.y);
    let angle=Math.atan2(w.y-o.y,w.x-o.x)+Math.PI/2;
    if(state.snap){const step=Math.PI/180;angle=Math.round(angle/step)*step;}
    o.rot=angle;render2d();return;
  }
  if(drag.type==='resize'&&o){
    const w=screenToWorld(p.x,p.y),dx=w.x-o.x,dy=w.y-o.y;
    const cs=Math.cos(-(o.rot||0)),sn=Math.sin(-(o.rot||0));
    const lx=dx*cs-dy*sn,ly=dx*sn+dy*cs;
    const minWorld=Math.max(.08,10/state.zoom);
    o.w=Math.max(minWorld,state.snap?Math.max(state.grid,Math.round((Math.abs(lx)*2)/state.grid)*state.grid):Math.abs(lx)*2);
    o.h=Math.max(minWorld,state.snap?Math.max(state.grid,Math.round((Math.abs(ly)*2)/state.grid)*state.grid):Math.abs(ly)*2);
    render2d();return;
  }
  if(drag.type==='move'){
    const w=screenToWorld(p.x,p.y),dx=w.x-drag.start.x,dy=w.y-drag.start.y;
    for(const a of drag.orig){const obj=state.objects.find(x=>x.id===a.id);if(obj){obj.x=snap(a.x+dx);obj.y=snap(a.y+dy)}}
    render2d();
  }
});
function finishPointer(e){
  activePointers.delete(e.pointerId);
  if(activePointers.size<2)pinch=null;
  if(activePointers.size===1){
    // Do not start a one-finger drag after a pinch; wait for a fresh touch.
    drag=null;
  }else if(activePointers.size===0){
    if(drag?.type==='marquee'&&!drag.moved){state.marquee=null;state.selected=[]}
    else if(drag?.type==='marquee')state.marquee=null;
    drag=null;
    renderParts();sync3d();render2d();
  }
}
canvas.addEventListener('pointerup',finishPointer);
canvas.addEventListener('pointercancel',finishPointer);
canvas.addEventListener('lostpointercapture',e=>{if(activePointers.has(e.pointerId))finishPointer(e)});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const p=pointerPos(e),before=screenToWorld(p.x,p.y),factor=e.deltaY<0?1.1:.9;
  state.zoom=Math.max(8,Math.min(320,state.zoom*factor));
  state.panX=p.x-before.x*state.zoom;state.panY=p.y-before.y*state.zoom;
  render2d();
},{passive:false});
// Samsung/Android browser fallback: block page-level pinch/pan while working on the canvas.
for(const el of [canvas,$('#canvasWrap'),$('#designView')]){
  el.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
  el.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
}

function addObject(type='rect',data={}){snapshot();const i=state.objects.length+1,o={id:uid(),type,label:data.label||`P-${String(i).padStart(3,'0')}`,x:data.x??4,y:data.y??4,w:+(data.w??4),h:+(data.h??1),depth:+(data.depth??1),rot:0,color:data.color||'#8b6b45',material:data.material||'Wood',layer:data.layer||'Front Wall',notes:data.notes||'',unit:data.unit||state.unit,hidden:false,locked:false};state.objects.push(o);state.selected=[o.id];renderAll();return o}
function selectedObjects(){return state.selected.map(id=>state.objects.find(o=>o.id===id)).filter(Boolean)}
function duplicate(){const sel=selectedObjects();if(!sel.length)return;snapshot();state.selected=[];for(const o of sel){const n={...structuredClone(o),id:uid(),x:o.x+.5,y:o.y+.5,label:o.label};delete n.parentId;state.objects.push(n);state.selected.push(n.id)}renderAll()}
function removeSelected(){if(!state.selected.length)return;snapshot();state.objects=state.objects.filter(o=>!state.selected.includes(o.id));state.selected=[];renderAll()}
function booleanOp(op){const sel=selectedObjects();if(sel.length<2){toast('Select at least two objects');return}snapshot();const base=sel[0], rest=sel.slice(1);if(op==='subtract'){base.operation='compound';base.children=base.children||[base.id];base.holes=[...(base.holes||[]),...rest.map(r=>structuredClone(r))];state.objects=state.objects.filter(o=>!rest.includes(o));state.selected=[base.id];toast('Subtracted from primary object');}
else{const minX=Math.min(...sel.map(o=>o.x-o.w/2)),maxX=Math.max(...sel.map(o=>o.x+o.w/2)),minY=Math.min(...sel.map(o=>o.y-o.h/2)),maxY=Math.max(...sel.map(o=>o.y+o.h/2));const n={...structuredClone(base),id:uid(),x:(minX+maxX)/2,y:(minY+maxY)/2,w:maxX-minX,h:maxY-minY,operation:'compound',children:sel.map(o=>o.id),holes:[],label:base.label};for(const o of sel)o.parentId=n.id;state.objects.push(n);state.selected=[n.id];toast(`${op} created`)}renderAll()}
function group(){const sel=selectedObjects();if(sel.length<2)return toast('Select multiple parts first');snapshot();const gid=uid();sel.forEach(o=>o.groupId=gid);toast('Parts fastened/grouped');renderAll()}
function applyMaterial(name,color){selectedObjects().forEach(o=>{o.material=name;o.color=color});renderAll()}

const panelTemplates={shapes:'shapePanelTemplate',parts:'partsPanelTemplate',labels:'labelsPanelTemplate',layers:'layersPanelTemplate',materials:'materialsPanelTemplate',settings:'settingsPanelTemplate',measure:'measurePanelTemplate'};
function openPanel(name){const id=panelTemplates[name];if(!id)return;$('#sheetTitle').textContent=name[0].toUpperCase()+name.slice(1);$('#sheetContent').innerHTML='';$('#sheetContent').append($('#'+id).content.cloneNode(true));$('#toolSheet').classList.add('open');$('#sheetBackdrop').classList.add('open');$('#toolSheet').setAttribute('aria-hidden','false');$$('.bottom-toolbar button').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));wirePanel(name)}
function closePanel(){$('#toolSheet').classList.remove('open');$('#sheetBackdrop').classList.remove('open');$('#toolSheet').setAttribute('aria-hidden','true');$$('.bottom-toolbar button').forEach(b=>b.classList.remove('active'))}
function wirePanel(name){
 if(name==='shapes')$$('[data-shape]',$('#sheetContent')).forEach(b=>b.onclick=()=>{const map={rect:[4,1],beam:[6,.5],log:[4,1],triangle:[3,3],trapezoid:[4,2],circle:[2,2],wedge:[3,2],panel:[4,4]};addObject(b.dataset.shape,{w:map[b.dataset.shape][0],h:map[b.dataset.shape][1]});closePanel()});
 if(name==='parts')$('#addPartBtn').onclick=()=>{const unit=$('#partUnits').value;state.unit=unit;addObject('rect',{label:$('#partLabel').value||undefined,w:+$('#partLength').value,h:+$('#partHeight').value,depth:+$('#partDepth').value,layer:$('#partLayer').value||'Unassigned',material:$('#partMaterial').value||'Wood',color:$('#partColor').value,notes:$('#partNotes').value,unit});ensureLayer($('#partLayer').value||'Unassigned');closePanel()};
 if(name==='labels'){const o=selectedObjects()[0];$('#editLabel').value=o?.label||'';$('#editNotes').value=o?.notes||'';$('#applyLabelBtn').onclick=()=>{selectedObjects().forEach(x=>{x.label=$('#editLabel').value;x.notes=$('#editNotes').value});renderAll();closePanel()}}
 if(name==='layers'){renderLayerPanel();$('#addLayerBtn').onclick=()=>{const n=prompt('Layer name');if(n){ensureLayer(n);renderLayerPanel();renderAll()}}}
 if(name==='materials'){$$('[data-material]',$('#sheetContent')).forEach(b=>b.onclick=()=>{applyMaterial(b.dataset.material,b.dataset.color);closePanel()});$('#customMaterialColor').oninput=e=>applyMaterial('Custom',e.target.value)}
 if(name==='settings'){ $('#duplicateBtn').onclick=duplicate;$('#deleteBtn').onclick=removeSelected;$('#groupBtn').onclick=group;$('#ungroupBtn').onclick=()=>{selectedObjects().forEach(o=>delete o.groupId);renderAll()};$('#uniteBtn').onclick=()=>booleanOp('unite');$('#subtractBtn').onclick=()=>booleanOp('subtract');$('#intersectBtn').onclick=()=>booleanOp('intersect');$('#excludeBtn').onclick=()=>booleanOp('exclude');$('#lockBtn').onclick=()=>{selectedObjects().forEach(o=>o.locked=!o.locked);renderAll()};$('#hideBtn').onclick=()=>{selectedObjects().forEach(o=>o.hidden=true);state.selected=[];renderAll()};$('#snapToggle').checked=state.snap;$('#snapToggle').onchange=e=>state.snap=e.target.checked;$('#gridSize').value=state.grid;$('#gridSize').onchange=e=>{state.grid=+e.target.value;render2d()};$('#clearProjectBtn').onclick=()=>{if(confirm('Clear the entire project?')){snapshot();state.objects=[];state.selected=[];renderAll();closePanel()}} }
 if(name==='measure'){const result=$('#measureResult');if(result&&state.lastMeasurement)result.textContent=`${state.lastMeasurement.distance.toFixed(3)} ${state.unit}`;$('#measureModeBtn').onclick=()=>{state.measureMode=true;state.measurePts=[];state.lastMeasurement=null;closePanel();toast('Tap two points to measure')}};
}
function ensureLayer(name){if(!state.layers.some(l=>l.name===name))state.layers.push({name,visible:true,locked:false,color:`hsl(${Math.random()*360} 60% 50%)`})}
function renderLayerPanel(){const host=$('#layerPanelList');if(!host)return;const icon=l=>l.locked?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v8A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>`:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 10V7a5 5 0 0 0-9.9-1H9.2A3 3 0 0 1 15 7v3H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17Z"/></svg>`;host.innerHTML=state.layers.map((l,i)=>`<div class="layer-row"><input type="checkbox" data-vis="${i}" ${l.visible?'checked':''}><span><i class="layer-dot" style="background:${l.color};display:inline-block;margin-right:7px"></i>${l.name}</span><button class="layer-lock ${l.locked?'is-locked':''}" data-lock="${i}" aria-label="${l.locked?'Unlock':'Lock'} ${l.name}">${icon(l)}</button></div>`).join('');$$('[data-vis]',host).forEach(x=>x.onchange=()=>{state.layers[+x.dataset.vis].visible=x.checked;renderAll()});$$('[data-lock]',host).forEach(x=>x.onclick=()=>{const l=state.layers[+x.dataset.lock];l.locked=!l.locked;state.objects.filter(o=>o.layer===l.name).forEach(o=>o.locked=l.locked);renderLayerPanel();renderAll()})}
function updateReadout(){const s=selectedObjects();if(!s.length)$('#selectionReadout').textContent='Cabin Rebuild Mapper';else if(s.length===1){const o=s[0];$('#selectionReadout').textContent=`${o.w.toFixed(3)} × ${o.h.toFixed(3)} ${o.unit||state.unit}   X:${o.x.toFixed(3)} Y:${o.y.toFixed(3)}`}else $('#selectionReadout').textContent=`${s.length} objects selected`}
function renderParts(){const q=($('#partsSearch')?.value||'').toLowerCase();const rows=state.objects.filter(o=>!o.parentId).filter(o=>`${o.label} ${o.layer} ${o.material}`.toLowerCase().includes(q));$('#partsTable').innerHTML=rows.length?rows.map(o=>`<article class="part-card" data-id="${o.id}"><h3>${o.label||'Unlabeled part'}</h3><div class="part-meta"><span>${o.w} × ${o.h} × ${o.depth} ${o.unit||state.unit}</span><span>${o.material}</span><span>${o.layer}</span><span>${o.hidden?'Hidden':''}${o.locked?' Locked':''}</span></div>${o.notes?`<p>${o.notes}</p>`:''}</article>`).join(''):'<p>No parts yet.</p>';$$('.part-card').forEach(c=>c.onclick=()=>{state.selected=[c.dataset.id];switchView('design');renderAll()})}

let renderer,scene,camera,controls,transform,meshMap=new Map();
function init3d(){const host=$('#threeHost');renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(renderer.domElement);scene=new THREE.Scene();scene.background=new THREE.Color(0xd8dcdf);camera=new THREE.PerspectiveCamera(45,1,.1,500);camera.position.set(13,11,13);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;scene.add(new THREE.HemisphereLight(0xffffff,0x56606a,2.5));const dl=new THREE.DirectionalLight(0xffffff,2);dl.position.set(8,15,10);scene.add(dl);const grid=new THREE.GridHelper(40,40,0x8c9499,0xbac0c4);scene.add(grid);transform=new TransformControls(camera,renderer.domElement);transform.addEventListener('dragging-changed',e=>controls.enabled=!e.value);transform.addEventListener('objectChange',()=>{const mesh=transform.object;if(!mesh)return;const o=state.objects.find(x=>x.id===mesh.userData.id);if(o){o.x=mesh.position.x;o.y=mesh.position.z;o.depth=Math.max(.01,mesh.scale.y*mesh.geometry.parameters.height);o.rot=-mesh.rotation.y;render2d();renderParts()}});scene.add(transform);renderer.domElement.addEventListener('pointerdown',pick3d);animate3d();resize3d()}
function shapeGeometry(o){if(o.type==='circle'||o.type==='log')return new THREE.CylinderGeometry(o.w/2,o.w/2,o.depth,32);return new THREE.BoxGeometry(o.w,o.depth,o.h)}
function sync3d(){if(!scene)return;for(const m of meshMap.values())scene.remove(m);meshMap.clear();for(const o of state.objects.filter(x=>!x.hidden&&!x.parentId)){const mat=new THREE.MeshStandardMaterial({color:o.color||'#8b6b45',roughness:.8});const mesh=new THREE.Mesh(shapeGeometry(o),mat);mesh.position.set(o.x,o.depth/2,o.y);mesh.rotation.y=-(o.rot||0);mesh.userData.id=o.id;scene.add(mesh);meshMap.set(o.id,mesh)}const selected=selectedObjects()[0];if(selected&&meshMap.has(selected.id))transform.attach(meshMap.get(selected.id));else transform.detach()}
function pick3d(e){const r=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1),ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects([...meshMap.values()])[0];if(hit){state.selected=[hit.object.userData.id];transform.attach(hit.object);render2d();updateReadout()}}
function animate3d(){requestAnimationFrame(animate3d);controls?.update();renderer?.render(scene,camera)}
function resize3d(){if(!renderer)return;const host=$('#threeHost'),w=host.clientWidth||1,h=host.clientHeight||1;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
function fit3d(){if(!state.objects.length)return;const box=new THREE.Box3();for(const m of meshMap.values())box.expandByObject(m);const size=box.getSize(new THREE.Vector3()).length(),center=box.getCenter(new THREE.Vector3());controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size*.8,size*.65,size*.8));camera.lookAt(center)}

function switchView(v){state.activeView=v;$$('.view').forEach(x=>x.classList.toggle('active',x.id===`${v}View`));$$('.view-tab').forEach(x=>x.classList.toggle('active',x.dataset.view===v));if(v==='assembly'){sync3d();setTimeout(resize3d,30)}if(v==='parts')renderParts()}
function renderAll(){render2d();renderParts();sync3d();}

$$('.bottom-toolbar button').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));$('#closeSheet').onclick=closePanel;$('#sheetBackdrop').onclick=closePanel;
$$('.view-tab').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#processBtn').onclick=()=>switchView(state.activeView==='assembly'?'design':'assembly');
$('#saveBtn').onclick=saveLocal;$('#undoBtn').onclick=()=>{if(!state.undo.length)return;state.redo.push(JSON.stringify({objects:state.objects,layers:state.layers}));restore(state.undo.pop())};$('#redoBtn').onclick=()=>{if(!state.redo.length)return;state.undo.push(JSON.stringify({objects:state.objects,layers:state.layers}));restore(state.redo.pop())};
$('#centerBtn').onclick=()=>{state.panX=70;state.panY=55;state.zoom=42;render2d()};$('#backBtn').onclick=()=>history.length>1?history.back():toast('Project stays saved on this device');
$('#partsSearch').oninput=renderParts;$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,objects:state.objects,layers:state.layers},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cabin-rebuild-project.json';a.click();URL.revokeObjectURL(a.href)};
$('#importInput').onchange=async e=>{try{snapshot();const d=JSON.parse(await e.target.files[0].text());state.objects=d.objects||[];state.layers=d.layers||state.layers;renderAll();saveLocal()}catch{alert('That project file could not be read.')}};
$$('.three-tools [data-mode]').forEach(b=>b.onclick=()=>{$$('.three-tools [data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');transform.setMode(b.dataset.mode)});$('#fit3dBtn').onclick=fit3d;

document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate()}if(e.key==='Delete'||e.key==='Backspace'){if(!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))removeSelected()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveLocal()}});

loadLocal();init3d();resize();renderAll();

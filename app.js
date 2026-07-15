import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const state = {
  objects: [], selected: [], layers: [{name:'Front Wall', visible:true, locked:false, color:'#22c44b'}],
  unit:'ft', zoom:42, panX:70, panY:55, snap:true, grid:0.5, undo:[], redo:[],
  activeView:'design', measureMode:false, measurePts:[], lastMeasurement:null, marquee:null, customShapes:[], projectName:'Untitled Project', activeLayer:'Front Wall'
};

const canvas = $('#designCanvas'), ctx = canvas.getContext('2d');
const topRuler = $('#topRuler'), tr = topRuler.getContext('2d');
const leftRuler = $('#leftRuler'), lr = leftRuler.getContext('2d');
let drag = null;

function snapshot(){ state.undo.push(JSON.stringify({objects:state.objects,layers:state.layers})); if(state.undo.length>60)state.undo.shift(); state.redo=[]; }
function restore(raw){ const d=JSON.parse(raw); state.objects=d.objects||[]; state.layers=d.layers||state.layers; state.selected=[]; renderAll(); }
const PROJECTS_KEY='cabin-rebuild-mapper-projects-v1';
function projectPayload(){return{version:5,name:state.projectName,objects:state.objects,layers:state.layers,activeLayer:state.activeLayer,grid:state.grid,snap:state.snap,customShapes:state.customShapes,unit:state.unit}}
function getSavedProjects(){try{return JSON.parse(localStorage.getItem(PROJECTS_KEY)||'{}')}catch{return{}}}
function setSavedProjects(projects){localStorage.setItem(PROJECTS_KEY,JSON.stringify(projects))}
function saveLocal(forceName=false){
  let name=(state.projectName||'').trim();
  if(forceName||!name||name==='Untitled Project'){
    const entered=prompt('Project name',name==='Untitled Project'?'':name);
    if(entered===null)return false;
    name=entered.trim()||'Untitled Project';
  }
  state.projectName=name;
  const projects=getSavedProjects();projects[name]={...projectPayload(),savedAt:new Date().toISOString()};setSavedProjects(projects);
  toast(`Saved: ${name}`);return true;
}
function loadProject(name){const d=getSavedProjects()[name];if(!d)return toast('Saved project not found');Object.assign(state,d);state.projectName=name;state.layers=(state.layers||[]).map(l=>({...l,opacity:l.opacity??1}));state.activeLayer=(state.layers.some(l=>l.name===state.activeLayer)?state.activeLayer:state.layers[0]?.name)||'Front Wall';state.objects=(state.objects||[]).map((o,i)=>({...o,name:o.name||o.label||`Part ${i+1}`,opacity:o.opacity??1}));state.selected=[];state.undo=[];state.redo=[];renderAll();closePanel();toast(`Loaded: ${name}`)}
function newProject(){state.objects=[];state.selected=[];state.layers=[{name:'Front Wall',visible:true,locked:false,color:'#22c44b',opacity:1}];state.activeLayer='Front Wall';state.projectName='Untitled Project';state.undo=[];state.redo=[];state.lastMeasurement=null;renderAll();closePanel();toast('New blank project')}
function loadLocal(){
  // Projects intentionally open blank. Preserve one legacy build as a recoverable saved project.
  try{const legacy=JSON.parse(localStorage.getItem('cabin-rebuild-mapper-v25')||localStorage.getItem('cabin-rebuild-mapper-v2'));if(legacy){const projects=getSavedProjects();if(!projects['Recovered Project']){projects['Recovered Project']={...legacy,name:'Recovered Project',savedAt:new Date().toISOString()};setSavedProjects(projects)}}}catch{}
  state.layers=state.layers.map(l=>({...l,opacity:l.opacity??1}));state.activeLayer=(state.layers.some(l=>l.name===state.activeLayer)?state.activeLayer:state.layers[0]?.name)||'Front Wall';
}
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
const rasterImageCache=new Map();
function getRasterImage(src){
  if(!src)return null;
  let img=rasterImageCache.get(src);
  if(!img){
    img=new Image();
    img.onload=()=>render2d();
    img.src=src;
    rasterImageCache.set(src,img);
  }
  return img;
}
function pathWorld(c,type,w,h){
  c.beginPath();
  if(type==='circle'||type==='log')c.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
  else if(type==='triangle'){c.moveTo(0,-h/2);c.lineTo(w/2,h/2);c.lineTo(-w/2,h/2);c.closePath();}
  else if(type==='trapezoid'){c.moveTo(-w*.32,-h/2);c.lineTo(w*.32,-h/2);c.lineTo(w/2,h/2);c.lineTo(-w/2,h/2);c.closePath();}
  else if(type==='wedge'){c.moveTo(-w/2,h/2);c.lineTo(w/2,h/2);c.lineTo(w/2,-h/2);c.closePath();}
  else c.rect(-w/2,-h/2,w,h);
}
function objectLocalCanvas(o,pxPerUnit=96){
  const maxPx=1800;
  let scale=Math.max(20,pxPerUnit);
  scale=Math.min(scale,maxPx/Math.max(.01,o.w),maxPx/Math.max(.01,o.h));
  const pad=4;
  const out=document.createElement('canvas');
  out.width=Math.max(2,Math.ceil(o.w*scale)+pad*2);
  out.height=Math.max(2,Math.ceil(o.h*scale)+pad*2);
  const c=out.getContext('2d');
  c.setTransform(scale,0,0,scale,out.width/2,out.height/2);
  if(o.rasterData){
    const img=getRasterImage(o.rasterData);
    if(img?.complete&&img.naturalWidth)c.drawImage(img,-o.w/2,-o.h/2,o.w,o.h);
  }else if(o.operation==='compound'&&o.compoundParts?.length){
    const sourceW=o.sourceW||o.w||1,sourceH=o.sourceH||o.h||1,sx=o.w/sourceW,sy=o.h/sourceH;
    for(const part of o.compoundParts){
      c.save();
      c.globalCompositeOperation=part.mode||'source-over';
      c.translate((part.x||0)*sx,(part.y||0)*sy);
      c.rotate(part.rot||0);
      pathWorld(c,part.type,(part.w||1)*sx,(part.h||1)*sy);
      c.fillStyle='#000';c.fill();c.restore();
    }
  }else{
    pathWorld(c,o.type,o.w,o.h);c.fillStyle='#000';c.fill();
  }
  return out;
}
function drawObjectIntoWorldCanvas(c,o,mode,bounds,scale){
  const local=objectLocalCanvas(o,scale);
  c.save();
  c.globalCompositeOperation=mode;
  c.translate((o.x-bounds.minX)*scale,(o.y-bounds.minY)*scale);
  c.rotate(o.rot||0);
  c.drawImage(local,-o.w*scale/2,-o.h*scale/2,o.w*scale,o.h*scale);
  c.restore();
}
function rasterizeBoolean(sel,op,bounds){
  const maxPx=1800;
  const w=Math.max(.01,bounds.maxX-bounds.minX),h=Math.max(.01,bounds.maxY-bounds.minY);
  let scale=Math.min(128,maxPx/w,maxPx/h);scale=Math.max(24,scale);
  const out=document.createElement('canvas');out.width=Math.max(2,Math.ceil(w*scale));out.height=Math.max(2,Math.ceil(h*scale));
  const c=out.getContext('2d');
  if(op==='subtract'){
    drawObjectIntoWorldCanvas(c,sel[0],'source-over',bounds,scale);
    sel.slice(1).forEach(o=>drawObjectIntoWorldCanvas(c,o,'destination-out',bounds,scale));
  }else if(op==='intersect'){
    drawObjectIntoWorldCanvas(c,sel[0],'source-over',bounds,scale);
    sel.slice(1).forEach(o=>drawObjectIntoWorldCanvas(c,o,'destination-in',bounds,scale));
  }else if(op==='exclude'){
    drawObjectIntoWorldCanvas(c,sel[0],'source-over',bounds,scale);
    sel.slice(1).forEach(o=>drawObjectIntoWorldCanvas(c,o,'xor',bounds,scale));
  }else sel.forEach(o=>drawObjectIntoWorldCanvas(c,o,'source-over',bounds,scale));
  return out.toDataURL('image/png');
}
function drawCompoundObject(o,p){
  if(o.rasterData){
    const img=getRasterImage(o.rasterData);
    if(img?.complete&&img.naturalWidth){
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);
      ctx.drawImage(img,-o.w*state.zoom/2,-o.h*state.zoom/2,o.w*state.zoom,o.h*state.zoom);
      ctx.restore();
    }
    return;
  }
  const pad=28;
  const width=Math.max(2,Math.ceil(o.w*state.zoom+pad*2));
  const height=Math.max(2,Math.ceil(o.h*state.zoom+pad*2));
  const off=document.createElement('canvas'); off.width=width; off.height=height;
  const oc=off.getContext('2d');
  oc.translate(width/2,height/2);
  const sourceW=o.sourceW||o.w||1, sourceH=o.sourceH||o.h||1;
  const sx=o.w/sourceW, sy=o.h/sourceH;
  const drawPart=(part)=>{
    oc.save();oc.globalCompositeOperation=part.mode||'source-over';
    oc.translate((part.x||0)*sx*state.zoom,(part.y||0)*sy*state.zoom);oc.rotate(part.rot||0);
    const temp={...part,w:(part.w||1)*sx,h:(part.h||1)*sy};pathFor(temp,oc);
    oc.fillStyle=part.color||o.color||'#8b6b45';oc.fill();oc.restore();
  };
  for(const part of o.compoundParts||[]) drawPart(part);
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);ctx.drawImage(off,-width/2,-height/2);ctx.restore();
}
function drawObject(o){
  const layer=state.layers.find(l=>l.name===o.layer); if(layer && !layer.visible)return;
  ctx.save();ctx.globalAlpha=(o.opacity??1)*(layer?.opacity??1);
  const p=worldToScreen(o.x,o.y);
  if(o.operation==='compound') drawCompoundObject(o,p);
  else {ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.rot||0);pathFor(o);ctx.fillStyle=o.color||'#8b6b45';ctx.fill();ctx.strokeStyle='#45494c';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}
  if(o.label){ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle='#111';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(o.label,0,4);ctx.restore();}
  if(state.selected.includes(o.id)) drawSelection(o);
  ctx.restore();
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

function addObject(type='rect',data={}){snapshot();const i=state.objects.length+1,o={id:uid(),type,name:data.name||data.label||`Part ${i}`,label:data.label||`P-${String(i).padStart(3,'0')}`,x:data.x??4,y:data.y??4,w:+(data.w??4),h:+(data.h??1),depth:+(data.depth??1),rot:0,color:data.color||'#8b6b45',material:data.material||'Wood',layer:data.layer||state.activeLayer||'Front Wall',notes:data.notes||'',unit:data.unit||state.unit,opacity:data.opacity??1,hidden:false,locked:false};state.objects.push(o);state.selected=[o.id];renderAll();return o}
function selectedObjects(){return state.selected.map(id=>state.objects.find(o=>o.id===id)).filter(Boolean)}
function duplicate(){const sel=selectedObjects();if(!sel.length)return;snapshot();state.selected=[];for(const o of sel){const n={...structuredClone(o),id:uid(),x:o.x+.5,y:o.y+.5,label:o.label};delete n.parentId;state.objects.push(n);state.selected.push(n.id)}renderAll()}
function removeSelected(){if(!state.selected.length)return;snapshot();state.objects=state.objects.filter(o=>!state.selected.includes(o.id));state.selected=[];renderAll()}
function objectCorners(o){
  const c=Math.cos(o.rot||0),s=Math.sin(o.rot||0),hw=o.w/2,hh=o.h/2;
  return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y])=>({x:o.x+x*c-y*s,y:o.y+x*s+y*c}));
}
function objectBounds(o){const pts=objectCorners(o);return{minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxY:Math.max(...pts.map(p=>p.y))}}
function shapeRecordsInWorld(o,mode='source-over'){
  if(o.operation!=='compound'||!o.compoundParts?.length){return[{type:o.type,x:o.x,y:o.y,w:o.w,h:o.h,rot:o.rot||0,color:o.color,mode}]}
  const sourceW=o.sourceW||o.w||1,sourceH=o.sourceH||o.h||1,sx=o.w/sourceW,sy=o.h/sourceH,c=Math.cos(o.rot||0),s=Math.sin(o.rot||0);
  return o.compoundParts.map(part=>{
    const lx=(part.x||0)*sx,ly=(part.y||0)*sy;
    return{...structuredClone(part),x:o.x+lx*c-ly*s,y:o.y+lx*s+ly*c,w:(part.w||1)*sx,h:(part.h||1)*sy,rot:(part.rot||0)+(o.rot||0),mode:mode==='destination-out'?'destination-out':(part.mode||mode)};
  });
}
function booleanOp(op){
  const sel=selectedObjects(); if(sel.length<2){toast('Select at least two objects');return}
  snapshot();
  const base=sel[0];
  let bounds;
  if(op==='subtract') bounds=objectBounds(base);
  else{
    const all=sel.map(objectBounds);
    bounds={minX:Math.min(...all.map(b=>b.minX)),maxX:Math.max(...all.map(b=>b.maxX)),minY:Math.min(...all.map(b=>b.minY)),maxY:Math.max(...all.map(b=>b.maxY))};
  }
  const cx=(bounds.minX+bounds.maxX)/2,cy=(bounds.minY+bounds.maxY)/2;
  const w=Math.max(.01,bounds.maxX-bounds.minX),h=Math.max(.01,bounds.maxY-bounds.minY);
  const rasterData=rasterizeBoolean(sel,op,bounds);
  const n={...structuredClone(base),id:uid(),x:cx,y:cy,w,h,sourceW:w,sourceH:h,rot:0,operation:'compound',compoundParts:[],rasterData,name:base.name,label:base.label};
  delete n.parentId;delete n.children;delete n.holes;
  state.objects=state.objects.filter(o=>!sel.includes(o));state.objects.push(n);state.selected=[n.id];
  toast(`${op[0].toUpperCase()+op.slice(1)} created as a new movable shape`);renderAll();
}
function group(){const sel=selectedObjects();if(sel.length<2)return toast('Select multiple parts first');snapshot();const gid=uid();sel.forEach(o=>o.groupId=gid);toast('Parts fastened/grouped');renderAll()}
function applyMaterial(name,color){selectedObjects().forEach(o=>{o.material=name;o.color=color});renderAll()}

const panelTemplates={shapes:'shapePanelTemplate',parts:'partsPanelTemplate',labels:'labelsPanelTemplate',layers:'layersPanelTemplate',materials:'materialsPanelTemplate',projects:'projectsPanelTemplate',settings:'settingsPanelTemplate',measure:'measurePanelTemplate'};
function openPanel(name){const id=panelTemplates[name];if(!id)return;$('#sheetTitle').textContent=name[0].toUpperCase()+name.slice(1);$('#sheetContent').innerHTML='';$('#sheetContent').append($('#'+id).content.cloneNode(true));$('#toolSheet').classList.add('open');$('#sheetBackdrop').classList.add('open');$('#toolSheet').setAttribute('aria-hidden','false');$$('.bottom-toolbar button').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));wirePanel(name)}
function closePanel(){$('#toolSheet').classList.remove('open');$('#sheetBackdrop').classList.remove('open');$('#toolSheet').setAttribute('aria-hidden','true');$$('.bottom-toolbar button').forEach(b=>b.classList.remove('active'))}
function wirePanel(name){
 if(name==='shapes'){
   $$('[data-shape]',$('#sheetContent')).forEach(b=>b.onclick=()=>{const map={rect:[4,1],beam:[6,.5],log:[4,1],triangle:[3,3],trapezoid:[4,2],circle:[2,2],wedge:[3,2],panel:[4,4]};addObject(b.dataset.shape,{w:map[b.dataset.shape][0],h:map[b.dataset.shape][1]});closePanel()});
   const showTab=tab=>{const custom=tab==='custom';$('#builtinShapeGrid').hidden=custom;$('#customShapePanel').hidden=!custom;$$('[data-shape-tab]',$('#sheetContent')).forEach(x=>x.classList.toggle('active',x.dataset.shapeTab===tab));if(custom)renderCustomShapes()};
   $$('[data-shape-tab]',$('#sheetContent')).forEach(b=>b.onclick=()=>showTab(b.dataset.shapeTab));
   $('#saveCustomShapeBtn').onclick=saveSelectedCustomShape;
 }
 if(name==='parts'){
   const selected=selectedObjects();
   const o=selected.length===1?selected[0]:null;
   const button=$('#addPartBtn');
   const colorInput=$('#partColor');
   const colorTrigger=$('#partColorTrigger');
   let liveSnapshotTaken=false;
   let saveTimer=null;

   const beginLiveEdit=()=>{
     if(!o||liveSnapshotTaken)return;
     snapshot();
     liveSnapshotTaken=true;
   };
   const scheduleSave=()=>{
     clearTimeout(saveTimer);
     saveTimer=setTimeout(()=>saveLocal(),250);
   };
   const liveUpdate=(field,value,{render=true}={})=>{
     if(!o)return;
     beginLiveEdit();
     o[field]=value;
     if(field==='unit')state.unit=value;
     if(field==='layer'){
       ensureLayer(value||'Unassigned');
       state.activeLayer=value||'Unassigned';
     }
     if(render)renderAll();
     scheduleSave();
   };

   if(o){
     $('#partName').value=o.name||'';
     $('#partLabel').value=o.label||'';
     $('#partLength').value=o.w??'';
     $('#partHeight').value=o.h??'';
     $('#partDepth').value=o.depth??'';
     $('#partUnits').value=o.unit||state.unit;
     $('#partLayer').value=o.layer||state.activeLayer||'';
     $('#partMaterial').value=o.material||'';
     colorInput.value=o.color||'#8b6b45';
     colorTrigger.querySelector('i').style.background=colorInput.value;
     colorTrigger.querySelector('span').textContent=colorInput.value.toUpperCase();
     $('#partOpacity').value=Math.round((o.opacity??1)*100);
     $('#partOpacityValue').textContent=`${$('#partOpacity').value}%`;
     $('#partNotes').value=o.notes||'';
     button.textContent='Done';
     button.classList.remove('primary');
   }else if(selected.length>1){
     button.textContent=`${selected.length} Parts Selected`;
     button.disabled=true;
     toast('Select one part to edit its name and properties');
   }else{
     $('#partName').value='';
     $('#partLabel').value='';
     $('#partNotes').value='';
     $('#partOpacity').value=100;
     $('#partOpacityValue').textContent='100%';
     $('#partLayer').value=state.activeLayer||state.layers[0]?.name||'Front Wall';
     button.textContent='Create Part';
   }

   wireColorTrigger('#partColorTrigger','#partColor',color=>liveUpdate('color',color));

   if(o){
     $('#partName').oninput=e=>liveUpdate('name',e.target.value,{render:false});
     $('#partLabel').oninput=e=>liveUpdate('label',e.target.value,{render:false});
     $('#partLength').oninput=e=>liveUpdate('w',Math.max(.01,+e.target.value||.01));
     $('#partHeight').oninput=e=>liveUpdate('h',Math.max(.01,+e.target.value||.01));
     $('#partDepth').oninput=e=>liveUpdate('depth',Math.max(.01,+e.target.value||.01));
     $('#partUnits').onchange=e=>liveUpdate('unit',e.target.value);
     $('#partLayer').onchange=e=>liveUpdate('layer',e.target.value.trim()||'Unassigned');
     $('#partMaterial').oninput=e=>liveUpdate('material',e.target.value,{render:false});
     $('#partNotes').oninput=e=>liveUpdate('notes',e.target.value,{render:false});
   }

   $('#partOpacity').oninput=e=>{
     $('#partOpacityValue').textContent=`${e.target.value}%`;
     if(o)liveUpdate('opacity',Math.max(0,Math.min(1,(+e.target.value||0)/100)));
   };

   button.onclick=()=>{
     if(button.disabled)return;
     if(o){
       saveLocal();
       closePanel();
       toast('Live changes saved');
       return;
     }
     const unit=$('#partUnits').value;
     const values={
       name:$('#partName').value.trim(),label:$('#partLabel').value.trim(),
       w:Math.max(.01,+$('#partLength').value||.01),h:Math.max(.01,+$('#partHeight').value||.01),
       depth:Math.max(.01,+$('#partDepth').value||.01),layer:$('#partLayer').value.trim()||'Unassigned',
       material:$('#partMaterial').value.trim()||'Wood',color:$('#partColor').value,
       opacity:Math.max(0,Math.min(1,(+$('#partOpacity').value||0)/100)),
       notes:$('#partNotes').value,unit
     };
     state.unit=unit;
     ensureLayer(values.layer);
     state.activeLayer=values.layer;
     addObject('rect',values);
     toast('Part created');
     closePanel();
   };
 }
 if(name==='labels'){const o=selectedObjects()[0];$('#editName').value=o?.name||'';$('#editLabel').value=o?.label||'';$('#editNotes').value=o?.notes||'';$('#applyLabelBtn').onclick=()=>{selectedObjects().forEach(x=>{x.name=$('#editName').value;x.label=$('#editLabel').value;x.notes=$('#editNotes').value});renderAll();closePanel()}}
 if(name==='layers'){renderLayerPanel();$('#addLayerBtn').onclick=()=>{const n=prompt('Layer name');if(n){ensureLayer(n);state.activeLayer=n;renderLayerPanel();renderAll();toast(`Active layer: ${n}`)}}}
 if(name==='materials'){$$('[data-material]',$('#sheetContent')).forEach(b=>b.onclick=()=>{applyMaterial(b.dataset.material,b.dataset.color);closePanel()});wireColorTrigger('#customMaterialColorTrigger','#customMaterialColor',color=>applyMaterial('Custom',color))}
 if(name==='projects'){wireProjectsPanel()}
 if(name==='settings'){ $('#duplicateBtn').onclick=duplicate;$('#deleteBtn').onclick=removeSelected;$('#groupBtn').onclick=group;$('#ungroupBtn').onclick=()=>{selectedObjects().forEach(o=>delete o.groupId);renderAll()};$('#uniteBtn').onclick=()=>booleanOp('unite');$('#subtractBtn').onclick=()=>booleanOp('subtract');$('#intersectBtn').onclick=()=>booleanOp('intersect');$('#excludeBtn').onclick=()=>booleanOp('exclude');$('#lockBtn').onclick=()=>{selectedObjects().forEach(o=>o.locked=!o.locked);renderAll()};$('#hideBtn').onclick=()=>{selectedObjects().forEach(o=>o.hidden=true);state.selected=[];renderAll()};$('#snapToggle').checked=state.snap;$('#snapToggle').onchange=e=>state.snap=e.target.checked;$('#gridSize').value=state.grid;$('#gridSize').onchange=e=>{state.grid=+e.target.value;render2d()};$('#clearProjectBtn').onclick=()=>{if(confirm('Clear the entire project?')){snapshot();state.objects=[];state.selected=[];renderAll();closePanel()}} }
 if(name==='measure'){const result=$('#measureResult');if(result&&state.lastMeasurement)result.textContent=`${state.lastMeasurement.distance.toFixed(3)} ${state.unit}`;$('#measureModeBtn').onclick=()=>{state.measureMode=true;state.measurePts=[];state.lastMeasurement=null;closePanel();toast('Tap two points to measure')}};
}

function saveSelectedCustomShape(){
  const o=selectedObjects()[0];
  if(!o)return toast('Select one finished shape first');
  const saved={...structuredClone(o),id:uid(),name:o.name||o.label||'Custom shape',x:0,y:0,rot:0,opacity:o.opacity??1,hidden:false,locked:false};
  delete saved.groupId; delete saved.parentId;
  state.customShapes=state.customShapes||[];
  state.customShapes.push(saved);
  saveLocal();renderCustomShapes();toast('Custom shape saved');
}
function renderCustomShapes(){
  const host=$('#customShapeGrid');if(!host)return;
  host.innerHTML=(state.customShapes||[]).map((o,i)=>`<button data-custom-shape="${i}"><i class="custom-shape-preview" style="background:${o.color||'#8b6b45'}"></i><b>${escapeHtml(o.name||o.label||`Custom ${i+1}`)}</b></button>`).join('');
  $$('[data-custom-shape]',host).forEach(b=>b.onclick=()=>{const t=structuredClone(state.customShapes[+b.dataset.customShape]);snapshot();t.id=uid();t.x=4;t.y=4;t.hidden=false;t.locked=false;state.objects.push(t);state.selected=[t.id];renderAll();closePanel()});
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

let colorPickerCommit=null,colorHSV={h:30,s:.5,v:.55,a:100};
function wireColorTrigger(triggerSel,inputSel,onSet){const trigger=$(triggerSel),input=$(inputSel);if(!trigger||!input)return;const update=color=>{input.value=color;trigger.querySelector('i').style.background=color;trigger.querySelector('span').textContent=color.toUpperCase();onSet?.(color)};trigger.onclick=()=>openColorPicker(input.value,update)}
function openColorPicker(color,commit){colorPickerCommit=commit;const rgb=hexToRgb(color)||{r:139,g:107,b:69};const hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);colorHSV={...hsv,a:100};$('#colorPickerBackdrop').hidden=false;$('#colorPickerDialog').hidden=false;syncColorPicker()}
function closeColorPicker(){ $('#colorPickerBackdrop').hidden=true;$('#colorPickerDialog').hidden=true;colorPickerCommit=null }
function syncColorPicker(){const rgb=hsvToRgb(colorHSV.h,colorHSV.s,colorHSV.v),hex=rgbToHex(rgb.r,rgb.g,rgb.b);$('#svPicker').style.background=`linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${colorHSV.h} 100% 50%))`;$('#svCursor').style.left=`${colorHSV.s*100}%`;$('#svCursor').style.top=`${(1-colorHSV.v)*100}%`;$('#hueSlider').value=colorHSV.h;$('#alphaSlider').value=colorHSV.a;$('#hexColor').value=hex.slice(1).toUpperCase();$('#redColor').value=rgb.r;$('#greenColor').value=rgb.g;$('#blueColor').value=rgb.b;$('#alphaColor').value=colorHSV.a;$('#chosenColor').style.background=hex}
function setSV(e){const r=$('#svPicker').getBoundingClientRect();colorHSV.s=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));colorHSV.v=1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));syncColorPicker()}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('')}
function hexToRgb(hex){const m=String(hex).replace('#','').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:null}
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4)}if(h<0)h+=360;return{h,s:max?d/max:0,v:max}}
function hsvToRgb(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else [r,g,b]=[c,0,x];return{r:(r+m)*255,g:(g+m)*255,b:(b+m)*255}}

function ensureLayer(name){if(!state.layers.some(l=>l.name===name))state.layers.push({name,visible:true,locked:false,color:`hsl(${Math.random()*360} 60% 50%)`,opacity:1})}
function renderLayerPanel(){
  const host=$('#layerPanelList');if(!host)return;state.layers.forEach(l=>l.opacity=l.opacity??1);
  const icon=l=>l.locked?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v8A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>`:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 10V7a5 5 0 0 0-9.9-1H9.2A3 3 0 0 1 15 7v3H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17Z"/></svg>`;
  host.innerHTML=state.layers.map((l,i)=>`<div class="layer-row ${l.name===state.activeLayer?'active-layer':''}"><input type="checkbox" data-vis="${i}" ${l.visible?'checked':''}><button type="button" class="layer-name-button" data-active-layer="${i}" aria-current="${l.name===state.activeLayer?'true':'false'}"><i class="layer-dot" style="background:${l.color}"></i><span>${escapeHtml(l.name)}</span><small>${l.name===state.activeLayer?'<strong>✓ ACTIVE</strong> · ':''}${Math.round(l.opacity*100)}%</small></button><button class="layer-lock ${l.locked?'is-locked':''}" data-lock="${i}" aria-label="${l.locked?'Unlock':'Lock'} ${escapeHtml(l.name)}">${icon(l)}</button><label class="layer-opacity"><b>Opacity</b><input type="range" min="0" max="100" value="${Math.round(l.opacity*100)}" data-opacity="${i}"><output>${Math.round(l.opacity*100)}%</output></label></div>`).join('');
  $$('[data-active-layer]',host).forEach(x=>x.onclick=()=>{state.activeLayer=state.layers[+x.dataset.activeLayer].name;renderLayerPanel();updateReadout();toast(`Active layer: ${state.activeLayer}`)});
  $$('[data-vis]',host).forEach(x=>x.onchange=()=>{state.layers[+x.dataset.vis].visible=x.checked;renderAll()});
  $$('[data-lock]',host).forEach(x=>x.onclick=()=>{const l=state.layers[+x.dataset.lock];l.locked=!l.locked;state.objects.filter(o=>o.layer===l.name).forEach(o=>o.locked=l.locked);renderLayerPanel();renderAll()});
  $$('[data-opacity]',host).forEach(x=>x.oninput=()=>{state.layers[+x.dataset.opacity].opacity=+x.value/100;const row=x.closest('.layer-row'),small=row.querySelector('.layer-name-button small'),out=row.querySelector('output');if(small)small.innerHTML=`${state.layers[+x.dataset.opacity].name===state.activeLayer?'<strong>✓ ACTIVE</strong> · ':''}${x.value}%`;if(out)out.textContent=`${x.value}%`;renderAll()});
}
function wireProjectsPanel(){
  const nameInput=$('#projectNameInput'), select=$('#savedProjectSelect');
  nameInput.value=state.projectName==='Untitled Project'?'':(state.projectName||'');
  const render=()=>{
    const projects=getSavedProjects(),host=$('#savedProjectsList');
    const names=Object.keys(projects).sort((a,b)=>(projects[b].savedAt||'').localeCompare(projects[a].savedAt||''));
    select.innerHTML='<option value="">Choose a saved project…</option>'+names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    host.innerHTML=names.length?names.map(n=>`<div class="saved-project-row"><button class="project-load" data-load-project="${encodeURIComponent(n)}"><b>${escapeHtml(n)}</b><small>${projects[n].savedAt?new Date(projects[n].savedAt).toLocaleString():''}</small></button><button class="project-delete" data-delete-project="${encodeURIComponent(n)}" aria-label="Delete ${escapeHtml(n)}">×</button></div>`).join(''):'<p class="hint">No saved projects yet. Name this project above, then tap Save Project.</p>';
    $$('[data-load-project]',host).forEach(b=>b.onclick=()=>loadProject(decodeURIComponent(b.dataset.loadProject)));
    $$('[data-delete-project]',host).forEach(b=>b.onclick=()=>{const n=decodeURIComponent(b.dataset.deleteProject);if(confirm(`Delete saved project “${n}”?`)){const ps=getSavedProjects();delete ps[n];setSavedProjects(ps);render()}});
  };
  $('#saveProjectPanelBtn').onclick=()=>{
    const name=nameInput.value.trim();
    if(!name){nameInput.focus();return toast('Enter a project name first')}
    state.projectName=name;
    if(saveLocal())render();
  };
  $('#loadSelectedProjectBtn').onclick=()=>{if(!select.value)return toast('Choose a saved project first');loadProject(select.value)};
  $('#newProjectBtn').onclick=()=>{if(!state.objects.length||confirm('Start a new blank project? Unsaved changes will be lost.'))newProject()};
  $('#resetProjectBtn').onclick=()=>{if(confirm('Clear every object from the current project?')){snapshot();state.objects=[];state.selected=[];state.lastMeasurement=null;renderAll();toast('Current project cleared')}};
  render();
}
function updateReadout(){const s=selectedObjects();if(!s.length)$('#selectionReadout').textContent=state.projectName||'Untitled Project';else if(s.length===1){const o=s[0];$('#selectionReadout').textContent=`${o.w.toFixed(3)} × ${o.h.toFixed(3)} ${o.unit||state.unit}   X:${o.x.toFixed(3)} Y:${o.y.toFixed(3)}`}else $('#selectionReadout').textContent=`${s.length} objects selected`}
function renderParts(){const q=($('#partsSearch')?.value||'').toLowerCase();const rows=state.objects.filter(o=>!o.parentId).filter(o=>`${o.name||''} ${o.label} ${o.layer} ${o.material}`.toLowerCase().includes(q));$('#partsTable').innerHTML=rows.length?rows.map(o=>`<article class="part-card" data-id="${o.id}"><h3>${o.name||'Unnamed part'}</h3><div class="part-label">Label: ${o.label||'—'}</div><div class="part-meta"><span>${o.w} × ${o.h} × ${o.depth} ${o.unit||state.unit}</span><span>${o.material}</span><span>${o.layer}</span><span>${o.hidden?'Hidden':''}${o.locked?' Locked':''}</span></div>${o.notes?`<p>${o.notes}</p>`:''}</article>`).join(''):'<p>No parts yet.</p>';$$('.part-card').forEach(c=>c.onclick=()=>{state.selected=[c.dataset.id];switchView('design');renderAll()})}

let renderer,scene,camera,controls,transform,meshMap=new Map();
function init3d(){const host=$('#threeHost');renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(renderer.domElement);scene=new THREE.Scene();scene.background=new THREE.Color(0xd8dcdf);camera=new THREE.PerspectiveCamera(45,1,.1,500);camera.position.set(13,11,13);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;scene.add(new THREE.HemisphereLight(0xffffff,0x56606a,2.5));const dl=new THREE.DirectionalLight(0xffffff,2);dl.position.set(8,15,10);scene.add(dl);const grid=new THREE.GridHelper(40,40,0x8c9499,0xbac0c4);scene.add(grid);transform=new TransformControls(camera,renderer.domElement);transform.addEventListener('dragging-changed',e=>controls.enabled=!e.value);transform.addEventListener('objectChange',()=>{const mesh=transform.object;if(!mesh)return;const o=state.objects.find(x=>x.id===mesh.userData.id);if(o){o.x=mesh.position.x;o.y=mesh.position.z;o.depth=Math.max(.01,mesh.scale.y*mesh.geometry.parameters.height);o.rot=-mesh.rotation.y;render2d();renderParts()}});scene.add(transform);renderer.domElement.addEventListener('pointerdown',pick3d);animate3d();resize3d()}
function shapeGeometry(o){if(o.type==='circle'||o.type==='log')return new THREE.CylinderGeometry(o.w/2,o.w/2,o.depth,32);return new THREE.BoxGeometry(o.w,o.depth,o.h)}
function sync3d(){if(!scene)return;for(const m of meshMap.values())scene.remove(m);meshMap.clear();for(const o of state.objects.filter(x=>!x.hidden&&!x.parentId)){const layer=state.layers.find(l=>l.name===o.layer);const opacity=(o.opacity??1)*(layer?.opacity??1);const mat=new THREE.MeshStandardMaterial({color:o.color||'#8b6b45',roughness:.8,transparent:opacity<1,opacity,depthWrite:opacity>=1});const mesh=new THREE.Mesh(shapeGeometry(o),mat);mesh.position.set(o.x,o.depth/2,o.y);mesh.rotation.y=-(o.rot||0);mesh.userData.id=o.id;scene.add(mesh);meshMap.set(o.id,mesh)}const selected=selectedObjects()[0];if(selected&&meshMap.has(selected.id))transform.attach(meshMap.get(selected.id));else transform.detach()}
function pick3d(e){const r=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1),ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects([...meshMap.values()])[0];if(hit){state.selected=[hit.object.userData.id];transform.attach(hit.object);render2d();updateReadout()}}
function animate3d(){requestAnimationFrame(animate3d);controls?.update();renderer?.render(scene,camera)}
function resize3d(){if(!renderer)return;const host=$('#threeHost'),w=host.clientWidth||1,h=host.clientHeight||1;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
function fit3d(){if(!state.objects.length)return;const box=new THREE.Box3();for(const m of meshMap.values())box.expandByObject(m);const size=box.getSize(new THREE.Vector3()).length(),center=box.getCenter(new THREE.Vector3());controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size*.8,size*.65,size*.8));camera.lookAt(center)}

function switchView(v){state.activeView=v;$$('.view').forEach(x=>x.classList.toggle('active',x.id===`${v}View`));$$('.view-tab').forEach(x=>x.classList.toggle('active',x.dataset.view===v));if(v==='assembly'){sync3d();setTimeout(resize3d,30)}if(v==='parts')renderParts()}
function renderAll(){render2d();renderParts();sync3d();}

$$('.bottom-toolbar button[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));$('#closeSheet').onclick=closePanel;$('#sheetBackdrop').onclick=closePanel;
$('#imageUploadInput').onchange=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{snapshot();const maxWorld=8,ratio=img.naturalWidth/Math.max(1,img.naturalHeight);let w=ratio>=1?maxWorld:maxWorld*ratio,h=ratio>=1?maxWorld/ratio:maxWorld;const center=screenToWorld(canvas.clientWidth/2,canvas.clientHeight/2);const o={id:uid(),type:'image',operation:'compound',rasterData:reader.result,name:file.name.replace(/\.[^.]+$/,''),label:'',x:center.x,y:center.y,w,h,sourceW:w,sourceH:h,depth:.25,rot:0,color:'#ffffff',material:'Image',layer:state.activeLayer||state.layers[0]?.name||'Front Wall',unit:state.unit,opacity:1,notes:'Uploaded reference image'};state.objects.push(o);state.selected=[o.id];renderAll();toast('Image added to work area')};img.src=reader.result};reader.readAsDataURL(file);e.target.value=''};
$$('.view-tab').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#processBtn').onclick=()=>switchView(state.activeView==='assembly'?'design':'assembly');
$('#saveBtn').onclick=()=>openPanel('projects');$('#undoBtn').onclick=()=>{if(!state.undo.length)return;state.redo.push(JSON.stringify({objects:state.objects,layers:state.layers}));restore(state.undo.pop())};$('#redoBtn').onclick=()=>{if(!state.redo.length)return;state.undo.push(JSON.stringify({objects:state.objects,layers:state.layers}));restore(state.redo.pop())};
$('#centerBtn').onclick=()=>{state.panX=70;state.panY=55;state.zoom=42;render2d()};$('#backBtn').onclick=()=>history.length>1?history.back():toast('Project stays saved on this device');
$('#partsSearch').oninput=renderParts;$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,objects:state.objects,layers:state.layers},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cabin-rebuild-project.json';a.click();URL.revokeObjectURL(a.href)};
$('#importInput').onchange=async e=>{try{snapshot();const d=JSON.parse(await e.target.files[0].text());state.objects=d.objects||[];state.layers=d.layers||state.layers;renderAll();saveLocal()}catch{alert('That project file could not be read.')}};
$$('.three-tools [data-mode]').forEach(b=>b.onclick=()=>{$$('.three-tools [data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');transform.setMode(b.dataset.mode)});$('#fit3dBtn').onclick=fit3d;

document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate()}if(e.key==='Delete'||e.key==='Backspace'){if(!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))removeSelected()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveLocal()}});


const palette=['#D9002B','#F5A623','#FFE21B','#9A6531','#72D11C','#2C7510','#B50BD1','#7A0CF0','#1768C5','#43D6C0','#A9E77B','#000000','#4A4A4A','#999999','#FFFFFF'];
$('#colorSwatches').innerHTML=palette.map(c=>`<button style="background:${c}" data-swatch="${c}" aria-label="${c}"></button>`).join('');
$$('[data-swatch]',$('#colorSwatches')).forEach(b=>b.onclick=()=>{const rgb=hexToRgb(b.dataset.swatch),hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);colorHSV={...colorHSV,...hsv};syncColorPicker()});
$('#svPicker').addEventListener('pointerdown',e=>{$('#svPicker').setPointerCapture(e.pointerId);setSV(e)});$('#svPicker').addEventListener('pointermove',e=>{if($('#svPicker').hasPointerCapture(e.pointerId))setSV(e)});
$('#hueSlider').oninput=e=>{colorHSV.h=+e.target.value;syncColorPicker()};$('#alphaSlider').oninput=e=>{colorHSV.a=+e.target.value;syncColorPicker()};$('#alphaColor').oninput=e=>{colorHSV.a=Math.max(0,Math.min(100,+e.target.value));syncColorPicker()};
$('#hexColor').onchange=e=>{const rgb=hexToRgb('#'+e.target.value);if(rgb){colorHSV={...colorHSV,...rgbToHsv(rgb.r,rgb.g,rgb.b)};syncColorPicker()}};
for(const [id,key] of [['redColor','r'],['greenColor','g'],['blueColor','b']])$("#"+id).onchange=()=>{const r=+$('#redColor').value,g=+$('#greenColor').value,b=+$('#blueColor').value;colorHSV={...colorHSV,...rgbToHsv(r,g,b)};syncColorPicker()};
$('#setColorPicker').onclick=()=>{const rgb=hsvToRgb(colorHSV.h,colorHSV.s,colorHSV.v),hex=rgbToHex(rgb.r,rgb.g,rgb.b);colorPickerCommit?.(hex);closeColorPicker()};$('#cancelColorPicker').onclick=closeColorPicker;$('#closeColorPicker').onclick=closeColorPicker;$('#colorPickerBackdrop').onclick=closeColorPicker;

loadLocal();init3d();resize();renderAll();

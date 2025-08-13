// ===== LocalStorage keys =====
const LS_PHOTOS='peak_photos_v1', LS_SESSIONS='peak_sessions_v1', LS_THEME='peak_theme_v1',
      LS_LIGHT='peak_light_v1', LS_PRESETS='peak_presets_v1';

      /* ===== IndexedDB (photos) ===== */
const DB_NAME = 'peak-db', DB_VER = 1;
let dbPromise;
function openDB(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if (!db.objectStoreNames.contains('photos')){
        const os = db.createObjectStore('photos', { keyPath: 'id' });
        os.createIndex('by_date', 'date', { unique:false });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror  = ()=> reject(req.error);
  });
  return dbPromise;
}
async function photos_add(photo){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction('photos','readwrite'); tx.objectStore('photos').put(photo); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function photos_delete(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction('photos','readwrite'); tx.objectStore('photos').delete(id); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function photos_all(){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction('photos','readonly'); const req=tx.objectStore('photos').getAll(); req.onsuccess=()=>{ const arr=req.result.sort((a,b)=> new Date(b.date)-new Date(a.date)); res(arr); }; req.onerror=()=>rej(req.error); }); }

/* Migration depuis localStorage (si ancienne version) */
(async ()=>{
  const old = (()=>{ try{return JSON.parse(localStorage.getItem('peak_photos_v1'))||null;}catch(e){return null;} })();
  if (old && old.length){
    for (const p of old){
      const blob = await (await fetch(p.dataUrl)).blob();
      await photos_add({ id:p.id, date:p.date, weight:p.weight, blob });
    }
    localStorage.removeItem('peak_photos_v1');
    console.log('Migration photos → IndexedDB OK');
  }
})();

// ===== State =====
let draftExercises=[], draftMuscles=new Set(), editingSessionId=null;
let recentExercises=[], activeExerciseFilter='';
let selLeft=null, selRight=null;

// ===== Utils =====
const $=q=>document.querySelector(q), $$=q=>document.querySelectorAll(q);
const readJSON=(k,f=[])=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch(e){return f;}};
const writeJSON=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const fmtD=d=>new Date(d).toLocaleDateString();
const uid=()=>crypto.randomUUID?.()||('id'+Math.random().toString(16).slice(2));
const DPR=window.devicePixelRatio||1;
const escapeHTML=s=>(s||'').replace(/[&<>'"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const getVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#fff';
const getTextColor=a=>document.documentElement.classList.contains('light')?`rgba(0,0,0,${a})`:`rgba(255,255,255,${a})`;
const getGridColor=a=>getTextColor(a);
function roundRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();}

// Compression vers Blob (au lieu de dataURL) pour stocker en IDB
async function compressImageToBlob(file, maxW=1440, quality=0.85){
  const img = new Image(), fr = new FileReader();
  await new Promise((res,rej)=>{ fr.onload=()=>{ img.onload=res; img.onerror=rej; img.src=fr.result; }; fr.readAsDataURL(file); });
  const scale = Math.min(1, maxW/img.width);
  const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  c.getContext('2d').drawImage(img,0,0,w,h);
  return await new Promise(r=> c.toBlob(r, 'image/jpeg', quality));
}

// ===== Tabs =====
function switchTab(name){
  $$('.tab').forEach(s=>s.classList.remove('active'));
  $(`#tab-${name}`).classList.add('active');
  $$('.navBtn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home'){ refreshHome(); }
  if(name==='sessions'){ buildExerciseIndex(); renderSessions(); renderKPIs(); drawExerciseChart(); }
  if(name==='physique'){ renderGallery(); drawWeightChart(); refreshPickers(); initCompareCanvas(); renderComparison(); }
}
window.switchTab=switchTab;

// ===== Themes =====
const THEMES=[
  {id:'fire',name:'Fire (rouge → orange)',a1:'#ff3d3d',a2:'#ff9a3c'},
  {id:'ocean',name:'Ocean (bleu → cyan)',a1:'#3d7bff',a2:'#36d1ff'},
  {id:'grape',name:'Grape (violet → rose)',a1:'#7b3dff',a2:'#ff5ad1'},
  {id:'mint',name:'Mint (vert → turquoise)',a1:'#27d17c',a2:'#29d3c6'},
  {id:'sunset',name:'Sunset (rose → orange)',a1:'#ff6aa9',a2:'#ffa34d'},
  {id:'steel',name:'Steel (cyan → violet)',a1:'#24c6dc',a2:'#514a9d'}
];
function applyTheme(t){
  document.documentElement.style.setProperty('--accent1',t.a1);
  document.documentElement.style.setProperty('--accent2',t.a2);
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content',t.a1);
  drawExerciseChart(); drawHomeExerciseChart(); drawWeightChart(); drawHomeWeightSpark(); renderComparison();
}
function buildThemePicker(){
  const grid=$('#themeGrid'); grid.innerHTML='';
  THEMES.forEach(t=>{
    const card=document.createElement('div');
    card.className='themeCard';
    card.innerHTML=`<div class="themeSwatch" style="--a1:${t.a1};--a2:${t.a2}"></div><div class="themeLabel">${t.name}</div>`;
    card.style.cssText='display:flex;flex-direction:column;gap:8px;border:1px solid var(--glass-border);border-radius:14px;background:rgba(255,255,255,.05);padding:10px;cursor:pointer';
    card.onclick=()=>{writeJSON(LS_THEME,t);applyTheme(t);};
    grid.appendChild(card);
  });
}
function toggleLightMode(){
  const on=!document.documentElement.classList.contains('light');
  document.documentElement.classList.toggle('light',on);
  localStorage.setItem(LS_LIGHT,on?'1':'0');
  $('#lightToggle').classList.toggle('on',on);
  drawExerciseChart(); drawHomeExerciseChart(); drawWeightChart(); drawHomeWeightSpark(); renderComparison();
}
window.toggleLightMode=toggleLightMode;

// ===== Library & Segments =====
function AMRAP(){return 0;}
const LIB={
  "Poitrine":[
    {name:"Développé couché (barre)",alias:["bench press","bench"],muscles:["Pectoral médian","Deltoïde antérieur","Triceps"],sets:5,reps:5},
    {name:"Développé incliné (haltères)",alias:["incline db press"],muscles:["Pectoral supérieur","Deltoïde antérieur","Triceps"],sets:4,reps:10},
    {name:"Dips",alias:["dips"],muscles:["Pectoral inférieur","Triceps"],sets:3,reps:AMRAP()}
  ],
  "Dos":[
    {name:"Row barre",alias:["barbell row","bent-over row"],muscles:["Lats","Rhomboïdes","Trapèze moyen"],sets:4,reps:8},
    {name:"Tractions pronation",alias:["pull-ups","tractions"],muscles:["Lats","Biceps","Trapèze inférieur"],sets:3,reps:AMRAP()},
    {name:"Row poulie",alias:["seated cable row"],muscles:["Lats","Rhomboïdes"],sets:4,reps:10}
  ],
  "Épaules":[
    {name:"Développé militaire",alias:["OHP","overhead press"],muscles:["Deltoïde antérieur","Deltoïde latéral","Triceps"],sets:5,reps:5},
    {name:"Élévations latérales",alias:["lateral raises"],muscles:["Deltoïde latéral"],sets:4,reps:15}
  ],
  "Bras":[
    {name:"Curl incliné",alias:["incline curl"],muscles:["Biceps","Brachial"],sets:4,reps:12},
    {name:"Pushdown",alias:["triceps pushdown"],muscles:["Triceps latéral","Triceps médial"],sets:4,reps:12}
  ],
  "Tronc":[
    {name:"Crunchs",alias:["crunch"],muscles:["Grand droit (abdos)"],sets:4,reps:20},
    {name:"Gainage",alias:["plank"],muscles:["Transverse","Obliques"],sets:3,reps:60}
  ],
  "Jambes":[
    {name:"Squat barre",alias:["back squat","squat"],muscles:["Quadriceps","Fessier (grand)","Ischios"],sets:5,reps:5},
    {name:"Presse à cuisses",alias:["leg press"],muscles:["Quadriceps","Fessier (grand)"],sets:4,reps:12},
    {name:"Soulevé de terre JT",alias:["stiff-leg deadlift","rdl"],muscles:["Ischios","Fessier (grand)","Érecteurs"],sets:4,reps:8}
  ],
  "Fessiers/Mollets":[
    {name:"Hip thrust",alias:["hip thrust"],muscles:["Fessier (grand)","Ischios"],sets:4,reps:10},
    {name:"Mollets debout",alias:["standing calves"],muscles:["Gastrocnémien médial","Gastrocnémien latéral"],sets:4,reps:15}
  ]
};
const SEGMENTS={
  "Poitrine":["Pectoral supérieur","Pectoral médian","Pectoral inférieur","Petit pectoral"],
  "Dos":["Lats","Trapèze supérieur","Trapèze moyen","Trapèze inférieur","Rhomboïdes","Érecteurs","Grand rond","Petit rond"],
  "Épaules":["Deltoïde antérieur","Deltoïde latéral","Deltoïde postérieur","Sus‑épineux","Infra‑épineux","Subscapulaire"],
  "Bras":["Biceps","Brachial","Brachio‑radial","Triceps long","Triceps latéral","Triceps médial","Avant‑bras fléchisseurs","Avant‑bras extenseurs"],
  "Tronc":["Grand droit (abdos)","Obliques internes","Obliques externes","Transverse","Lombaires","Carré des lombes","Psoas‑iliaque"],
  "Jambes":["Quadriceps","Vaste médial","Vaste latéral","Vaste intermédiaire","Droit fémoral","Ischios","Biceps fémoral","Semi‑tendineux","Semi‑membraneux","Adducteurs","TFL/Abducteurs","Tibial antérieur"],
  "Fessiers/Mollets":["Fessier (grand)","Fessier (moyen)","Fessier (petit)","Gastrocnémien médial","Gastrocnémien latéral","Soléaire"]
};

// ===== Suggestions & Presets =====
const MY_PRESETS=()=>readJSON(LS_PRESETS,[]);
function buildSuggestions(q=''){
  const s=$('#suggestions'); s.innerHTML='';
  const lower=q.trim().toLowerCase();
  const fromLib=[]; Object.entries(LIB).forEach(([cat,arr])=>arr.forEach(p=>{
    const all=[p.name,...(p.alias||[])].map(x=>x.toLowerCase());
    if(!lower || all.some(a=>a.includes(lower))) fromLib.push({...p,cat});
  }));
  const fromMy=MY_PRESETS().filter(p=>!lower||[p.name,...(p.alias||[])].join(' ').toLowerCase().includes(lower));
  const rec=(recentExercises||[]).filter(x=>!lower||x.toLowerCase().includes(lower));

  const add=(label,data,cls='')=>{
    if(!data.length) return;
    s.insertAdjacentHTML('beforeend',`<div class="muted" style="width:100%">${label}</div>`);
    data.slice(0,10).forEach(p=>{
      if(typeof p==='string'){
        s.insertAdjacentHTML('beforeend',`<div class="sug ${cls}" onclick="applyName('${escapeHTML(p)}')"><strong>${escapeHTML(p)}</strong></div>`);
      }else{
        const muscles=(p.muscles||[]).join(', ');
        s.insertAdjacentHTML('beforeend',`<div class="sug ${cls}" onclick='applyPreset(${JSON.stringify(p).replace(/'/g,"&#39;")})'><strong>${escapeHTML(p.name)}</strong> — <span class="muted">${escapeHTML(muscles)}</span></div>`);
      }
    });
  };
  add('Récents',rec,'rec'); add('Mes presets',fromMy,'mine'); add('Bibliothèque',fromLib,'lib');
}
function applyName(n){ $('#exName').value=n; buildSuggestions(n); }
window.applyPreset=p=>{
  $('#exName').value=p.name; $('#exSets').value=p.sets||''; $('#exReps').value=p.reps||'';
  draftMuscles=new Set(p.muscles||[]); renderSegmentedMuscles(); buildSuggestions(p.name);
};
function saveCurrentAsPreset(){
  const name=$('#exName').value.trim(); if(!name) return alert('Nom d’exo vide.');
  const sets=parseInt($('#exSets').value,10)||null, reps=parseInt($('#exReps').value,10)||null;
  const muscles=Array.from(draftMuscles);
  const list=MY_PRESETS(); list.unshift({id:uid(),name,sets,reps,muscles,alias:[]});
  writeJSON(LS_PRESETS,list); buildSuggestions(name); buildPresetChips(); alert('Preset enregistré ⭐');
}
function buildPresetChips(){
  const box=$('#presetChips'); box.innerHTML='';
  MY_PRESETS().slice(0,8).forEach(p=>{
    const b=document.createElement('button'); b.className='rchip'; b.textContent=p.name; b.onclick=()=>applyPreset(p); box.appendChild(b);
  });
}

// ===== Segmented muscles =====
let activeSeg=Object.keys(SEGMENTS)[0];
function renderSegmentedMuscles(){
  const tabs=$('#segTabs'); tabs.innerHTML='';
  Object.keys(SEGMENTS).forEach(seg=>{
    const b=document.createElement('button'); b.className='segTab'+(seg===activeSeg?' on':''); b.textContent=seg;
    b.onclick=()=>{activeSeg=seg; renderSegmentedMuscles();}; tabs.appendChild(b);
  });
  const mus=$('#segMuscles'); mus.innerHTML='';
  SEGMENTS[activeSeg].forEach(m=>{
    const b=document.createElement('button'); b.className='chipToggle'+(draftMuscles.has(m)?' on':''); b.textContent=m;
    b.onclick=()=>{ b.classList.toggle('on'); if(draftMuscles.has(m)) draftMuscles.delete(m); else draftMuscles.add(m); };
    mus.appendChild(b);
  });
}

// ===== Library Drawer =====
function openLibrary(){ document.body.classList.add('modal-open'); $('#libModal').classList.add('open'); renderLibrary(); }
function closeLibrary(){ document.body.classList.remove('modal-open'); $('#libModal').classList.remove('open'); }
function renderLibrary(){
  const root=$('#libSections'); root.innerHTML='';
  Object.entries(LIB).forEach(([cat,arr])=>{
    const sec=document.createElement('div'); sec.className='libSection';
    sec.innerHTML=`<h4>${cat}</h4><div class="libList"></div>`;
    const list=sec.querySelector('.libList');
    arr.forEach(p=>{ const el=document.createElement('div'); el.className='libItem'; el.textContent=p.name; el.onclick=()=>{closeLibrary(); applyPreset({...p});}; list.appendChild(el); });
    root.appendChild(sec);
  });
}
function filterLibrary(){
  const q=($('#libSearch').value||'').toLowerCase();
  $$('#libSections .libItem').forEach(it=> it.style.display=it.textContent.toLowerCase().includes(q)?'':'none');
}

// ===== Quick menu =====
function openQuickMenu(e){
  const m=$('#quickMenu'); m.classList.toggle('open');
  const close=ev=>{ if(!m.contains(ev.target)){ m.classList.remove('open'); document.removeEventListener('click',close);} };
  setTimeout(()=>document.addEventListener('click',close),0);
}
window.openQuickMenu=openQuickMenu;

// ===== Sessions Modal =====
window.openSessionModal=()=>{
  document.body.classList.add('modal-open');
  $('#sessionModal').classList.add('open');
  const today=new Date().toISOString().slice(0,10);
  $('#sessDate').value=today; $('#sessName').value=''; $('#sessNotes').value='';
  draftExercises=[]; draftMuscles=new Set(); editingSessionId=null;
  $('#btnDeleteSession').style.display='none';
  renderSegmentedMuscles(); renderDraft(); buildSuggestions(''); buildPresetChips();
  $('#exName').oninput=e=>buildSuggestions(e.target.value);
};
window.closeSessionModal=()=>{ document.body.classList.remove('modal-open'); $('#sessionModal').classList.remove('open'); };

window.addExerciseToDraft=()=>{
  const name=$('#exName').value.trim(), sets=parseInt($('#exSets').value,10), reps=parseInt($('#exReps').value,10), weight=parseFloat($('#exWeight').value);
  const muscles=Array.from(draftMuscles);
  if(!name||isNaN(sets)||isNaN(reps)||isNaN(weight)){ alert('Remplis: exercice, séries, reps, poids.'); return; }
  draftExercises.push({id:uid(),name,sets,reps,weight,muscles});
  if(!recentExercises.includes(name)){ recentExercises.unshift(name); recentExercises=recentExercises.slice(0,8); buildRecentChips(); }
  $('#exName').value=''; $('#exSets').value=''; $('#exReps').value=''; $('#exWeight').value=''; buildSuggestions(''); renderDraft();
};
function renderDraft(){
  const box=$('#draftExercises'), empty=$('#draftEmpty'); box.innerHTML='';
  if(draftExercises.length===0){ empty.style.display='block'; return; } empty.style.display='none';
  draftExercises.forEach(x=>{
    const el=document.createElement('div'); el.className='item';
    el.innerHTML=`<div><div style="font-weight:700">${escapeHTML(x.name)} • ${x.weight}kg — ${x.sets}×${x.reps}</div><div class="recentChips" style="margin-top:6px">${(x.muscles||[]).map(m=>`<span class="rchip active">${escapeHTML(m)}</span>`).join(' ')}</div></div><div class="right"><button class="kebab" onclick="delDraftEx('${x.id}')">Suppr</button></div>`;
    box.appendChild(el);
  });
}
window.delDraftEx=id=>{ draftExercises=draftExercises.filter(x=>x.id!==id); renderDraft(); };

window.saveSession=()=>{
  if(draftExercises.length===0){ alert('Ajoute au moins un exercice.'); return; }
  const date=$('#sessDate').value, name=$('#sessName').value.trim(); if(!date){ alert('Choisis une date.'); return; }
  const notes=$('#sessNotes').value.trim(); const sessions=readJSON(LS_SESSIONS);
  if(editingSessionId){ const i=sessions.findIndex(s=>s.id===editingSessionId); if(i>-1) sessions[i]={...sessions[i],date,name,notes,exercises:[...draftExercises]}; }
  else{ sessions.unshift({id:uid(),date,name,notes,exercises:[...draftExercises]}); }
  writeJSON(LS_SESSIONS,sessions);
  closeSessionModal(); buildExerciseIndex(); renderSessions(); renderKPIs(); drawExerciseChart();
};
window.confirmDeleteSession=()=>{
  if(!editingSessionId) return;
  if(!confirm('Supprimer cette séance ?')) return;
  writeJSON(LS_SESSIONS, readJSON(LS_SESSIONS).filter(s=>s.id!==editingSessionId));
  closeSessionModal(); buildExerciseIndex(); renderSessions(); renderKPIs(); drawExerciseChart();
};
function openEditSession(s){
  document.body.classList.add('modal-open'); $('#sessionModal').classList.add('open');
  $('#sessDate').value=s.date; $('#sessName').value=s.name||''; $('#sessNotes').value=s.notes||'';
  draftExercises=s.exercises.map(e=>({...e})); draftMuscles=new Set(); editingSessionId=s.id;
  $('#btnDeleteSession').style.display='inline-flex';
  renderSegmentedMuscles(); renderDraft(); buildSuggestions(''); buildPresetChips();
}
window.editSession=id=>{ const s=readJSON(LS_SESSIONS).find(x=>x.id===id); if(s) openEditSession(s); };

// ===== Sessions list + KPIs =====
function renderSessions(){
  const list=$('#sessionsList'), empty=$('#sessionsEmpty'); const sessions=readJSON(LS_SESSIONS);
  list.innerHTML=''; if(sessions.length===0){ empty.style.display='block'; return; } empty.style.display='none';
  sessions.forEach(s=>{
    const exFiltered=activeExerciseFilter?s.exercises.filter(e=>e.name.toLowerCase()===activeExerciseFilter.toLowerCase()):s.exercises;
    if(exFiltered.length===0) return;
    const el=document.createElement('div'); el.className='item clickable';
    const exo=exFiltered.map(e=>`${escapeHTML(e.name)} (${e.weight}kg, ${e.sets}×${e.reps})`).join(' • ');
    el.innerHTML=`<div><div style="font-weight:800">${escapeHTML(s.name||'Séance')} • ${fmtD(s.date)}</div><div class="muted" style="margin-top:4px">${escapeHTML(s.notes||'')}</div><div class="muted" style="margin-top:6px">${exo}</div></div><div class="right"><button class="kebab" onclick="openCardMenu(event,'${s.id}')">⋯</button></div>`;
    el.onclick=ev=>{ if(ev.target.closest('.kebab')) return; openEditSession(s); };
    list.appendChild(el);
  });
}
function openCardMenu(e,id){
  e.stopPropagation();
  const m=document.createElement('div'); m.className='menu glass open'; m.style.right='0'; m.style.top='28px';
  m.innerHTML=`<button onclick="openEdit('${id}',this)">Éditer</button><button onclick="duplicateSession('${id}',this)">Dupliquer</button><button onclick="deleteSession('${id}',this)">Supprimer</button>`;
  const wrap=e.currentTarget.parentElement; wrap.appendChild(m);
  const close=ev=>{ if(!m.contains(ev.target)){ m.remove(); document.removeEventListener('click',close);} };
  setTimeout(()=>document.addEventListener('click',close),0);
}
window.openEdit=(id,btn)=>{ btn.closest('.menu').remove(); editSession(id); };
window.duplicateSession=(id,btn)=>{ const sessions=readJSON(LS_SESSIONS); const s=sessions.find(x=>x.id===id); if(!s) return; sessions.unshift({...s,id:uid(),date:new Date().toISOString().slice(0,10),name:(s.name||'Séance')+' (dup)'}); writeJSON(LS_SESSIONS,sessions); renderSessions(); btn.closest('.menu').remove(); };
window.deleteSession=(id,btn)=>{ if(!confirm('Supprimer cette séance ?')) return; writeJSON(LS_SESSIONS, readJSON(LS_SESSIONS).filter(x=>x.id!==id)); renderSessions(); btn.closest('.menu').remove(); };

function renderKPIs(){
  const sessions=readJSON(LS_SESSIONS), weekAgo=new Date(Date.now()-7*24*3600*1000);
  let vol7=0,bestBench='—',benchW=[],countWeek=0;
  sessions.forEach(s=>{
    const inWeek=new Date(s.date)>=weekAgo; if(inWeek) countWeek++;
    s.exercises.forEach(e=>{ if(inWeek) vol7+=(e.weight*e.reps*e.sets); if(/bench/i.test(e.name)) benchW.push(e.weight); });
  });
  if(benchW.length) bestBench=Math.max(...benchW)+' kg';
  $('#homeSessions').textContent=`Séances cette semaine: ${countWeek}`;
  $('#homeVolume').textContent=`Volume 7j: ${Math.round(vol7)} kg`;
  $('#homeBest').textContent=`Best Bench: ${bestBench}`;
}

// ===== Index + filtres =====
function buildExerciseIndex(){
  const sessions=readJSON(LS_SESSIONS); const names=new Set(); sessions.forEach(s=>s.exercises.forEach(e=>names.add(e.name)));
  const arr=[...names].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  $('#allExercises').innerHTML=arr.map(n=>`<option value="${escapeHTML(n)}">`).join(''); buildRecentChips(arr);
}
function buildRecentChips(all=[]){
  const box=$('#recentChips'); if(!box) return;
  const list=(recentExercises.length?recentExercises:all).slice(0,10);
  box.innerHTML=list.map(n=>`<button class="rchip${activeExerciseFilter===n?' active':''}" onclick="setExerciseFilter('sessions','${escapeHTML(n)}')">${escapeHTML(n)}</button>`).join('');
}
function setExerciseFilter(scope,name){
  activeExerciseFilter=name||'';
  if(scope==='sessions'){ $('#exerciseInput').value=activeExerciseFilter; drawExerciseChart(); renderSessions(); buildRecentChips(); }
  if(scope==='home'){ $('#homeExerciseInput').value=activeExerciseFilter; drawHomeExerciseChart(); }
}
window.setExerciseFilter=setExerciseFilter;
$('#exerciseInput')?.addEventListener('change',e=>setExerciseFilter('sessions',e.target.value));
$('#homeExerciseInput')?.addEventListener('change',e=>setExerciseFilter('home',e.target.value));

// ===== Charts =====
function pointsForExercise(name){
  const sessions=readJSON(LS_SESSIONS); const map=new Map();
  sessions.forEach(s=>{
    const matches=s.exercises.filter(e=>e.name.toLowerCase()===name.toLowerCase());
    if(matches.length){ const best=Math.max(...matches.map(e=>e.weight)); map.set(s.date,best); }
  });
  return [...map.entries()].sort((a,b)=>new Date(a[0])-new Date(b[0])).map(([d,w])=>({x:new Date(d).getTime()/86400000,y:w}));
}
function drawLineChart(canvas,points){
  const ctx=canvas.getContext('2d'), W=canvas.clientWidth, H=canvas.clientHeight;
  canvas.width=W*DPR; canvas.height=H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,W,H);
  const left=44, bottom=30, top=12, right=14;
  ctx.globalAlpha=.7; ctx.strokeStyle=getGridColor(.25); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(left,H-bottom); ctx.lineTo(W-right,H-bottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left,top); ctx.lineTo(left,H-bottom); ctx.stroke();
  if(points.length===0){ ctx.fillStyle=getTextColor(.65); ctx.fillText('Pas de données',left+6,H-bottom-8); return; }
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y); const xMin=Math.min(...xs), xMax=Math.max(...xs); const yMin=Math.min(...ys), yMax=Math.max(...ys);
  const xSpan=Math.max(1,xMax-xMin), ySpan=Math.max(1,yMax-yMin);
  const xToPx=x=> left+((x-xMin)/xSpan)*(W-left-right);
  const yToPx=y=> (H-bottom)-((y-yMin)/ySpan)*(H-bottom-top);
  ctx.globalAlpha=.18; ctx.strokeStyle=getGridColor(.28);
  for(let i=0;i<=4;i++){ const yy=top+(i/4)*(H-bottom-top); ctx.beginPath(); ctx.moveTo(left,yy); ctx.lineTo(W-right,yy); ctx.stroke(); }
  const grad=ctx.createLinearGradient(0,0,W,0); grad.addColorStop(0,getVar('--accent1')); grad.addColorStop(1,getVar('--accent2'));
  ctx.globalAlpha=1; ctx.strokeStyle=grad; ctx.lineWidth=2.4; ctx.beginPath(); points.forEach((p,i)=>{const px=xToPx(p.x),py=yToPx(p.y); i?ctx.lineTo(px,py):ctx.moveTo(px,py);}); ctx.stroke();
  ctx.fillStyle=document.documentElement.classList.contains('light')?'#111':'#fff';
  points.forEach(p=>{const px=xToPx(p.x),py=yToPx(p.y); ctx.beginPath(); ctx.arc(px,py,2.8,0,Math.PI*2); ctx.fill();});
  ctx.fillStyle=getTextColor(.65); ctx.font='12px system-ui'; const step=ySpan/4; for(let i=0;i<=4;i++){ const val=Math.round((yMin+i*step)*10)/10; const yy=yToPx(yMin+i*step); ctx.fillText(val,6,yy+4); }
}
function drawExerciseChart(){ const name=$('#exerciseInput').value||activeExerciseFilter; drawLineChart($('#exerciseChart'), name?pointsForExercise(name):[]); }
function drawHomeExerciseChart(){ const name=$('#homeExerciseInput').value||activeExerciseFilter; drawLineChart($('#homeExerciseChart'), name?pointsForExercise(name):[]); }
function drawWeightChart(){ const pts=readJSON(LS_PHOTOS).map(p=>({x:new Date(p.date).getTime()/86400000,y:parseFloat(p.weight)})).sort((a,b)=>a.x-b.x); drawLineChart($('#weightChart'),pts); }
function drawHomeWeightSpark(){ const since=Date.now()-30*24*3600*1000; const pts=readJSON(LS_PHOTOS).filter(p=>new Date(p.date).getTime()>=since).map(p=>({x:new Date(p.date).getTime()/86400000,y:parseFloat(p.weight)})).sort((a,b)=>a.x-b.x); drawLineChart($('#homeWeightSpark'),pts); }

// ===== Photos / Gallery =====
window.addPhoto = async ()=>{
  const f = $('#photoFile').files[0], d=$('#photoDate').value, w=parseFloat($('#photoWeight').value);
  if(!f)  return alert('Choisis une photo.');
  if(!d)  return alert('Sélectionne une date.');
  if(isNaN(w)) return alert('Indique ton poids.');
  const blob = await compressImageToBlob(f, 1440, .85);
  await photos_add({ id: uid(), date: d, weight: w, blob });
  $('#photoFile').value = '';
  await renderGallery(); drawWeightChart(); drawHomeWeightSpark(); refreshPickers(); renderComparison();
};

async function renderGallery(){
  const g=$('#gallery'), empty=$('#galleryEmpty'); g.innerHTML='';
  const photos = await photos_all();
  if(!photos.length){
    empty.style.display='block';
    $('#homeLastPhoto').classList.add('empty');
    $('#homeLastPhoto').textContent='Pas encore de photo.';
    return;
  }
  empty.style.display='none';

  // Accueil
  const lastURL = URL.createObjectURL(photos[0].blob);
  $('#homeLastPhoto').classList.remove('empty');
  $('#homeLastPhoto').innerHTML = `<img src="${lastURL}" alt=""><div class="muted" style="margin-top:6px">${fmtD(photos[0].date)} • ${photos[0].weight}kg</div>`;

  // Galerie
  for (const p of photos){
    const url = URL.createObjectURL(p.blob);
    const el = document.createElement('div');
    el.className='shot';
    el.innerHTML = `<img src="${url}"><div class="badge">${fmtD(p.date)} • ${p.weight}kg</div><button class="del" onclick="delPhoto('${p.id}')">Suppr</button>`;
    g.appendChild(el);
  }
}

window.delPhoto = async (id)=>{
  await photos_delete(id);
  await renderGallery(); drawWeightChart(); drawHomeWeightSpark(); refreshPickers(); renderComparison();
};

// Pickers
async function refreshPickers(){
  const photos = await photos_all();
  const left=$('#pickerLeft'), right=$('#pickerRight'); left.innerHTML=''; right.innerHTML='';
  for (const p of photos){
    const url = URL.createObjectURL(p.blob);
    const mk = side => {
      const d=document.createElement('div'); d.className='thumb';
      d.innerHTML=`<img src="${url}"/><div class="cap">${fmtD(p.date)} • ${p.weight}kg</div>`;
      d.onclick=()=>{ if(side==='L') selLeft=p.id; else selRight=p.id; refreshPickers(); renderComparison(); };
      if((side==='L'&&selLeft===p.id)||(side==='R'&&selRight===p.id)) d.classList.add('sel');
      return d;
    };
    left.appendChild(mk('L')); right.appendChild(mk('R'));
  }
  if(!selLeft && photos.length)  selLeft = photos[photos.length-1].id;
  if(!selRight && photos.length) selRight = photos[0].id;
}

// ===== Comparateur =====
const cmp={layout:'vertical',style:'glass',radius:20,L:{z:1,x:0,y:0},R:{z:1,x:0,y:0}};
let cmpCanvas, cmpCtx, isDragging=false, dragSide='L', lastPos=null;

window.setLayout=v=>{ cmp.layout=v; $$('#cmpLayoutSeg .seg').forEach(b=>b.classList.toggle('on',b.dataset.layout===v)); renderComparison(); };
window.setStyle=v=>{ cmp.style=v; $$('#cmpStyleSeg .seg').forEach(b=>b.classList.toggle('on',b.dataset.style===v)); renderComparison(); };
window.resetCrop=()=>{ cmp.L={z:1,x:0,y:0}; cmp.R={z:1,x:0,y:0}; renderComparison(); };

function initCompareCanvas(){
  cmpCanvas=$('#compareCanvas'); cmpCtx=cmpCanvas.getContext('2d');
  const pos=ev=>{const r=cmpCanvas.getBoundingClientRect(); return {x:(ev.touches?ev.touches[0].clientX:ev.clientX)-r.left,y:(ev.touches?ev.touches[0].clientY:ev.clientY)-r.top};};
  const down=ev=>{isDragging=true; lastPos=pos(ev); const half=cmpCanvas.clientHeight/2, halfW=cmpCanvas.clientWidth/2; dragSide=(cmp.layout==='side'?(lastPos.x<halfW?'L':'R'):(lastPos.y<half?'L':'R')); cmpCanvas.classList.add('dragging');};
  const move=ev=>{ if(!isDragging) return; const p=pos(ev); const dx=p.x-lastPos.x, dy=p.y-lastPos.y; const side=cmp[dragSide]; side.x+=dx/120; side.y+=dy/120; lastPos=p; renderComparison(); };
  const up=()=>{isDragging=false; cmpCanvas.classList.remove('dragging');};
  cmpCanvas.onmousedown=down; cmpCanvas.onmousemove=move; window.addEventListener('mouseup',up);
  cmpCanvas.ontouchstart=down; cmpCanvas.ontouchmove=e=>{e.preventDefault(); move(e);}; window.addEventListener('touchend',up,{passive:true});
  cmpCanvas.onwheel=e=>{ if(!(e.ctrlKey||e.metaKey)) return; e.preventDefault(); const s=e.deltaY>0?-0.05:0.05; const side=cmp[dragSide]; side.z=Math.max(1,Math.min(3,side.z+s)); renderComparison(); };
}

async function renderComparison(){
  const photos = await photos_all();
  const canvas=$('#compareCanvas'), ctx=canvas.getContext('2d'); const Wd=canvas.clientWidth||900, Hd=canvas.clientHeight||680;
  canvas.width=Wd*DPR; canvas.height=Hd*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);

  const g=ctx.createLinearGradient(0,0,Wd,0); g.addColorStop(0,getVar('--accent1')); g.addColorStop(1,getVar('--accent2'));
  ctx.fillStyle='#111'; ctx.fillRect(0,0,Wd,Hd); ctx.globalAlpha=(cmp.style==='bold'?.35:.22); ctx.fillStyle=g; ctx.fillRect(0,0,Wd,Hd); ctx.globalAlpha=1;

  if(!pL||!pR){ ctx.fillStyle=getTextColor(.75); ctx.font='16px system-ui'; ctx.fillText('Choisis deux photos ci‑dessus, puis glisse pour recadrer.',16,28); return; }

  const pad=22, R=20; const innerW=Wd-pad*2, innerH=Hd-110; let box1,box2;
  if(cmp.layout==='side'){ const halfW=(innerW-pad)/2; box1={x:pad,y:pad,w:halfW,h:innerH}; box2={x:pad+halfW+pad,y:pad,w:halfW,h:innerH}; }
  else{ const halfH=(innerH-pad)/2; box1={x:pad,y:pad,w:innerW,h:halfH}; box2={x:pad,y:pad+halfH+pad,w:innerW,h:halfH}; }

  const imgL=new Image(), imgR=new Image(); let ready=0; imgL.onload=step; imgR.onload=step; imgL.src=pL.dataUrl; imgR.src=pR.dataUrl; function step(){ if(++ready===2) draw(); }

  function glass(box){
    if(cmp.style==='glass'){ ctx.save(); roundRect(ctx,box.x,box.y,box.w,box.h,R); ctx.clip(); ctx.fillStyle='rgba(255,255,255,.05)'; ctx.fillRect(box.x,box.y,box.w,box.h); ctx.restore(); ctx.strokeStyle=(document.documentElement.classList.contains('light')?'rgba(0,0,0,.08)':'rgba(255,255,255,.18)'); ctx.lineWidth=1; roundRect(ctx,box.x+.5,box.y+.5,box.w-1,box.h-1,R); ctx.stroke(); }
    else if(cmp.style==='bold'){ const gg=ctx.createLinearGradient(box.x,box.y,box.x+box.w,box.y); gg.addColorStop(0,getVar('--accent1')); gg.addColorStop(1,getVar('--accent2')); ctx.save(); roundRect(ctx,box.x,box.y,box.w,box.h,R); ctx.clip(); ctx.globalAlpha=.1; ctx.fillStyle=gg; ctx.fillRect(box.x,box.y,box.w,box.h); ctx.restore(); }
  }
  function drawContain(img,box,side){ const {x,y,w,h}=box, zoom=side.z, offX=side.x, offY=side.y; const scale=Math.max(w/img.width,h/img.height)*zoom; const dw=img.width*scale, dh=img.height*scale; const dx=x+(w-dw)/2+offX*(w/6), dy=y+(h-dh)/2+offY*(h/6); ctx.save(); roundRect(ctx,x,y,w,h,R); ctx.clip(); ctx.imageSmoothingQuality='high'; ctx.drawImage(img,dx,dy,dw,dh); ctx.restore(); }

  function draw(){
    glass(box1); glass(box2);
    drawContain(imgL,box1,cmp.L); drawContain(imgR,box2,cmp.R);
    ctx.fillStyle=getTextColor(.9); ctx.font='13px system-ui';
    ctx.fillText(`${fmtD(pL.date)} • ${pL.weight}kg`, box1.x+10, box1.y+box1.h-10);
    ctx.fillText(`${fmtD(pR.date)} • ${pR.weight}kg`, box2.x+10, box2.y+box2.h-10);
    ctx.fillStyle=(document.documentElement.classList.contains('light')?'rgba(255,255,255,.35)':'rgba(0,0,0,.35)'); ctx.fillRect(0,Hd-70,Wd,70);
    const grad=ctx.createLinearGradient(16,0,230,0); grad.addColorStop(0,getVar('--accent1')); grad.addColorStop(1,getVar('--accent2')); ctx.fillStyle=grad; ctx.font='900 20px system-ui'; ctx.fillText('Peak.',16,Hd-26);
  }
}
window.downloadComparison = async ()=>{
    const photos = await photos_all();
    const pL = photos.find(p=>p.id===selLeft),
          pR = photos.find(p=>p.id===selRight);  const W=1080,H=1920,c=document.createElement('canvas'); c.width=W; c.height=H; const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,W,0); g.addColorStop(0,getVar('--accent1')); g.addColorStop(1,getVar('--accent2'));
  ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=(cmp.style==='bold'?.35:.22); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  const pad=48,R=28, innerW=W-pad*2, innerH=H-180; let box1,box2;
  if(cmp.layout==='side'){ const halfW=(innerW-pad)/2; box1={x:pad,y:pad,w:halfW,h:innerH}; box2={x:pad+halfW+pad,y:pad,w:halfW,h:innerH}; }
  else{ const halfH=(innerH-pad)/2; box1={x:pad,y:pad,w:innerW,h:halfH}; box2={x:pad,y:pad+halfH+pad,w:innerW,h:halfH}; }
  const imgL=new Image(), imgR=new Image(); let ready=0; imgL.onload=step; imgR.onload=step; imgL.src = pL ? URL.createObjectURL(pL.blob) : ''; imgR.src = pR ? URL.createObjectURL(pR.blob) : ''; function step(){ if(++ready===2){ draw(); save(); } }
  function glass(box){ if(cmp.style==='glass'){ ctx.save(); roundRect(ctx,box.x,box.y,box.w,box.h,R); ctx.clip(); ctx.fillStyle='rgba(255,255,255,.05)'; ctx.fillRect(box.x,box.y,box.w,box.h); ctx.restore(); ctx.strokeStyle=(document.documentElement.classList.contains('light')?'rgba(0,0,0,.08)':'rgba(255,255,255,.18)'); ctx.lineWidth=2; roundRect(ctx,box.x+1,box.y+1,box.w-2,box.h-2,R); ctx.stroke(); } else { const gg=ctx.createLinearGradient(box.x,box.y,box.x+box.w,box.y); gg.addColorStop(0,getVar('--accent1')); gg.addColorStop(1,getVar('--accent2')); ctx.save(); roundRect(ctx,box.x,box.y,box.w,box.h,R); ctx.clip(); ctx.globalAlpha=.1; ctx.fillStyle=gg; ctx.fillRect(box.x,box.y,box.w,box.h); ctx.restore(); } }
  function drawContain(img,box,side){ const {x,y,w,h}=box, zoom=side.z, offX=side.x, offY=side.y; const scale=Math.max(w/img.width,h/img.height)*zoom; const dw=img.width*scale, dh=img.height*scale; const dx=x+(w-dw)/2+offX*(w/6), dy=y+(h-dh)/2+offY*(h/6); ctx.save(); roundRect(ctx,x,y,w,h,R); ctx.clip(); ctx.imageSmoothingQuality='high'; ctx.drawImage(img,dx,dy,dw,dh); ctx.restore(); }
  function draw(){ glass(box1); glass(box2); drawContain(imgL,box1,cmp.L); drawContain(imgR,box2,cmp.R); ctx.fillStyle=(document.documentElement.classList.contains('light')?'rgba(255,255,255,.35)':'rgba(0,0,0,.35)'); ctx.fillRect(0,H-110,W,110); const grad=ctx.createLinearGradient(32,0,320,0); grad.addColorStop(0,getVar('--accent1')); grad.addColorStop(1,getVar('--accent2')); ctx.fillStyle=grad; ctx.font='900 40px system-ui'; ctx.fillText('Peak.',32,H-36); ctx.fillStyle=(document.documentElement.classList.contains('light')?'#000':'#fff'); ctx.font='26px system-ui'; ctx.fillText(`${fmtD(pL.date)} • ${pL.weight}kg`, box1.x+20, box1.y+box1.h-20); ctx.fillText(`${fmtD(pR.date)} • ${pR.weight}kg`, box2.x+20, box2.y+box2.h-20); }
  function save(){ const a=document.createElement('a'); a.href=c.toDataURL('image/png'); a.download=`peak_story_${new Date().toISOString().slice(0,10)}.png`; a.click(); }
};

// ===== Export / Import / Reset =====
window.exportData=()=>{
  const blob=new Blob([JSON.stringify({sessions:readJSON(LS_SESSIONS),photos:readJSON(LS_PHOTOS),presets:MY_PRESETS()})],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement('a'),{href:url,download:`peak_export_${new Date().toISOString().slice(0,10)}.json`}); document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
};
window.importData=()=>{
  const fileInput=$('#hiddenImport');
  fileInput.onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    try{ const j=JSON.parse(await f.text()); if(j.sessions) writeJSON(LS_SESSIONS,j.sessions); if(j.photos) writeJSON(LS_PHOTOS,j.photos); if(j.presets) writeJSON(LS_PRESETS,j.presets); refreshAll(); alert('Import réussi ✅'); }
    catch(err){ alert('Fichier invalide.'); }
    fileInput.value='';
  };
  fileInput.click();
};
window.resetAll=()=>{ if(!confirm('Effacer toutes les données locales ?')) return; localStorage.removeItem(LS_SESSIONS); localStorage.removeItem(LS_PHOTOS); localStorage.removeItem(LS_PRESETS); refreshAll(); };

// ===== Image compression =====
function compressImageToDataURL(file,maxW=1440,quality=0.85){
  return new Promise((resolve,reject)=>{
    const img=new Image(), fr=new FileReader();
    fr.onload=()=>img.src=fr.result; fr.onerror=reject;
    img.onload=()=>{ const scale=Math.min(1,maxW/img.width); const w=Math.round(img.width*scale), h=Math.round(img.height*scale); const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); resolve(c.toDataURL('image/jpeg',quality)); };
    fr.readAsDataURL(file);
  });
}

// ===== Home =====
function refreshHome(){ renderKPIs(); drawHomeWeightSpark(); buildExerciseIndex(); drawHomeExerciseChart(); renderGallery(); }

// ===== Init =====
function refreshAll(){
  const d=new Date().toISOString().slice(0,10);
  $('#photoDate').value=d; $('#sessDate').value=d;
  buildExerciseIndex(); renderSessions(); renderKPIs(); renderGallery(); drawWeightChart(); drawHomeWeightSpark();
  drawExerciseChart(); drawHomeExerciseChart(); refreshPickers(); initCompareCanvas(); renderComparison();
}
(function init(){
  const savedT=readJSON(LS_THEME,null); if(savedT) applyTheme(savedT);
  buildThemePicker();
  const light=localStorage.getItem(LS_LIGHT)==='1'; document.documentElement.classList.toggle('light',light); $('#lightToggle').classList.toggle('on',light);
  const d=new Date().toISOString().slice(0,10); $('#photoDate').value=d; $('#sessDate').value=d;
  refreshAll(); switchTab('home');
})();

/* ===== A2HS (Add to Home Screen) ===== */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const b = document.getElementById('btnInstall');
  if (b) b.style.display = 'inline-flex';
});
document.getElementById('btnInstall')?.addEventListener('click', async ()=>{
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  document.getElementById('btnInstall').style.display = 'none';
  deferredPrompt = null;
});
window.addEventListener('appinstalled', ()=>{ const b=document.getElementById('btnInstall'); if(b) b.style.display='none'; });

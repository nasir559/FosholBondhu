'use strict';

// Browser-only proposal. There are no hardware connections or external API calls.
const KEY = 'fosholbondhu-demo-v1';
const TZ = 'Asia/Dhaka';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAGES = { overview: 'Overview', cameras: 'Cameras', control: 'Pest control', schedules: 'Schedules', animals: 'Animal guard', reports: 'Pest reports' };
const CATEGORIES = ['Rice stem borer', 'Brown planthopper', 'Leaf folder', 'Ladybird beetle'];
const DEVICES = ['Light trap', 'Targeted sprayer'];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const uid = () => crypto.randomUUID();
const formats = {
  key: new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'}),
  date: new Intl.DateTimeFormat('en-GB', {timeZone:TZ, day:'numeric', month:'short', year:'numeric'}),
  clock: new Intl.DateTimeFormat('en-GB', {timeZone:TZ, hour:'2-digit', minute:'2-digit', hour12:false}),
  hour: new Intl.DateTimeFormat('en-GB', {timeZone:TZ, hour:'2-digit', hourCycle:'h23'}),
  weekday: new Intl.DateTimeFormat('en-US', {timeZone:TZ, weekday:'short'})
};
const dateKey = date => formats.key.format(new Date(date));
const dateLabel = date => formats.date.format(new Date(date));
const clock = date => formats.clock.format(new Date(date));
const hour = date => Number(formats.hour.format(new Date(date)));
const weekday = date => DAYS.indexOf(formats.weekday.format(new Date(date)));
const timeLabel = value => { const [h,m] = value.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };

function seed() {
  const now = Date.now();
  const cameras = [
    {id:'cam-north',name:'North paddy field',zone:'Rice · North plot',scene:'rice',online:true},
    {id:'cam-east',name:'East vegetable patch',zone:'Vegetables · East plot',scene:'vegetables',online:true},
    {id:'cam-gate',name:'Field entrance',zone:'Boundary · South gate',scene:'gate',online:true}
  ];
  const detections = [];
  for (let d = 29; d >= 0; d--) {
    for (let n = 0; n < 10 + (d * 7 + 11) % 18; n++) {
      const h = [5,6,7,9,13,16,17,18,18,19,20,21][n % 12];
      // Keep today's sample useful even when the presentation is early in the day.
      const midnight = new Date(`${dateKey(now)}T00:00:00+06:00`).getTime();
      const at = d === 0 ? new Date(midnight + (now - midnight) * (n + 1) / 22) : new Date(`${dateKey(now - d * 86400000)}T${String(h).padStart(2,'0')}:${String(n * 13 % 60).padStart(2,'0')}:00+06:00`);
      if (at.getTime() > now) continue;
      const category = CATEGORIES[[0,1,0,2,1,0,3][n % 7]];
      detections.push({id:`seed-${d}-${n}`,at:at.toISOString(),category,cameraId:cameras[n % 2].id,harmful:category !== 'Ladybird beetle',confidence:85 + n * 3 % 14});
    }
  }
  return {version:1,cameras,detections,
    schedules:[
      {id:'schedule-evening',name:'Evening pest protection',cameraId:'cam-north',device:'Light trap',time:'18:00',days:[0,1,2,3,4,5,6],duration:15,enabled:true},
      {id:'schedule-morning',name:'Morning field care',cameraId:'cam-east',device:'Targeted sprayer',time:'06:30',days:[1,3,5],duration:2,enabled:true}
    ],
    actions:[{id:'action-initial',at:new Date(now-55*60000).toISOString(),cameraId:'cam-north',device:'Light trap',duration:15,status:'Completed',source:'Sample schedule'}],
    guard:{enabled:true,sound:true,light:true,cooldown:5},
    animals:[{id:'animal-initial',at:new Date(now-95*60000).toISOString(),cameraId:'cam-gate',category:'Cattle',response:'Sound + light (sample)'}]
  };
}
let storageWarning = false;
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.version === 1 && ['cameras','detections','schedules','actions','animals'].every(k => Array.isArray(saved[k])) && saved.guard) return saved;
  } catch { storageWarning = true; }
  return seed();
}
let state = load();
let page = 'overview', cameraFilter = 'all', reportDays = 7, reportCamera = 'all', chartPeriod = 'week';
let activeAction = null, actionTimer, toastTimer, returnFocus, selectedCamera = null, pendingDelete = null;
const content = document.querySelector('#page-content');
const modal = document.querySelector('#modal');
const camera = id => state.cameras.find(c => c.id === id);
const cameraName = id => camera(id)?.name || 'Removed camera';
const todayEvents = () => state.detections.filter(e => dateKey(e.at) === dateKey(Date.now()));
const cameraOptions = (selected, onlineOnly = false) => state.cameras.filter(c => !onlineOnly || c.online).map(c => `<option value="${esc(c.id)}" ${selected === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { storageWarning = true; toast('Browser storage is unavailable. Changes will last for this session only.'); }
}
function toast(message) {
  clearTimeout(toastTimer);
  const region = document.querySelector('#toasts');
  const item = document.createElement('div'); item.className = 'toast'; item.textContent = message;
  region.replaceChildren(item);
  toastTimer = setTimeout(() => region.replaceChildren(), 5000);
}
function relative(at) {
  const elapsed = Math.max(0, Date.now() - new Date(at).getTime());
  return elapsed < 60000 ? 'Just now' : elapsed < 3600000 ? `${Math.floor(elapsed/60000)} min ago` : elapsed < 86400000 ? `${Math.floor(elapsed/3600000)} hr ago` : dateLabel(at);
}
const button = (label, action, type = 'primary', symbol = 'plus') => `<button class="button button-${type}" data-action="${action}">${icon(symbol)}${label}</button>`;
const heading = (eyebrow,title,subtitle,actions='',cls='') => `<div class="page-heading ${cls}"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
const empty = (title,description,action='',symbol='camera') => `<div class="empty-state">${icon(symbol)}<h3>${title}</h3><p>${description}</p>${action}</div>`;
const metric = (label,value,note,symbol,suffix='') => `<article class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon(symbol)}</span></div><div class="metric-value">${value}${suffix ? `<small> ${suffix}</small>` : ''}</div><div class="metric-note">${note}</div></article>`;

// Illustrations intentionally communicate a proposal, not actual camera footage.
function scene(type,id,large=false) {
  const vegetable = type === 'vegetables', gate = type === 'gate';
  const p = `scene-${String(id).replace(/[^a-zA-Z0-9-]/g,'')}${large ? '-large' : ''}`;
  const rows = Array.from({length:13},(_,i) => {
    const x = -150+i*50;
    return `<path d="M${130+i*8} 83Q${x+90} 130 ${x} 210" fill="none" stroke="${vegetable ? '#4d6334' : '#64793d'}" stroke-width="${vegetable ? 14 : 17}"/><path d="M${130+i*8} 84Q${x+100} 140 ${x+8} 210" fill="none" stroke="${vegetable ? '#9ca76a' : '#a3ac64'}" stroke-width="4"/>`;
  }).join('');
  const plants = Array.from({length:30},(_,i) => {
    const x=i*43%380,y=110+i*17%90;
    return `<path d="M${x} ${y+8}q-8-16-12-11m12 11q7-18 13-14m-13 14v-18" fill="none" stroke="#bec180" stroke-width="1.4" opacity=".6"/>`;
  }).join('');
  return `<svg viewBox="0 0 380 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrated ${gate ? 'field entrance' : vegetable ? 'vegetable rows' : 'rice field'} — simulated scene" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${p}-sky" x2="0" y2="1"><stop stop-color="#bac6bb"/><stop offset="1" stop-color="#e2dfbb"/></linearGradient><linearGradient id="${p}-earth" x2="0" y2="1"><stop stop-color="#87935d"/><stop offset="1" stop-color="${vegetable ? '#526d3d' : '#80964a'}"/></linearGradient></defs><rect width="380" height="200" fill="url(#${p}-sky)"/><circle cx="288" cy="28" r="20" fill="#eae8c5" opacity=".5"/><path d="M0 72Q45 38 100 66T215 59T380 68V100H0Z" fill="#839a7e" opacity=".5"/><path d="M0 86Q42 65 99 78T220 70T380 77V120H0Z" fill="#698264"/><path d="M0 94Q100 76 193 86T380 90V200H0Z" fill="url(#${p}-earth)"/>${rows}${plants}<path d="M0 105Q210 85 380 105" stroke="#b5ba82" fill="none" stroke-width="3"/>${gate ? '<path d="M178 90 110 200h106L193 90Z" fill="#b7ad82"/><path d="M165 105h49m-51-8v48m49-48v48M161 111l54 17m-54 0 54-17" stroke="#5d634c" stroke-width="3"/><path d="M50 75V43m0 7q-23 7-20 22m20-22q15-19 27-17m-27 17q-20-13-31-5m31 5q22-1 26 16" fill="none" stroke="#536f51" stroke-width="5"/>' : `<rect x="${vegetable ? 178 : 122}" y="115" width="58" height="42" rx="2" stroke="#d1e795" stroke-width="1" fill="#a4c86c18" stroke-dasharray="5 3"/><text x="${vegetable ? 178 : 122}" y="110" fill="#edf4cb" font-size="6" font-family="monospace">SIMULATED DETECTION</text>`}<rect width="380" height="200" fill="#8d9d5e" opacity=".1"/></svg>`;
}
function heroArt() {
  return `<svg class="hero-art" viewBox="0 0 500 180" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><circle cx="375" cy="38" r="29" fill="#dce6bf"/><path d="M0 165Q85 85 205 112T500 57V180H0" fill="#dce5c8"/><path d="M100 180Q250 84 500 107V180" fill="#cbd9ad"/><path d="M205 180Q335 114 500 135V180" fill="#b5c893"/><g fill="none" stroke="#96b178" stroke-width="1.2" opacity=".6"><path d="M175 180Q300 104 500 119M218 180Q350 117 500 131M265 180Q385 130 500 144M316 180Q410 145 500 157M370 180Q436 161 500 170"/></g><path d="M335 122V50" stroke="#738b59" stroke-width="3"/><rect x="324" y="41" width="29" height="14" rx="3" fill="#577347"/><path d="m353 44 9-4v16l-9-4Z" fill="#577347"/><path d="m364 46 23-12m-23 16 25 6" stroke="#92ad71" stroke-dasharray="3 4"/><path d="M440 110V65m0 14q-15-17-21-11m21 11q13-20 22-12m-22 27q-17-14-22-9m22 9q13-16 20-10" fill="none" stroke="#799963" stroke-width="3"/></svg>`;
}
function cameraCard(c) {
  const count = todayEvents().filter(e => e.cameraId === c.id).length;
  return `<article class="camera-card"><button class="camera-preview ${c.online ? '' : 'camera-offline'}" data-action="view-camera" data-id="${esc(c.id)}" aria-label="View ${esc(c.name)} simulated feed">${scene(c.scene,c.id)}<div class="camera-overlays"><span class="feed-badge ${c.online ? '' : 'offline'}"><span class="status-dot"></span>${c.online ? 'DEMO FEED' : 'PAUSED'}</span><span class="feed-clock">${clock(Date.now())} BST</span></div><span class="scene-label">${icon('pin')}${esc(c.zone)}</span><span class="preview-play">${icon('play')}</span></button><div class="camera-meta"><div class="camera-meta-top"><h3>${esc(c.name)}</h3><span class="tag ${!c.online ? 'gray' : count ? 'amber' : ''}">${!c.online ? 'Paused' : count ? `${count} events today` : 'All clear'}</span></div><p>${c.scene === 'gate' ? 'Animal' : 'Pest'} monitoring · Simulated scene</p><div class="camera-footer"><span>${icon(c.online ? 'shield' : 'clock')}${c.online ? 'Monitoring enabled' : 'Monitoring paused'}</span><div class="camera-tools"><button class="icon-button" data-action="edit-camera" data-id="${esc(c.id)}" aria-label="Edit ${esc(c.name)}">${icon('edit')}</button><button class="icon-button" data-action="view-camera" data-id="${esc(c.id)}" aria-label="Open ${esc(c.name)}">${icon('arrow')}</button></div></div></div></article>`;
}
function chart(events,period='today') {
  const buckets = period === 'today' ? Array.from({length:8},(_,i) => ({label:`${String(i*3).padStart(2,'0')}:00`,harmful:0,beneficial:0})) : Array.from({length:7},(_,i) => {
    const at = new Date(Date.now()-(6-i)*86400000);
    return {key:dateKey(at),label:new Intl.DateTimeFormat('en-GB',{timeZone:TZ,weekday:'short'}).format(at),harmful:0,beneficial:0};
  });
  for (const e of events) {
    const b = period === 'today' ? buckets[Math.floor(hour(e.at)/3)] : buckets.find(b => b.key === dateKey(e.at));
    if (b) b[e.harmful ? 'harmful' : 'beneficial']++;
  }
  const top = Math.ceil(Math.max(4,...buckets.map(b => Math.max(b.harmful,b.beneficial)))/4)*4;
  const x=i=>35+i*(465/(buckets.length-1)),y=v=>135-v/top*115;
  const points=key=>buckets.map((b,i)=>`${x(i)},${y(b[key])}`).join(' ');
  return `<svg class="chart" viewBox="0 0 525 168" role="img" aria-label="Detection events: ${buckets.map(b=>`${b.label}, ${b.harmful} harmful, ${b.beneficial} beneficial`).join('; ')}">${Array.from({length:5},(_,i)=>`<path d="M35 ${y(i*top/4)}H500" stroke="#eef1e7" stroke-dasharray="3 4"/><text x="24" y="${y(i*top/4)+3}" text-anchor="end">${i*top/4}</text>`).join('')}<polygon points="35,135 ${points('harmful')} 500,135" fill="#eef3e5"/><polyline points="${points('beneficial')}" stroke="#becfaf" fill="none" stroke-width="1.7"/><polyline points="${points('harmful')}" stroke="#65844b" stroke-width="2" fill="none" stroke-linejoin="round"/>${buckets.map((b,i)=>`<circle cx="${x(i)}" cy="${y(b.harmful)}" r="2.5" fill="#65844b" stroke="white" stroke-width="1.5"/><text x="${x(i)}" y="158" text-anchor="middle">${b.label}</text>`).join('')}</svg>`;
}
const legend = '<div class="chart-legend"><span><i class="legend-dot"></i>Harmful pests</span><span><i class="legend-dot light"></i>Beneficial insects</span></div>';
function recent() {
  return [
    ...state.detections.map(e=>({at:e.at,title:`${e.category} detected`,subtitle:`${cameraName(e.cameraId)} · ${e.confidence}% demo confidence`,symbol:'bug',color:e.harmful?'amber':''})),
    ...state.actions.map(a=>({at:a.at,title:`${a.device} ${a.status.toLowerCase()}`,subtitle:`${cameraName(a.cameraId)} · Simulated action`,symbol:'shield',color:''})),
    ...state.animals.map(e=>({at:e.at,title:`${e.category} near boundary`,subtitle:`${cameraName(e.cameraId)} · ${e.response}`,symbol:'shield',color:'blue'}))
  ].sort((a,b)=>new Date(b.at)-new Date(a.at));
}
const eventRows = events => events.map(e=>`<div class="event-row"><span class="event-icon ${e.color}">${icon(e.symbol)}</span><div class="event-copy"><strong>${esc(e.title)}</strong><p title="${esc(e.subtitle)}">${esc(e.subtitle)}</p></div><time class="event-time" datetime="${e.at}">${relative(e.at)}</time></div>`).join('') || '<p class="muted spaced">No activity yet. Try simulating a detection.</p>';
function nextSchedule() {
  const now=Date.now(),candidates=[];
  for(const s of state.schedules.filter(s=>s.enabled && camera(s.cameraId)?.online)) {
    for(let d=0;d<8;d++) {
      const at=new Date(`${dateKey(now+d*86400000)}T${s.time}:00+06:00`);
      if(at.getTime()>now && s.days.includes(weekday(at))) {candidates.push({...s,at});break;}
    }
  }
  return candidates.sort((a,b)=>a.at-b.at)[0];
}

function overviewPage() {
  const today=todayEvents(),online=state.cameras.filter(c=>c.online).length,next=nextSchedule();
  const actions=state.actions.filter(a=>dateKey(a.at)===dateKey(Date.now()));
  return `${heading('YOUR FARM AT A GLANCE','Good things are growing.','A little insight today. A healthier harvest tomorrow.',`<span class="date-chip">${icon('clock')}${dateLabel(Date.now())}</span>${button('Add camera','add-camera')}`)}
  <section class="overview-hero"><div class="hero-copy"><div class="eyebrow">GROW WITH A LITTLE MORE PEACE OF MIND</div><h2>Your fields, connected.<br>Your crops, protected.</h2><p>One place to monitor, understand, and care for your farm.</p></div>${heroArt()}<span class="hero-status"><span class="status-dot"></span>BUILT FOR YOUR FIELD</span></section>
  <section class="metrics" aria-label="Today’s field summary">${metric('Cameras monitoring',online,`${icon('check')} ${state.cameras.length} cameras in your workspace`,'camera',`/ ${state.cameras.length}`)}${metric('Detection events today',today.length,`${icon('clock')} Sample camera observations`,'bug')}${metric('Harmful pest events',today.filter(e=>e.harmful).length,`${icon('info')} Demo classifications · Not unique pests`,'shield')}${metric('Control actions today',actions.length,`${icon('check')} All device actions are simulated`,'leaf')}</section>
  <section><div class="section-heading"><div><h2>A closer look at your field</h2><p>Your camera network, all in one place.</p></div><a href="#cameras">All cameras ${icon('arrow')}</a></div><div class="camera-grid preview-grid">${state.cameras.slice(0,3).map(cameraCard).join('') || empty('Your field starts here','Add a demo camera to explore your camera dashboard.',button('Add camera','add-camera'))}</div></section>
  <div class="lower-grid"><section class="panel"><div class="panel-heading"><div><h2>Pest activity</h2><p class="panel-subtitle">Understand when your field is most active.</p></div><select class="select-compact" id="activity-period" aria-label="Pest activity period"><option value="today" ${chartPeriod==='today'?'selected':''}>Today</option><option value="week" ${chartPeriod==='week'?'selected':''}>Last 7 days</option></select></div>${legend}${chart(chartPeriod==='today'?today:state.detections,chartPeriod)}<div class="chart-summary">${icon('info')}Events may include repeat sightings of the same insect.</div></section><section class="panel"><div class="panel-heading"><div><h2>Recent field activity</h2><p class="panel-subtitle">A small update from every corner.</p></div><span class="tag gray">DEMO</span></div><div class="event-list">${eventRows(recent().slice(0,4))}</div><a href="#reports" class="panel-link">Explore pest reports ${icon('arrow')}</a></section></div>
  <div class="bottom-strip">${icon('clock')}<div><strong>${next?`Next planned: ${esc(next.name)}`:'Make time for a healthier field'}</strong><p>${next?`${dateLabel(next.at)} at ${timeLabel(next.time)} BST · ${esc(cameraName(next.cameraId))} · ${next.duration} min · Demo only`:'Create a schedule to demonstrate your field care routine.'}</p></div><a href="#schedules" class="button">Manage schedules ${icon('arrow')}</a></div>`;
}
function camerasPage() {
  const visible=state.cameras.filter(c=>cameraFilter==='all'||(cameraFilter==='online'?c.online:!c.online));
  return `${heading('EYES ON YOUR FIELD','Every corner, connected.','Manage your camera network and explore simulated field views.',button('Add camera','add-camera'))}<div class="toolbar"><div class="segmented" aria-label="Filter cameras">${[['all','All cameras'],['online','Monitoring'],['paused','Paused']].map(([key,label])=>`<button data-action="filter-cameras" data-filter="${key}" class="${cameraFilter===key?'selected':''}" aria-pressed="${cameraFilter===key}">${label}</button>`).join('')}</div><span class="camera-count-label">${visible.length} ${visible.length===1?'camera':'cameras'}</span></div><div class="camera-grid">${visible.map(cameraCard).join('')||empty('No cameras here yet',cameraFilter==='all'?'Add your first demo camera, choose a scene, and try pest detection.':'Try another filter or change a camera’s monitoring status.',cameraFilter==='all'?button('Add camera','add-camera'):'')}</div><div class="info-box">${icon('info')}<span>These are illustrated demo scenes. Adding a camera creates a local prototype entry; live streaming and physical camera connections belong to a later phase.</span></div>`;
}
function controlPage() {
  const available=state.cameras.some(c=>c.online),running=!!activeAction;
  return `${heading('CARE, ON YOUR TERMS','You’re in control.','Try manual pest control or plan a routine for later.',`<a class="button button-secondary" href="#schedules">${icon('clock')}View schedules</a>`)}<div class="control-grid"><section class="panel"><h2>Manual pest control</h2><p class="panel-subtitle">Choose a field zone and demonstrate a device action.</p><form id="control-form"><div class="form-field"><label for="control-camera">Camera / field zone</label><select id="control-camera" name="cameraId" required ${!available||running?'disabled':''}>${available?cameraOptions(activeAction?.cameraId,true):'<option value="">No monitoring cameras</option>'}</select></div><div class="form-row"><div class="form-field"><label for="control-device">Control device</label><select id="control-device" name="device" ${running?'disabled':''}>${DEVICES.map(d=>`<option ${activeAction?.device===d?'selected':''}>${d}</option>`).join('')}</select></div><div class="form-field"><label for="control-duration">Duration (minutes)</label><input id="control-duration" name="duration" type="number" min="1" max="120" step="1" value="${activeAction?.duration||2}" required ${running?'disabled':''}></div></div><div class="info-box">${icon('info')}<span>Presentation mode: each selected minute runs for one second. No physical device is connected or activated.</span></div><button class="button ${running?'button-danger':'button-primary'} full" type="${running?'button':'submit'}" ${running?'data-action="stop-control"':''} ${!available&&!running?'disabled':''}>${icon(running?'stop':'play')}${running?'Stop simulation':'Start simulation'}</button>${!available?'<p class="form-note">Add or enable a camera to try manual control.</p>':''}</form></section><section class="panel"><h2>Device status</h2><p class="panel-subtitle">A preview of your future field controller.</p><div class="control-visual ${running?'running':''}"><div class="control-orb">${icon(running?'leaf':'shield')}</div><h3>${running?'Simulation in progress':'Ready when you are'}</h3><p>${running?`${esc(activeAction.device)} · ${esc(cameraName(activeAction.cameraId))}<br><span id="control-countdown">${Math.max(0,Math.ceil((activeAction.endsAt-Date.now())/1000))}</span> demo seconds remaining`:'Choose a zone, set a duration,<br>and start a simulated action.'}</p></div><p class="form-note">You can navigate around the dashboard while a simulation runs. Reloading the page ends it.</p></section></div><section class="panel action-history"><div class="panel-heading"><div><h2>Control history</h2><p class="panel-subtitle">A record of sample and simulated device actions.</p></div><span class="tag gray">${state.actions.length} actions</span></div><div class="table-wrap"><table><thead><tr><th>Device</th><th>Field zone</th><th>Time (BST)</th><th>Duration</th><th>Status</th></tr></thead><tbody>${[...state.actions].reverse().slice(0,20).map(a=>`<tr><td><strong>${esc(a.device)}</strong><small>${esc(a.source)}</small></td><td>${esc(cameraName(a.cameraId))}</td><td>${clock(a.at)}<small>${dateLabel(a.at)}</small></td><td>${a.duration} min<small>Simulated</small></td><td><span class="tag ${a.status==='Stopped'?'amber':a.status==='Interrupted'?'gray':''}">${esc(a.status)}</span></td></tr>`).join('')||'<tr><td colspan="5" class="empty-cell">No actions yet.</td></tr>'}</tbody></table></div></section>`;
}
function schedulesPage() {
  return `${heading('A ROUTINE THAT WORKS FOR YOU','Set it. Grow with it.','Create as many field care schedules as you need.',button('Add schedule','add-schedule'))}<div class="schedule-summary"><span class="summary-pill">${icon('clock')}${state.schedules.length} schedules</span><span class="summary-pill">${icon('check')}${state.schedules.filter(s=>s.enabled).length} enabled</span><span class="summary-pill">${icon('pin')}Asia/Dhaka (BST, UTC+6)</span></div><section class="panel"><h2>Your field care routine</h2><p class="panel-subtitle">Repeat on selected days, at a time that suits your field.</p>${state.schedules.length?`<div class="table-wrap"><table><thead><tr><th>Schedule</th><th>Time (BST)</th><th>Repeat</th><th>Duration</th><th>Enabled</th><th>Manage</th></tr></thead><tbody>${state.schedules.map(s=>`<tr><td><strong>${esc(s.name)}</strong><small>${esc(cameraName(s.cameraId))} · ${esc(s.device)}</small>${!camera(s.cameraId)?.online?'<small class="danger-text">Camera paused · Simulation unavailable</small>':''}</td><td>${timeLabel(s.time)}</td><td class="day-display">${s.days.length===7?'Every day':s.days.map(d=>DAYS[d]).join(', ')}</td><td>${s.duration} min</td><td><button class="toggle" role="switch" aria-checked="${s.enabled}" aria-label="Enable ${esc(s.name)}" data-action="toggle-schedule" data-id="${esc(s.id)}"></button></td><td><div class="table-actions"><button class="icon-button" data-action="run-schedule" data-id="${esc(s.id)}" aria-label="Simulate ${esc(s.name)}" ${!s.enabled||!camera(s.cameraId)?.online||activeAction?'disabled':''}>${icon('play')}</button><button class="icon-button" data-action="edit-schedule" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">${icon('edit')}</button><button class="icon-button danger-text" data-action="delete-schedule" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>`:`<div class="spaced">${empty('Make your first routine','Set a time, select repeat days, and choose a control device.',button('Add schedule','add-schedule'),'clock')}</div>`}<p class="schedule-hint">Demo schedules do not run in the background. Use a play button to demonstrate an enabled schedule immediately. One selected minute is compressed to one second.</p></section>`;
}
function animalsPage() {
  const available=state.cameras.some(c=>c.online);
  return `${heading('A GENTLER WAY TO PROTECT','Give your crops some space.','Explore automatic animal detection and deterrence settings.')}<section class="animal-banner">${icon('shield')}<div><h2>Animal guard is ${state.guard.enabled?'enabled':'paused'}.</h2><p>Demo automation · Detect an animal, then demonstrate a gentle response.</p></div><button class="toggle" role="switch" aria-checked="${state.guard.enabled}" aria-label="Enable automatic animal guard" data-action="toggle-guard" data-key="enabled"></button></section><div class="control-grid"><section class="panel"><h2>Deterrence settings</h2><p class="panel-subtitle">Choose how your future field system will respond.</p>${[['sound','bell','Sound deterrent','Simulate an audible alert near the field boundary.'],['light','sun','Light deterrent','Simulate a warning light when an animal is detected.']].map(([key,symbol,title,desc])=>`<div class="setting-row">${icon(symbol)}<div><h3>${title}</h3><p>${desc}</p></div><button class="toggle" role="switch" aria-checked="${state.guard[key]}" aria-label="Enable ${key} deterrent" data-action="toggle-guard" data-key="${key}"></button></div>`).join('')}<div class="setting-row">${icon('clock')}<div><h3>Response cooldown</h3><p>Wait before another simulated response.</p></div><select class="settings-select" id="guard-cooldown" aria-label="Animal guard cooldown">${[1,5,10,15].map(v=>`<option value="${v}" ${v===state.guard.cooldown?'selected':''}>${v} min</option>`).join('')}</select></div></section><section class="panel"><h2>Try a boundary event</h2><p class="panel-subtitle">Demonstrate the detection-to-response flow.</p><form id="animal-form"><div class="form-field"><label for="animal-camera">Monitoring camera</label><select id="animal-camera" name="cameraId" required ${!available?'disabled':''}>${available?cameraOptions(state.cameras.find(c=>c.online&&c.scene==='gate')?.id,true):'<option value="">No monitoring cameras</option>'}</select></div><div class="form-field"><label for="animal-type">Animal type</label><select id="animal-type" name="category"><option>Cattle</option><option>Goat</option><option>Deer</option></select></div><button class="button button-primary full" type="submit" ${!available?'disabled':''}>${icon('play')}Simulate animal detection</button></form><p class="form-note">No audio or lights are operated. Demo cooldown minutes are compressed to seconds.</p></section></div><section class="panel spaced"><h2>Boundary activity</h2><p class="panel-subtitle">See how the prototype responded to each detection.</p><div class="table-wrap"><table><thead><tr><th>Animal</th><th>Camera</th><th>Time (BST)</th><th>Demo response</th></tr></thead><tbody>${[...state.animals].reverse().slice(0,20).map(e=>`<tr><td><strong>${esc(e.category)}</strong></td><td>${esc(cameraName(e.cameraId))}</td><td>${clock(e.at)}<small>${dateLabel(e.at)}</small></td><td>${esc(e.response)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-cell">No boundary events yet.</td></tr>'}</tbody></table></div></section>`;
}
function filteredEvents() {
  const earliest=dateKey(Date.now()-(reportDays-1)*86400000);
  return state.detections.filter(e=>dateKey(e.at)>=earliest&&(reportCamera==='all'||e.cameraId===reportCamera));
}
function reportsPage() {
  const events=filteredEvents(),harmful=events.filter(e=>e.harmful).length;
  const counts=CATEGORIES.map(category=>({category,count:events.filter(e=>e.category===category).length})).sort((a,b)=>b.count-a.count);
  const hours=Array.from({length:24},(_,h)=>({hour:h,count:events.filter(e=>hour(e.at)===h).length})).sort((a,b)=>b.count-a.count);
  const peak=events.length?timeLabel(`${String(hours[0].hour).padStart(2,'0')}:00`):'—';
  return `${heading('TURN OBSERVATIONS INTO INSIGHT','Know your field a little better.','Discover activity patterns, common pests, and the story behind the numbers.',button('Export CSV','export','secondary','download'),'reports-heading')}<div class="toolbar"><div class="report-filters"><select class="select-compact" id="report-period" aria-label="Report date range"><option value="7" ${reportDays===7?'selected':''}>Last 7 days</option><option value="30" ${reportDays===30?'selected':''}>Last 30 days</option></select><select class="select-compact" id="report-camera" aria-label="Filter report by camera"><option value="all">All cameras (including removed)</option>${cameraOptions(reportCamera)}</select></div><span class="list-caption">${icon('info')}Sample & simulated events</span></div><section class="metrics">${metric('Detection events',events.length,'Repeat sightings can be included','bug')}${metric('Harmful classifications',harmful,`${events.length?Math.round(harmful/events.length*100):0}% of selected events`,'shield')}${metric('Most active hour',peak,'BST · Highest number of events','clock')}${metric('Categories observed',counts.filter(c=>c.count>0).length,'Includes beneficial insects','chart')}</section><div class="report-grid"><section class="panel"><h2>Activity through the day</h2><p class="panel-subtitle">Events grouped by time across the selected period.</p>${legend}${chart(events)}<p class="report-explainer">Three-hour intervals · Asia/Dhaka. Counts are observations, not a measured pest population.</p></section><section class="panel"><h2>Who’s visiting your field?</h2><p class="panel-subtitle">Categories ranked by detection events.</p><div class="spaced">${counts.map(c=>`<div class="category-row"><span>${c.category}</span><div class="category-bar"><span style="width:${counts[0].count?c.count/counts[0].count*100:0}%"></span></div><span>${c.count}</span></div>`).join('')}</div><p class="report-explainer">Ladybird beetles are beneficial in this demo. All classifications are illustrative.</p></section></div><section class="panel"><div class="panel-heading"><div><h2>Detection log</h2><p class="panel-subtitle">Latest ${Math.min(events.length,30)} of ${events.length} events. Export for the full list.</p></div>${button('Simulate detection','simulate-pest','secondary')}</div><div class="table-wrap"><table><thead><tr><th>Pest category</th><th>Camera</th><th>Time (BST)</th><th>Classification</th><th>Demo confidence</th></tr></thead><tbody>${[...events].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,30).map(e=>`<tr><td><strong>${esc(e.category)}</strong></td><td>${esc(cameraName(e.cameraId))}</td><td>${clock(e.at)}<small>${dateLabel(e.at)}</small></td><td><span class="tag ${e.harmful?'amber':''}">${e.harmful?'Harmful':'Beneficial'}</span></td><td>${e.confidence}%</td></tr>`).join('')||'<tr><td colspan="5" class="empty-cell">No events match these filters.</td></tr>'}</tbody></table></div></section>`;
}

function render() {
  const requested=location.hash.slice(1)||'overview';
  page=Object.hasOwn(PAGES,requested)?requested:'overview';
  if(reportCamera!=='all'&&!camera(reportCamera)) reportCamera='all';
  const views={overview:overviewPage,cameras:camerasPage,control:controlPage,schedules:schedulesPage,animals:animalsPage,reports:reportsPage};
  content.innerHTML=views[page]();
  document.querySelector('#breadcrumb-page').textContent=PAGES[page];
  document.querySelector('#camera-count').textContent=state.cameras.length;
  document.title=`${PAGES[page]} · FosholBondhu`;
  document.querySelectorAll('[data-page]').forEach(link=>{
    const active=link.dataset.page===page;link.classList.toggle('active',active);
    if(active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
}
function openModal(title,body,wide=false) {
  if(!modal.open) returnFocus=document.activeElement;
  modal.classList.toggle('wide-modal',wide);
  document.querySelector('#modal-content').innerHTML=`<div class="modal-inner"><div class="modal-heading"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${body}</div>`;
  if(!modal.open) modal.showModal();
  modal.querySelector('input:not([type="checkbox"]),select')?.focus();
}
const closeModal=()=>modal.close();
function formError(text) {const el=document.querySelector('#form-error');if(el){el.textContent=text;el.setAttribute('role','alert');}}
function cameraForm(id) {
  const c=camera(id);selectedCamera=null;
  openModal(c?'A camera, your way.':'Add eyes to your field.',`<p class="modal-copy">${c?'Update this demo camera’s name and location.':'Create a demo camera. No hardware or stream URL is required.'}</p><form id="camera-form" data-id="${esc(c?.id||'')}"><div class="form-field"><label for="camera-name">Camera name</label><input id="camera-name" name="name" maxlength="45" placeholder="e.g. West paddy field" value="${esc(c?.name||'')}" required></div><div class="form-field"><label for="camera-zone">Field location</label><input id="camera-zone" name="zone" maxlength="60" placeholder="e.g. Rice · West plot" value="${esc(c?.zone||'')}" required></div><div class="form-field"><label for="camera-scene">Illustrated demo scene</label><select id="camera-scene" name="scene">${[['rice','Rice field'],['vegetables','Vegetable patch'],['gate','Field entrance']].map(([value,label])=>`<option value="${value}" ${c?.scene===value?'selected':''}>${label}</option>`).join('')}</select></div><p class="modal-error" id="form-error"></p><div class="form-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${icon(c?'check':'plus')}${c?'Save camera':'Add camera'}</button></div></form>`);
}
function viewCamera(id) {
  const c=camera(id);if(!c)return;selectedCamera=id;
  const latest=[...state.detections].filter(e=>e.cameraId===id).sort((a,b)=>new Date(b.at)-new Date(a.at))[0];
  openModal(esc(c.name),`<p class="modal-copy">${esc(c.zone)} · Illustrated camera preview</p><div class="modal-camera-scene ${c.online?'':'camera-offline'}">${scene(c.scene,c.id,true)}<span class="feed-badge ${c.online?'':'offline'}"><span class="status-dot"></span>${c.online?'SIMULATED FEED':'MONITORING PAUSED'}</span></div><dl class="modal-details"><div><dt>Monitoring</dt><dd>${c.online?'Enabled':'Paused'}</dd></div><div><dt>Events today</dt><dd>${todayEvents().filter(e=>e.cameraId===id).length}</dd></div></dl><p class="modal-detection">${latest?`Latest event: ${esc(latest.category)} · ${relative(latest.at)}`:'No pest events recorded for this camera.'}</p><div class="form-actions"><button class="button button-secondary" data-action="toggle-camera" data-id="${esc(id)}">${icon(c.online?'stop':'play')}${c.online?'Pause monitoring':'Resume monitoring'}</button><button class="button button-primary" data-action="simulate-pest" data-id="${esc(id)}" ${c.online?'':'disabled'}>${icon('plus')}Demo detection</button></div><button class="reset-button" data-action="delete-camera" data-id="${esc(id)}">Remove this camera</button>`,true);
}
function scheduleForm(id) {
  const s=state.schedules.find(s=>s.id===id);selectedCamera=null;
  if(!state.cameras.length){toast('Add a camera before creating a schedule.');cameraForm();return;}
  const days=s?.days||[0,1,2,3,4,5,6];
  openModal(s?'Fine-tune your routine.':'Make time for your field.',`<p class="modal-copy">Create a repeatable demo routine. Times use Bangladesh Standard Time (UTC+6).</p><form id="schedule-form" data-id="${esc(s?.id||'')}"><div class="form-field"><label for="schedule-name">Schedule name</label><input id="schedule-name" name="name" value="${esc(s?.name||'')}" maxlength="60" placeholder="e.g. Evening crop care" required></div><div class="form-field"><label for="schedule-camera">Camera / field zone</label><select id="schedule-camera" name="cameraId" required>${cameraOptions(s?.cameraId)}</select></div><div class="form-row"><div class="form-field"><label for="schedule-time">Start time (BST)</label><input id="schedule-time" name="time" type="time" value="${s?.time||'18:00'}" required></div><div class="form-field"><label for="schedule-duration">Duration (minutes)</label><input id="schedule-duration" name="duration" type="number" min="1" max="120" step="1" value="${s?.duration||5}" required></div></div><div class="form-field"><label for="schedule-device">Control device</label><select id="schedule-device" name="device">${DEVICES.map(d=>`<option ${s?.device===d?'selected':''}>${d}</option>`).join('')}</select></div><fieldset class="days-fieldset"><legend class="field-label">Repeat on</legend><div class="day-options">${DAYS.map((day,i)=>`<label class="day-option"><input name="days" type="checkbox" value="${i}" ${days.includes(i)?'checked':''}><span>${day}</span></label>`).join('')}</div></fieldset><p class="modal-error" id="form-error"></p><div class="form-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${icon('check')}Save schedule</button></div></form>`);
}
function simulatePest(id) {
  const c=camera(id)||state.cameras.find(c=>c.online);
  if(!c?.online){toast('Add or enable a camera to simulate a detection.');return;}
  const category=CATEGORIES[Math.floor(Math.random()*CATEGORIES.length)];
  state.detections.push({id:uid(),at:new Date().toISOString(),category,cameraId:c.id,harmful:category!=='Ladybird beetle',confidence:88+Math.floor(Math.random()*11)});
  save();render();if(modal.open&&selectedCamera===c.id)viewCamera(c.id);
  toast(`${category} recorded at ${c.name}. Demo data only.`);
}
function startControl(cameraId,device,duration,source='Manual simulation') {
  if(activeAction){toast('A simulation is already running. Stop it before starting another.');return;}
  if(!camera(cameraId)?.online){toast('Choose a camera with monitoring enabled.');return;}
  if(!Number.isInteger(duration)||duration<1||duration>120||!DEVICES.includes(device))return;
  const id=uid();state.actions.push({id,at:new Date().toISOString(),cameraId,device,duration,status:'Running',source});
  activeAction={id,cameraId,device,duration,endsAt:Date.now()+duration*1000};
  save();render();toast(`${device} simulation started. No equipment is connected.`);
  actionTimer=setInterval(()=>{
    if(!activeAction)return;
    const remaining=Math.max(0,Math.ceil((activeAction.endsAt-Date.now())/1000));
    const counter=document.querySelector('#control-countdown');if(counter)counter.textContent=remaining;
    if(!remaining)finishControl('Completed');
  },200);
}
function finishControl(status) {
  if(!activeAction)return;clearInterval(actionTimer);
  const action=state.actions.find(a=>a.id===activeAction.id);if(action)action.status=status;
  activeAction=null;save();render();toast(`Simulation ${status.toLowerCase()}. The action is saved in control history.`);
}
function confirmDelete(type,id) {
  const item=type==='camera'?camera(id):state.schedules.find(s=>s.id===id);if(!item)return;
  pendingDelete={type,id};const affected=type==='camera'?state.schedules.filter(s=>s.cameraId===id).length:0;
  openModal(`Remove this ${type}?`,`<p class="modal-copy"><strong>${esc(item.name)}</strong> will be removed from this demo.${affected?` Its ${affected} linked ${affected===1?'schedule will':'schedules will'} also be removed.`:''}${type==='camera'?' Historical events will remain in reports.':''}</p><div class="form-actions"><button class="button button-secondary" data-action="close-modal">Keep ${type}</button><button class="button button-danger" data-action="confirm-delete">${icon('trash')}Remove ${type}</button></div>`);
}
function about() {
  selectedCamera=null;
  openModal('A friend to your harvest.',`<div class="modal-copy"><p><strong>FosholBondhu</strong> is a website proposal for monitoring pests, managing crop protection, and understanding field activity.</p><p>This prototype uses illustrated camera scenes and generated sample observations. Manual control, schedules, and animal responses are demonstrations. <strong>No camera, AI model, or physical device is connected.</strong></p><p>Changes are saved in this browser. Schedules do not execute automatically or after you close the page. Hardware integration is a future project phase.</p></div><div class="about-features">${[['camera','Camera management'],['bug','Manual pest control'],['clock','Multiple schedules'],['shield','Animal guard'],['chart','Pest activity reports'],['download','CSV export']].map(([i,label])=>`<span>${icon(i)}${label}</span>`).join('')}</div><div class="form-actions"><button class="button button-primary" data-action="close-modal">Explore the demo ${icon('arrow')}</button></div><button class="reset-button" data-action="reset-demo">Reset to original demo data</button>`);
}
function csvCell(value) {
  let text=String(value);if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
function exportReport() {
  const rows=[['Timestamp (Asia/Dhaka)','Category','Camera','Classification','Demo confidence (%)','Source'],...filteredEvents().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(e=>[`${dateKey(e.at)} ${clock(e.at)} +06:00`,e.category,cameraName(e.cameraId),e.harmful?'Harmful':'Beneficial',e.confidence,'Simulated data'])];
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`FosholBondhu-demo-${reportDays}days-${dateKey(Date.now())}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast(`Exported ${rows.length-1} demo events matching your filters.`);
}

document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const {action,id,key,filter}=target.dataset;
  switch(action){
    case 'about':about();break;
    case 'close-modal':closeModal();break;
    case 'add-camera':cameraForm();break;
    case 'edit-camera':cameraForm(id);break;
    case 'view-camera':viewCamera(id);break;
    case 'filter-cameras':cameraFilter=filter;render();break;
    case 'toggle-camera':{
      const c=camera(id);if(!c)break;c.online=!c.online;
      if(!c.online&&activeAction?.cameraId===id)finishControl('Stopped');
      save();render();viewCamera(id);toast(`Monitoring ${c.online?'resumed':'paused'} for ${c.name}.`);break;
    }
    case 'delete-camera':confirmDelete('camera',id);break;
    case 'add-schedule':scheduleForm();break;
    case 'edit-schedule':scheduleForm(id);break;
    case 'delete-schedule':confirmDelete('schedule',id);break;
    case 'toggle-schedule':{
      const s=state.schedules.find(s=>s.id===id);if(!s)break;s.enabled=!s.enabled;save();render();
      toast(`Schedule ${s.enabled?'enabled':'paused'}. Demo schedules do not run in the background.`);break;
    }
    case 'run-schedule':{const s=state.schedules.find(s=>s.id===id);if(s?.enabled)startControl(s.cameraId,s.device,s.duration,`Schedule demo: ${s.name}`);break;}
    case 'stop-control':finishControl('Stopped');break;
    case 'simulate-pest':simulatePest(id);break;
    case 'toggle-guard':if(['enabled','sound','light'].includes(key)){state.guard[key]=!state.guard[key];save();render();toast('Animal guard settings saved for this demo.');}break;
    case 'export':exportReport();break;
    case 'notifications':selectedCamera=null;openModal('The latest from your field.',`<p class="modal-copy">Recent sample and simulated activity.</p><div class="event-list">${eventRows(recent().slice(0,7))}</div>`);break;
    case 'confirm-delete':{
      if(!pendingDelete)break;const {type,id:removeId}=pendingDelete;
      if(type==='camera'){
        if(activeAction?.cameraId===removeId)finishControl('Stopped');
        state.cameras=state.cameras.filter(c=>c.id!==removeId);state.schedules=state.schedules.filter(s=>s.cameraId!==removeId);
      }else state.schedules=state.schedules.filter(s=>s.id!==removeId);
      pendingDelete=null;selectedCamera=null;save();closeModal();render();toast(`${type==='camera'?'Camera':'Schedule'} removed from the demo.`);break;
    }
    case 'reset-demo':openModal('Start fresh?',`<p class="modal-copy">This replaces locally saved cameras, schedules, settings, and history with the original sample data.</p><div class="form-actions"><button class="button button-secondary" data-action="close-modal">Keep my changes</button><button class="button button-danger" data-action="confirm-reset">Reset demo data</button></div>`);break;
    case 'confirm-reset':clearInterval(actionTimer);activeAction=null;state=seed();reportCamera='all';cameraFilter='all';save();closeModal();render();toast('Original sample data restored.');break;
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!['camera-form','schedule-form','control-form','animal-form'].includes(form.id))return;
  event.preventDefault();const data=new FormData(form);
  if(form.id==='camera-form'){
    const name=data.get('name').trim(),zone=data.get('zone').trim();
    if(!name||!zone){formError('Please enter a camera name and field location.');return;}
    const existing=camera(form.dataset.id);
    if(state.cameras.some(c=>c.id!==existing?.id&&c.name.toLowerCase()===name.toLowerCase())){formError('That camera name is already in use. Try another name.');return;}
    const values={name,zone,scene:data.get('scene')};
    if(existing)Object.assign(existing,values);else state.cameras.push({id:uid(),...values,online:true});
    cameraFilter='all';save();closeModal();render();toast(existing?'Camera settings updated.':'Demo camera added. Open its preview to simulate a detection.');
  }
  if(form.id==='schedule-form'){
    const days=data.getAll('days').map(Number),name=data.get('name').trim(),duration=Number(data.get('duration'));
    if(!name||!days.length){formError('Enter a name and select at least one repeat day.');return;}
    if(!camera(data.get('cameraId'))||!Number.isInteger(duration)||duration<1||duration>120){formError('Select a camera and a duration between 1 and 120 minutes.');return;}
    const values={name,cameraId:data.get('cameraId'),device:data.get('device'),time:data.get('time'),days,duration};
    const existing=state.schedules.find(s=>s.id===form.dataset.id);
    if(existing)Object.assign(existing,values);else state.schedules.push({id:uid(),...values,enabled:true});
    save();closeModal();render();toast('Schedule saved. Use its play button to demonstrate the routine.');
  }
  if(form.id==='control-form')startControl(data.get('cameraId'),data.get('device'),Number(data.get('duration')));
  if(form.id==='animal-form'){
    const c=camera(data.get('cameraId'));if(!c?.online)return;
    const last=[...state.animals].reverse().find(e=>e.responded);
    const cooldown=last&&Date.now()-new Date(last.at).getTime()<state.guard.cooldown*1000;
    const methods=[state.guard.sound?'Sound':'',state.guard.light?'light':''].filter(Boolean);
    const responded=!!(state.guard.enabled&&!cooldown&&methods.length);
    const response=!state.guard.enabled?'Recorded only · Guard paused':cooldown?'Recorded only · Cooldown active':methods.length?`${methods.join(' + ')} (simulated)`:'Recorded only · No deterrents enabled';
    state.animals.push({id:uid(),at:new Date().toISOString(),cameraId:c.id,category:data.get('category'),response,responded});
    save();render();toast(`Demo animal detection: ${response}.`);
  }
});
document.addEventListener('change',event=>{
  const {id,value}=event.target;
  if(id==='activity-period'){chartPeriod=value;render();}
  if(id==='report-period'){reportDays=Number(value);render();}
  if(id==='report-camera'){reportCamera=value;render();}
  if(id==='guard-cooldown'){state.guard.cooldown=Number(value);save();toast('Demo cooldown saved.');}
});
function closeMenu(){document.querySelector('#sidebar').classList.remove('open');document.querySelector('#sidebar-backdrop').classList.remove('open');document.querySelector('#menu-button').setAttribute('aria-expanded','false');}
document.querySelector('#menu-button').addEventListener('click',()=>{
  const open=document.querySelector('#sidebar').classList.toggle('open');document.querySelector('#sidebar-backdrop').classList.toggle('open',open);document.querySelector('#menu-button').setAttribute('aria-expanded',String(open));
});
document.querySelector('#sidebar-backdrop').addEventListener('click',closeMenu);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
modal.addEventListener('close',()=>{selectedCamera=null;pendingDelete=null;if(returnFocus?.isConnected)returnFocus.focus();else document.querySelector('#main').focus({preventScroll:true});});
window.addEventListener('hashchange',()=>{closeMenu();render();window.scrollTo({top:0,behavior:'instant'});});
// Reloading ends a simulation; a saved history record must not look live.
let recovered=false;for(const action of state.actions)if(action.status==='Running'){action.status='Interrupted';recovered=true;}
if(recovered)save();
render();
if(storageWarning)toast('Browser storage is unavailable. This demo works for the current session.');

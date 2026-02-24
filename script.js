// GSC Office – localStorage-backed SPA with optional MySQL sync
// ─────────────────────────────────────────────────────────────
const LS = {
  users:   'et_users',
  clients: 'et_clients',
  tasks:   'et_tasks',
  session: 'et_session',
  events:  'et_events',
  leaves:  'et_leaves',
  notifs:  'et_notifs',
};

// Create-task status toggle state
let _newTaskStatus = 'incomplete';

// Calendar state
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calView  = 'month';   // 'month' | 'week'
let _calOwner = null;      // null = self; admin can set to any userId
let _calAddMode = 'event'; // 'event' | 'task'
let _statsWeekOffset = 0; // 0=current week, 1=last week, etc.
let _tasksWeekOffset = 0; // for task list week navigation
let _calTaskStatus = 'incomplete'; // for cal task modal

// Task date filter (empty = show all)
let _taskDate = '';

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
function uid(p='id'){ return p + Math.random().toString(36).slice(2,9) }
function load(k){ try{ return JSON.parse(localStorage.getItem(k)||'null') }catch(e){ return null } }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)) }
function qs(id){ return document.getElementById(id) }
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function toHHMM(s){ return s ? String(s).slice(0,5) : ''; }

function getWeekRange(offset){
  offset = offset||0;
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow===0?6:dow-1) - offset*7);
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate()+6);
  return { start:_calDateStr(monday), end:_calDateStr(sunday) };
}

function getUserName(id){
  const u = (load(LS.users)||[]).find(x => x.id === id);
  return u ? u.name : '(unknown)';
}

// Format "2025-02-20T09:00 → 17:30" style range
function fmtRange(start, end){
  if(!start) return '';
  const fmtTime = s => new Date(s).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false});
  const fmtDate = s => {
    const d = new Date(s);
    return d.toLocaleDateString([], {month:'short', day:'numeric'});
  };
  return fmtDate(start) + ' ' + fmtTime(start) + (end ? ' – ' + fmtTime(end) : '');
}

// ═══════════════════════════════════════════════════════════
//  SERVER HELPERS
// ═══════════════════════════════════════════════════════════
async function serverOk(){
  try{
    const r = await fetch('/api/ping', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  }catch(e){ return false }
}

async function apiCall(method, url, body){
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if(!r.ok){ const e = await r.json().catch(()=>null); throw new Error((e&&e.message)||r.status) }
  return r.json();
}

async function syncFromServer(){
  try{
    const d = await apiCall('GET', '/api/sync');
    if(d.users)   save(LS.users,   d.users);
    if(d.clients) save(LS.clients, d.clients);
    if(d.tasks)   save(LS.tasks,   d.tasks);
    if(d.events)  save(LS.events,  d.events);
    if(d.leaves)  save(LS.leaves,  d.leaves);
    if(d.notifs)  save(LS.notifs,  d.notifs);
    return true;
  }catch(e){ return false }
}

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
function currentUser(){
  const s = load(LS.session); if(!s) return null;
  return (load(LS.users)||[]).find(u => u.id === s.userId) || null;
}
function logout(){ localStorage.removeItem(LS.session); showLogin() }

// ═══════════════════════════════════════════════════════════
//  SEEDING
// ═══════════════════════════════════════════════════════════
async function seedIfEmpty(){
  if(await serverOk()){
    const ok = await syncFromServer();
    if(ok) return;
  }
  if(!load(LS.users)) save(LS.users, [
    {id:uid('u_'),name:'Admin User',  username:'admin',password:'admin123',role:'admin',   photo:''},
    {id:uid('u_'),name:'Alice Johnson',username:'alice',password:'alice123',role:'employee',photo:''},
    {id:uid('u_'),name:'Bob Smith',   username:'bob',  password:'bob123',  role:'employee',photo:''},
  ]);
  if(!load(LS.clients)) save(LS.clients, [
    {id:uid('c_'),name:'Acme Co', subscription:'Premium'},
    {id:uid('c_'),name:'Beta LLC',subscription:'Standard'},
  ]);
  if(!load(LS.events)) save(LS.events, []);
  if(!load(LS.leaves)) save(LS.leaves, []);
  if(!load(LS.notifs)) save(LS.notifs, []);
  if(!load(LS.tasks))  save(LS.tasks,  [{id:uid('t_'),title:'Onboard Acme',assignedTo:null,due:null,completed:false}]);
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════
function showToast(msg, ms=2400){
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.style.zIndex = '99999';
  document.body.appendChild(t);
  setTimeout(()=>{ try{ t.remove() }catch(e){} }, ms);
}

function showLogin(){
  qs('login-view').classList.remove('hidden');
  qs('main-app').classList.add('hidden');
  const card = qs('login-view').querySelector('.login-card');
  if(card){ card.classList.remove('enter'); setTimeout(()=>card.classList.add('enter'), 60) }
}

function showApp(){ qs('login-view').classList.add('hidden'); qs('main-app').classList.remove('hidden') }

function renderSidebar(){
  const u = currentUser(); if(!u) return;
  const pp = qs('profile-photo'); if(pp) pp.src = u.photo || 'https://via.placeholder.com/72';
  const pn = qs('profile-name');  if(pn) pn.textContent = u.name;
  const pr = qs('profile-role');  if(pr) pr.textContent = u.role === 'admin' ? 'Admin' : 'Employee';
  // Date in sidebar
  const sd = qs('sidebar-date');
  if(sd) sd.textContent = new Date().toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
  // Header greeting
  const hg = qs('header-greeting');
  if(hg){
    const hr = new Date().getHours();
    hg.textContent = (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + ', ' + u.name.split(' ')[0] + '.';
  }
  // Admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    if(u.role === 'admin') el.classList.remove('hidden'); else el.classList.add('hidden');
  });
}

function switchNav(view){
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const titles = { dashboard:'Dashboard', profile:'Profile', utilities:'Utilities', reports:'Reports', admin:'Admin Panel', calendar:'Calendar', notifications:'Notifications', leaves:'Leave Management' };
  const ct = qs('content-title'); if(ct) ct.textContent = titles[view] || view;

  if(view === 'dashboard'){ qs('dashboard-view').classList.remove('hidden') }
  if(view === 'profile'){
    qs('profile-view').classList.remove('hidden');
    renderProfile(window._profileTargetId || undefined);
    window._profileTargetId = null;
  }
  if(view === 'reports'){   qs('reports-view').classList.remove('hidden'); renderReports() }
  if(view === 'admin'){     qs('admin-view').classList.remove('hidden'); renderAdminAll() }
  if(view === 'calendar'){  qs('calendar-view').classList.remove('hidden'); renderCalendar() }
  if(view === 'notifications'){ qs('notifications-view').classList.remove('hidden'); renderNotifications() }
  if(view === 'leaves'){    qs('leaves-view').classList.remove('hidden'); renderLeaves() }
}

function activateTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

function updateCounts(){
  const u = currentUser(); if(!u) return;
  const tasks = load(LS.tasks)||[];
  const el = qs('tasks-count');
  if(el) el.textContent = tasks.filter(t => !t.completed && (u.role==='admin' || t.assignedTo===u.id)).length;
  updateNotifBadge();
}

function updateNotifBadge(){
  const u = currentUser(); if(!u) return;
  const notifs = load(LS.notifs)||[];
  const unread = notifs.filter(n => { if(n.type==='leave'&&u.role!=='admin') return false; return !(n.readBy||[]).includes(u.id); }).length;
  const el = qs('notif-count');
  if(el){ el.textContent = unread; el.dataset.zero = unread === 0 ? 'true' : 'false'; }
}

// ═══════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function addNotification(message, type='custom', refId=null){
  const user = currentUser();
  const n = { id:uid('n_'), message, type, refId: refId||null, createdBy: user?.id||null, createdAt: new Date().toISOString(), readBy:[] };
  const notifs = load(LS.notifs)||[];
  notifs.unshift(n);
  save(LS.notifs, notifs);
  updateNotifBadge();
  serverOk().then(ok => {
    if(ok) apiCall('POST', '/api/notifications', n).catch(()=>{});
  });
  return n;
}

function renderNotifications(){
  const u = currentUser(); if(!u) return;
  const notifs = load(LS.notifs)||[];
  const el = qs('notifs-list'); if(!el) return; el.innerHTML = '';
  const visible = notifs.filter(n => !(n.type==='leave' && u.role!=='admin'));
  if(visible.length === 0){
    el.innerHTML = '<p class="muted" style="padding:16px 0">No notifications yet.</p>';
    return;
  }
  visible.forEach(n => {
    const isRead = (n.readBy||[]).includes(u.id);
    const item = document.createElement('div');
    item.className = 'notif-item ' + (isRead ? 'read' : 'unread');
    const typeLabel = {leave:'Leave',task:'Task',custom:'Message'}[n.type] || n.type;
    const fmtTime = s => { try{ return new Date(s).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) }catch(e){ return '' } };
    item.innerHTML = `
      <div class="notif-dot"></div>
      <div class="notif-body">
        <div class="notif-msg">${escapeHtml(n.message)}<span class="notif-type-badge notif-type-${n.type}">${typeLabel}</span></div>
        <div class="notif-meta">${fmtTime(n.createdAt)}${n.createdBy && n.createdBy !== u.id ? ' · from ' + escapeHtml(getUserName(n.createdBy)) : ''}</div>
      </div>`;
    if(!isRead){
      item.style.cursor = 'pointer';
      item.onclick = () => markNotifRead(n.id);
    }
    el.appendChild(item);
  });
}

function markNotifRead(notifId){
  const u = currentUser(); if(!u) return;
  const notifs = load(LS.notifs)||[];
  const n = notifs.find(x=>x.id===notifId); if(!n) return;
  if(!(n.readBy||[]).includes(u.id)){
    n.readBy = [...(n.readBy||[]), u.id];
    save(LS.notifs, notifs);
    serverOk().then(ok => {
      if(ok) apiCall('PUT', `/api/notifications/${notifId}`, {readBy:n.readBy}).catch(()=>{});
    });
  }
  renderNotifications(); updateNotifBadge();
}

function markAllNotifsRead(){
  const u = currentUser(); if(!u) return;
  const notifs = load(LS.notifs)||[];
  let changed = false;
  notifs.forEach(n => {
    if(!(n.readBy||[]).includes(u.id)){ n.readBy = [...(n.readBy||[]), u.id]; changed = true; }
  });
  if(changed){
    save(LS.notifs, notifs);
    notifs.forEach(n => {
      serverOk().then(ok => {
        if(ok) apiCall('PUT', `/api/notifications/${n.id}`, {readBy:n.readBy}).catch(()=>{});
      });
    });
  }
  renderNotifications(); updateNotifBadge();
}

// ═══════════════════════════════════════════════════════════
//  LEAVES
// ═══════════════════════════════════════════════════════════
function renderLeaves(){
  const u = currentUser(); if(!u) return;
  const leaves = load(LS.leaves)||[];

  // My leaves
  const myEl = qs('my-leaves-list'); if(!myEl) return; myEl.innerHTML = '';
  const myLeaves = leaves.filter(l => l.userId === u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(myLeaves.length === 0) myEl.innerHTML = '<p class="muted" style="padding:8px 0">No leave applications yet.</p>';
  myLeaves.forEach(l => myEl.appendChild(buildLeaveCard(l, u, false)));

  // Admin section
  const adminSec = qs('admin-leaves-section');
  if(adminSec && u.role === 'admin'){
    adminSec.classList.remove('hidden');
    const allEl = qs('all-leaves-list'); if(!allEl) return;
    allEl.innerHTML = '';
    const allLeaves = [...leaves].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(allLeaves.length === 0) allEl.innerHTML = '<p class="muted" style="padding:8px 0">No applications.</p>';
    allLeaves.forEach(l => allEl.appendChild(buildLeaveCard(l, u, true)));
  }
}

function buildLeaveCard(l, currentU, showUser){
  const card = document.createElement('div'); card.className = 'leave-card';
  const statusClass = { pending:'leave-status-pending', approved:'leave-status-approved', rejected:'leave-status-rejected' }[l.status] || 'leave-status-pending';
  const header = document.createElement('div'); header.className = 'leave-card-header';
  header.innerHTML = `<span class="leave-card-dates">${l.startDate} &rarr; ${l.endDate}</span><span class="leave-status ${statusClass}">${(l.status||'pending').toUpperCase()}</span>`;
  card.appendChild(header);
  if(l.reason){ const r = document.createElement('div'); r.className='leave-reason'; r.textContent=l.reason; card.appendChild(r); }
  if(showUser && l.status==='pending' && currentU.role==='admin'){
    const row = document.createElement('div'); row.className='leave-admin-row';
    const who = document.createElement('span'); who.className='leave-user'; who.textContent='By: '+getUserName(l.userId);
    const appBtn = document.createElement('button'); appBtn.className='btn-approve'; appBtn.textContent='Approve';
    appBtn.onclick = () => updateLeaveStatus(l.id, 'approved');
    const rejBtn = document.createElement('button'); rejBtn.className='btn-reject'; rejBtn.textContent='Reject';
    rejBtn.onclick = () => updateLeaveStatus(l.id, 'rejected');
    row.appendChild(who); row.appendChild(appBtn); row.appendChild(rejBtn); card.appendChild(row);
  } else if(showUser){
    const who = document.createElement('div'); who.className='leave-reason'; who.style.marginTop='6px';
    who.textContent = 'By: ' + getUserName(l.userId);
    card.appendChild(who);
  }
  return card;
}

async function updateLeaveStatus(leaveId, status){
  const u = currentUser(); if(!u || u.role!=='admin') return;
  const leaves = load(LS.leaves)||[];
  const l = leaves.find(x=>x.id===leaveId); if(!l) return;
  l.status = status; l.approvedBy = u.id;
  save(LS.leaves, leaves);
  addNotification(`Your leave application (${l.startDate} – ${l.endDate}) has been ${status}.`, 'leave', leaveId);
  if(await serverOk()){
    try{
      await apiCall('PUT', `/api/leaves/${leaveId}`, {status, approvedBy:u.id});
      await syncFromServer();
    }catch(e){ showToast('Error: '+e.message) }
  }
  renderLeaves(); showToast('Leave ' + status);
}

// ═══════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════
function renderTasks(filter='all'){
  const tasks = load(LS.tasks)||[];
  const user  = currentUser();
  const list  = qs('tasks-list'); if(!list) return; list.innerHTML = '';
  const today = todayStr();

  // Sync date filter state with the input
  const dfEl = qs('task-date-filter');
  if(dfEl && dfEl.value !== _taskDate) _taskDate = dfEl.value;

  // Week navigation label + button state
  const weekRange = getWeekRange(_tasksWeekOffset);
  const wnavLabel = qs('task-week-label');
  if(wnavLabel){
    const fmt = s => { const d=new Date(s+'T12:00'); return d.toLocaleDateString([],{month:'short',day:'numeric'}); };
    wnavLabel.textContent = fmt(weekRange.start) + ' – ' + fmt(weekRange.end);
  }
  const nextWBtn = qs('task-week-next');
  if(nextWBtn){ nextWBtn.disabled = _tasksWeekOffset===0; nextWBtn.style.opacity = _tasksWeekOffset===0?'0.35':''; }

  const visible = tasks.filter(t => {
    if(user.role !== 'admin' && t.assignedTo !== user.id) return false;
    // Specific date filter overrides week view
    if(_taskDate){
      const doneOnDate = t.completed && t.actualStart && t.actualStart.slice(0,10) === _taskDate;
      const dueOnDate  = !t.completed && t.due === _taskDate;
      return doneOnDate || dueOnDate;
    }
    // Week filter: show tasks that fall within the selected week
    const taskDateStr = t.completed
      ? (t.actualStart ? t.actualStart.slice(0,10) : (t.completedAt ? t.completedAt.slice(0,10) : null))
      : t.due;
    if(!taskDateStr || taskDateStr < weekRange.start || taskDateStr > weekRange.end) return false;
    if(filter === 'pending')   return !t.completed;
    if(filter === 'completed') return  t.completed;
    if(filter === 'today')     return !t.completed && t.due === today;
    return true;
  }).sort((a,b) => {
    if( a.completed && !b.completed) return  1;
    if(!a.completed &&  b.completed) return -1;
    if(a.due && b.due) return a.due.localeCompare(b.due);
    if(a.due) return -1;
    return 1;
  });

  visible.forEach(t => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;min-width:0';

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    const titleEl = document.createElement('span');
    titleEl.textContent = t.title;
    titleEl.style.cssText = 'font-weight:500;font-size:14px' + (t.completed ? ';text-decoration:line-through;opacity:0.6' : '');
    titleRow.appendChild(titleEl);

    if(t.completed){
      const badge = document.createElement('span');
      badge.textContent = '✓ Done';
      badge.style.cssText = 'font-size:11px;background:rgba(106,175,106,0.25);color:#6aaf6a;padding:2px 8px;border-radius:20px;white-space:nowrap';
      titleRow.appendChild(badge);
    } else if(t.due && t.due < today){
      const badge = document.createElement('span');
      badge.textContent = 'Overdue';
      badge.style.cssText = 'font-size:11px;background:rgba(231,76,60,0.2);color:#e74c3c;padding:2px 8px;border-radius:20px;white-space:nowrap';
      titleRow.appendChild(badge);
    }
    left.appendChild(titleRow);

    const meta = document.createElement('div');
    meta.className = 'task-meta'; meta.style.fontSize = '12px';
    const parts = [];
    if(!t.completed && t.due) parts.push('Due: ' + t.due);
    if(t.completed && t.actualStart) parts.push(fmtRange(t.actualStart, t.actualEnd));
    if(t.completed && t.completedRemarks) parts.push(t.completedRemarks);
    if(t.assignedTo && t.assignedTo !== user.id) parts.push('→ ' + getUserName(t.assignedTo));
    if(parts.length) { meta.textContent = parts.join(' • '); left.appendChild(meta) }
    li.appendChild(left);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit'; editBtn.onclick = () => openEditModal(t.id); right.appendChild(editBtn);

    if(!t.completed){
      const completeBtn = document.createElement('button');
      completeBtn.textContent = 'Complete'; completeBtn.onclick = () => openCompleteModal(t.id);
      right.appendChild(completeBtn);
    }

    li.appendChild(right);
    list.appendChild(li);
  });

  renderTimeline();
  updateCounts();
}

// ─── Timeline (inside tasks tab) ─────────────────────────
function renderTimeline(){
  const display = qs('timeline-display'); if(!display) return;
  const user = currentUser(); if(!user) return;
  const dateEl = qs('timeline-date');
  const selectedDate = dateEl ? dateEl.value : todayStr();
  const tasks = load(LS.tasks)||[];
  let taskItems = tasks.filter(t => t.completed && t.actualStart && t.actualStart.slice(0,10) === selectedDate);
  if(user.role !== 'admin') taskItems = taskItems.filter(t => t.assignedTo === user.id);

  // Calendar events for selected date (exclude task-refs — the task itself already shows)
  const allEvs = loadCalEvents().filter(ev => {
    if(ev.date !== selectedDate) return false;
    if(ev.isTaskRef) return false;
    if(ev.createdBy === user.id) return true;
    if((ev.sharedWith||[]).includes(user.id)) return true;
    if(user.role === 'admin') return true;
    return false;
  });

  // Merge tasks + events, sorted by time
  const merged = [
    ...taskItems.map(t => ({ kind:'task', sortKey: t.actualStart||'', t })),
    ...allEvs.map(ev => ({ kind:'event', sortKey: ev.startTime ? selectedDate+'T'+ev.startTime : selectedDate+'T00:00', ev })),
  ].sort((a,b) => a.sortKey.localeCompare(b.sortKey));

  // Update hours chip (tasks + events)
  const hoursEl = qs('timeline-hours-total');
  if(hoursEl){
    let totalMin = 0;
    taskItems.forEach(t => {
      if(t.actualStart && t.actualEnd) totalMin += (new Date(t.actualEnd) - new Date(t.actualStart)) / 60000;
    });
    allEvs.forEach(ev => {
      if(ev.startTime && ev.endTime){
        const [sh,sm] = toHHMM(ev.startTime).split(':').map(Number);
        const [eh,em] = toHHMM(ev.endTime).split(':').map(Number);
        const min = (eh*60+em)-(sh*60+sm); if(min>0) totalMin+=min;
      }
    });
    hoursEl.textContent = totalMin > 0 ? (totalMin/60).toFixed(1) + ' hrs' : '';
  }

  display.innerHTML = '';
  if(merged.length === 0){
    const empty = document.createElement('p');
    empty.className = 'muted'; empty.style.padding = '12px 0';
    empty.textContent = 'No tasks or events on this date.';
    display.appendChild(empty); return;
  }

  const fmtT = s => s ? new Date(s).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}) : '—';

  merged.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
    if(item.kind === 'task'){
      const t = item.t;
      const timeEl = document.createElement('div');
      timeEl.style.cssText = 'font-size:12px;color:var(--muted);white-space:nowrap;min-width:110px';
      timeEl.textContent = fmtT(t.actualStart) + ' – ' + fmtT(t.actualEnd);
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-size:13px;font-weight:500';
      titleEl.textContent = t.title;
      const remarkEl = document.createElement('div');
      remarkEl.style.cssText = 'font-size:11px;color:var(--muted);text-align:right;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      remarkEl.textContent = t.completedRemarks || '';
      row.appendChild(timeEl); row.appendChild(titleEl); row.appendChild(remarkEl);
    } else {
      const ev = item.ev;
      const timeEl = document.createElement('div');
      timeEl.style.cssText = 'font-size:12px;color:var(--muted);white-space:nowrap;min-width:110px';
      timeEl.textContent = !ev.startTime ? 'All day' : toHHMM(ev.startTime) + (ev.endTime ? ' – '+toHHMM(ev.endTime) : '');
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px';
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(ev.color||'#d4af37')+';flex-shrink:0';
      const txt = document.createElement('span'); txt.textContent = ev.title;
      titleEl.appendChild(dot); titleEl.appendChild(txt);
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:10px;background:rgba(212,175,55,0.2);color:var(--gold-dark);padding:2px 8px;border-radius:10px;white-space:nowrap';
      badge.textContent = 'Event';
      row.appendChild(timeEl); row.appendChild(titleEl); row.appendChild(badge);
    }
    display.appendChild(row);
  });
}

// ─── Clients ─────────────────────────────────────────────
function renderClients(filterText=''){
  const el = qs('clients-list'); if(!el) return;
  const q = (filterText||'').toLowerCase();
  el.innerHTML = '';
  (load(LS.clients)||[]).filter(c =>
    c.name.toLowerCase().includes(q) || (c.subscription||'').toLowerCase().includes(q)
  ).forEach(c => {
    const card = document.createElement('div'); card.className = 'card'; card.style.margin = '8px 0';
    card.innerHTML = `<strong>${escapeHtml(c.name)}</strong><div class="task-meta">Subscription: ${escapeHtml(c.subscription||'—')}</div>`;
    el.appendChild(card);
  });
  updateCounts();
}

function renderDashboardStats(){
  const el = qs('dashboard-stats'); if(!el) return;
  const user = currentUser(); if(!user) return;
  const tasks = load(LS.tasks)||[];
  const today = todayStr();
  const myTasks = user.role==='admin' ? tasks : tasks.filter(t=>t.assignedTo===user.id);
  const total = myTasks.length;
  const completedAll = myTasks.filter(t=>t.completed).length;
  const pending = myTasks.filter(t=>!t.completed).length;
  const overdue = myTasks.filter(t=>!t.completed&&t.due&&t.due<today).length;
  // ── Find Sunday of the chart week (Sun-Sat, driven by _statsWeekOffset) ──
  const refDate = new Date();
  refDate.setDate(refDate.getDate() - _statsWeekOffset * 7);
  const weekSun = new Date(refDate);
  weekSun.setDate(refDate.getDate() - refDate.getDay());
  weekSun.setHours(0,0,0,0);
  const weekSat = new Date(weekSun); weekSat.setDate(weekSun.getDate() + 6);
  const wrStart = _calDateStr(weekSun);
  const wrEnd   = _calDateStr(weekSat);

  // ── 9h/day completion rate — only elapsed working days so future days don't dilute % ──
  let workingDays = 0;
  { const d = new Date(weekSun); while(_calDateStr(d) <= wrEnd){ const ds2=_calDateStr(d); const dw=d.getDay(); if(dw>0&&dw<6 && ds2<=today) workingDays++; d.setDate(d.getDate()+1); } }
  const targetHours = workingDays * 9;
  let hoursWorked = 0;
  myTasks.forEach(t => {
    if(t.completed && t.actualStart && t.actualEnd){
      const ds = t.actualStart.slice(0,10);
      if(ds >= wrStart && ds <= wrEnd)
        hoursWorked += (new Date(t.actualEnd) - new Date(t.actualStart)) / 3600000;
    }
  });
  const allEvs = loadCalEvents();
  allEvs.filter(ev=>ev.date>=wrStart&&ev.date<=wrEnd&&!ev.isTaskRef).forEach(ev=>{
    if(ev.startTime&&ev.endTime){
      const st=toHHMM(ev.startTime).split(':'); const et=toHHMM(ev.endTime).split(':');
      const min=(parseInt(et[0])*60+parseInt(et[1]))-(parseInt(st[0])*60+parseInt(st[1]));
      if(min>0) hoursWorked+=min/60;
    }
  });
  const pct = targetHours>0 ? Math.min(100,Math.round(hoursWorked/targetHours*100)) : 0;
  const pctLabel = targetHours>0 ? `${hoursWorked.toFixed(1)}h / ${targetHours}h target` : 'No target';

  // ── Build Sun-Sat chart bars (task hours + event hours per day) ──
  const days7_new = [];
  for(let i=0; i<7; i++){
    const d = new Date(weekSun); d.setDate(weekSun.getDate() + i);
    const ds = _calDateStr(d);
    let dayHrs = 0;
    myTasks.filter(t=>t.completed&&(
      (t.actualStart&&t.actualStart.slice(0,10)===ds)||
      (!t.actualStart&&t.completedAt&&t.completedAt.slice(0,10)===ds)
    )).forEach(t=>{
      if(t.actualStart&&t.actualEnd)
        dayHrs += (new Date(t.actualEnd)-new Date(t.actualStart))/3600000;
      else dayHrs += 1;
    });
    allEvs.filter(ev=>ev.date===ds&&!ev.isTaskRef).forEach(ev=>{
      if(ev.startTime&&ev.endTime){
        const [sh,sm]=toHHMM(ev.startTime).split(':').map(Number);
        const [eh,em]=toHHMM(ev.endTime).split(':').map(Number);
        const min=(eh*60+em)-(sh*60+sm); if(min>0) dayHrs+=min/60;
      }
    });
    days7_new.push({ds, label:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i], dateLabel:`${d.getMonth()+1}/${d.getDate()}`, hours:dayHrs});
  }
  const maxH = Math.max(...days7_new.map(d=>d.hours), 1);
  const weekRangeLabel = `${weekSun.getMonth()+1}/${weekSun.getDate()} – ${weekSat.getMonth()+1}/${weekSat.getDate()}`;
  const nextBtnHtml = _statsWeekOffset>0
    ? `<button onclick="_statsWeekOffset--;renderDashboardStats()" class="btn-nav-arrow btn-nav-sm" title="Newer week">&#8594;</button>`
    : `<button class="btn-nav-arrow btn-nav-sm" disabled style="opacity:0.35;cursor:default" title="Current week">&#8594;</button>`;
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Tasks</div></div>
      <div class="stat-card stat-done"><div class="stat-value">${completedAll}</div><div class="stat-label">Completed</div></div>
      <div class="stat-card stat-pending"><div class="stat-value">${pending}</div><div class="stat-label">Pending</div></div>
      <div class="stat-card stat-overdue"><div class="stat-value">${overdue}</div><div class="stat-label">Overdue</div></div>
    </div>
    <div class="stats-progress">
      <div class="progress-label"><span>Week Target (9h/day)</span><span>${pctLabel} &nbsp;&middot;&nbsp; ${pct}%</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="stats-chart">
      <div class="chart-label-row">
        <span class="chart-label">Weekly Activity &nbsp;<span style="font-weight:400;font-size:9px;color:var(--muted)">${weekRangeLabel}</span></span>
        <span class="chart-week-nav">
          <button onclick="_statsWeekOffset++;renderDashboardStats()" class="btn-nav-arrow btn-nav-sm" title="Older week">&#8592;</button>
          ${nextBtnHtml}
        </span>
      </div>
      <div class="chart-bars">
        ${days7_new.map(d=>`<div class="chart-day"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(4,Math.round(d.hours/maxH*60))}px" title="${d.hours.toFixed(1)}h worked"></div></div><div class="chart-day-count">${d.hours>0?d.hours.toFixed(1):''}</div><div class="chart-day-label">${d.label}</div><div class="chart-day-date">${d.dateLabel}</div></div>`).join('')}
      </div>
    </div>`;
}


// ═══════════════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════════════
function renderAdminAll(){ renderAdminUsers(); renderAdminClients(); renderAdminTasks() }

function renderAdminUsers(){
  const users = load(LS.users)||[];
  const el = qs('user-list'); if(!el) return; el.innerHTML = '';
  const cu = currentUser();

  users.forEach(u => {
    const d = document.createElement('div'); d.className = 'card'; d.style.margin = '6px 0';
    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(u.name)}</strong><div class="task-meta">${escapeHtml(u.username)} — ${u.role}</div>`;
    d.appendChild(info);

    if(cu?.role === 'admin'){
      const btnRow = document.createElement('div'); btnRow.style.marginTop = '6px';
      const editBtn = document.createElement('button'); editBtn.textContent = 'Edit';
      editBtn.onclick = () => { window._profileTargetId = u.id; switchNav('profile') };
      const delBtn = document.createElement('button'); delBtn.textContent = 'Delete'; delBtn.style.marginLeft = '8px';
      delBtn.onclick = async () => {
        if(!confirm('Delete user "' + u.name + '"?')) return;
        if(await serverOk()){
          try{ await apiCall('DELETE', `/api/users/${u.id}`); await syncFromServer(); renderAdminAll(); showToast('User deleted'); if(currentUser()?.id===u.id) logout(); return }
          catch(e){ showToast('Error: '+e.message) }
        }
        save(LS.users, (load(LS.users)||[]).filter(x=>x.id!==u.id));
        renderAdminAll(); showToast('User deleted'); if(currentUser()?.id===u.id) logout();
      };
      btnRow.appendChild(editBtn); btnRow.appendChild(delBtn); d.appendChild(btnRow);
    }
    el.appendChild(d);
  });

  // Populate user selects
  [qs('assign-to-user'), qs('admin-task-user')].forEach(sel => {
    if(!sel) return; sel.innerHTML = '';
    users.forEach(u => { const o = document.createElement('option'); o.value=u.id; o.textContent=u.name; sel.appendChild(o) });
  });
}

function renderAdminClients(){
  const el = qs('client-list'); if(!el) return; el.innerHTML = '';
  (load(LS.clients)||[]).forEach(c => {
    const d = document.createElement('div'); d.className = 'card'; d.style.margin = '6px 0';
    d.innerHTML = `<strong>${escapeHtml(c.name)}</strong><div class="task-meta">${escapeHtml(c.subscription||'')}</div>`;
    el.appendChild(d);
  });
}

function renderAdminTasks(){
  const tasks = load(LS.tasks)||[];
  const el = qs('admin-tasks-list'); if(!el) return; el.innerHTML = '';
  tasks.sort((a,b) => {
    if( a.completed && !b.completed) return  1;
    if(!a.completed &&  b.completed) return -1;
    if(a.due && b.due) return a.due.localeCompare(b.due);
    if(a.due) return -1; return 1;
  }).forEach(t => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
    const left = document.createElement('div'); left.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1';
    const ts = document.createElement('span'); ts.textContent = t.title; ts.style.fontWeight = '500';
    const meta = document.createElement('span'); meta.className = 'task-meta';
    const mparts = [];
    if(t.due) mparts.push('Due: '+t.due);
    if(t.assignedTo) mparts.push(getUserName(t.assignedTo));
    if(t.completed){ mparts.push('✓ Completed'); if(t.completedRemarks) mparts.push(t.completedRemarks) }
    meta.textContent = mparts.join(' • ');
    left.appendChild(ts); left.appendChild(meta);
    const right = document.createElement('div'); right.style.cssText = 'display:flex;gap:6px';
    const editBtn = document.createElement('button'); editBtn.textContent = 'Edit'; editBtn.onclick = () => openEditModal(t.id);
    const delBtn  = document.createElement('button'); delBtn.textContent  = 'Delete'; delBtn.onclick = () => deleteTask(t.id);
    right.appendChild(editBtn); right.appendChild(delBtn);
    li.appendChild(left); li.appendChild(right); el.appendChild(li);
  });
}

// ═══════════════════════════════════════════════════════════
//  TASK OPERATIONS
// ═══════════════════════════════════════════════════════════
async function deleteTask(id){
  if(!id || id === 'null') return;
  if(!confirm('Delete this task?')) return;
  const linked = loadCalEvents().filter(e => e.taskId === id).map(e => e.id).filter(eid => eid && eid !== 'null');
  linked.forEach(eid => deleteCalEvent(eid));
  if(await serverOk()){
    try{
      await apiCall('DELETE', `/api/tasks/${id}`);
      linked.forEach(eid => apiCall('DELETE', `/api/events/${eid}`).catch(()=>{}));
      await syncFromServer(); renderAll(); showToast('Task deleted'); return;
    }catch(e){ showToast('Error: '+e.message) }
  }
  save(LS.tasks, (load(LS.tasks)||[]).filter(t=>t.id!==id));
  renderAll(); showToast('Task deleted');
}

// ─── Auto-fill start from last task ──────────────────────
function autoFillTaskStart(){
  const dateEl = qs('new-task-date');
  const timeEl = qs('new-task-start-time');
  if(!dateEl || !timeEl) return;
  const today = todayStr();
  const latestEnd = (load(LS.tasks)||[])
    .filter(t => t.completed && t.actualEnd && t.actualEnd.slice(0,10) === today)
    .map(t => t.actualEnd).sort().pop();
  if(latestEnd && (!dateEl.value || dateEl.value === today)){
    dateEl.value = latestEnd.slice(0,10);
    timeEl.value = latestEnd.slice(11,16);
  }
}

// ─── Status toggle helper ────────────────────────────────
const _setStatus = s => {
  _newTaskStatus = s;
  qs('status-complete-btn')?.classList.toggle('active', s === 'complete');
  const dueWrap = qs('status-due-wrap'); if(dueWrap) dueWrap.style.display = s==='complete' ? 'none' : '';
  const cfr = qs('complete-fields-row'); if(cfr) cfr.style.display = s==='complete' ? '' : 'none';
  if(s === 'complete') autoFillTaskStart();
  // Notify-all row only relevant for incomplete tasks with a due date
  const notifRow = qs('task-notify-all-row');
  if(notifRow){
    const dueVal = qs('new-task-due')?.value || '';
    notifRow.style.display = (s === 'incomplete' && dueVal) ? '' : 'none';
  }
};

// ═══════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════
function openProfileFor(userId){ window._profileTargetId = userId; switchNav('profile') }

function renderProfile(selectedUserId){
  const user = selectedUserId ? (load(LS.users)||[]).find(u=>u.id===selectedUserId) : currentUser();
  const container = qs('profile-details'); if(!container) return; container.innerHTML = '';
  if(!user) return container.textContent = 'No user';
  const cu = currentUser();

  const form = document.createElement('div'); form.className = 'card';
  form.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  const mkRow = (lbl, inp) => {
    const row = document.createElement('div'); row.className = 'form-row';
    const l = document.createElement('label'); l.textContent = lbl;
    row.appendChild(l); row.appendChild(inp); return row;
  };

  const nameInp = document.createElement('input'); nameInp.value = user.name||'';
  const userInp = document.createElement('input'); userInp.value = user.username||'';
  const passInp = document.createElement('input'); passInp.type = 'password'; passInp.value = user.password||'';
  form.appendChild(mkRow('Full name', nameInp));
  form.appendChild(mkRow('Username', userInp));
  form.appendChild(mkRow('Password', passInp));

  const photoRow = document.createElement('div'); photoRow.className = 'form-row';
  const photoLabel = document.createElement('label'); photoLabel.textContent = 'Photo';
  const photoFile = document.createElement('input'); photoFile.type = 'file'; photoFile.accept = 'image/*';
  const photoPreview = document.createElement('img');
  photoPreview.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px;margin-left:8px';
  photoPreview.src = user.photo || 'https://via.placeholder.com/64';
  const removePhotoBtn = document.createElement('button'); removePhotoBtn.textContent = 'Remove'; removePhotoBtn.style.marginLeft = '8px';
  form._removePhoto = false;
  removePhotoBtn.onclick = () => {
    form._removePhoto = true; photoPreview.src = 'https://via.placeholder.com/64'; photoFile.value = '';
    const lu = load(LS.users)||[]; const li = lu.findIndex(u=>u.id===user.id);
    if(li > -1){ lu[li].photo = ''; save(LS.users, lu); renderSidebar() }
  };
  photoFile.onchange = () => {
    const f = photoFile.files?.[0]; if(!f) return; form._removePhoto = false;
    const fr = new FileReader(); fr.onload = () => photoPreview.src = fr.result; fr.readAsDataURL(f);
  };
  photoRow.appendChild(photoLabel); photoRow.appendChild(photoFile);
  photoRow.appendChild(photoPreview); photoRow.appendChild(removePhotoBtn);
  form.appendChild(photoRow);

  if(cu?.role === 'admin'){
    const roleInp = document.createElement('select');
    ['employee','admin'].forEach(r => {
      const o = document.createElement('option'); o.value=r; o.textContent=r[0].toUpperCase()+r.slice(1); roleInp.appendChild(o);
    });
    roleInp.value = user.role||'employee';
    form.appendChild(mkRow('Role', roleInp));
  }

  const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;justify-content:flex-end';
  const saveBtn = document.createElement('button'); saveBtn.textContent = 'Save Changes'; saveBtn.className = 'btn-primary';
  btnRow.appendChild(saveBtn); form.appendChild(btnRow);
  container.appendChild(form);

  saveBtn.onclick = async () => {
    const users = load(LS.users)||[]; const idx = users.findIndex(u=>u.id===user.id);
    if(idx === -1) return showToast('User not found');
    const payload = {};
    const nn = nameInp.value.trim(); if(nn) payload.name = nn;
    const nu = userInp.value.trim();
    if(nu && nu !== users[idx].username){ if(users.find(u=>u.username===nu)) return alert('Username already taken'); payload.username = nu }
    if(passInp.value.trim()) payload.password = passInp.value.trim();
    if(cu?.role === 'admin'){ const rsel = form.querySelector('select'); if(rsel) payload.role = rsel.value }
    if(form._removePhoto) payload.photo = null;
    else if(photoFile.files?.[0]){
      payload.photo = await new Promise((res,rej) => {
        const fr = new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=()=>rej(fr.error); fr.readAsDataURL(photoFile.files[0]);
      });
    }
    if(await serverOk()){
      try{
        await apiCall('PUT', `/api/users/${user.id}`, payload);
        await syncFromServer();
        if(form._removePhoto){ const lu=load(LS.users)||[]; const li=lu.findIndex(u=>u.id===user.id); if(li>-1){lu[li].photo=''; save(LS.users,lu)} }
        renderAdminUsers(); renderSidebar(); showToast('Profile saved');
        if(currentUser()?.id === user.id) save(LS.session, {userId:user.id});
        return;
      }catch(e){ showToast('Error: '+e.message) }
    }
    if(payload.name)     users[idx].name     = payload.name;
    if(payload.username) users[idx].username = payload.username;
    if(payload.password) users[idx].password = payload.password;
    if(Object.prototype.hasOwnProperty.call(payload,'photo')) users[idx].photo = payload.photo||'';
    if(payload.role)     users[idx].role     = payload.role;
    save(LS.users, users); renderAdminUsers(); renderSidebar(); showToast('Profile saved');
    if(currentUser()?.id === users[idx].id) save(LS.session, {userId:users[idx].id});
  };
}

// ═══════════════════════════════════════════════════════════
//  COMPLETE TASK MODAL
// ═══════════════════════════════════════════════════════════
let _completeModalTaskId = null;

function openCompleteModal(taskId){
  _completeModalTaskId = taskId;
  const tasks = load(LS.tasks)||[]; const t = tasks.find(x=>x.id===taskId); if(!t) return;
  const nameEl = qs('complete-task-name'); if(nameEl) nameEl.textContent = t.title;
  const rem = qs('complete-remarks'); if(rem) rem.value = '';
  qs('complete-modal')?.classList.remove('hidden');
}

function closeCompleteModal(){
  _completeModalTaskId = null;
  qs('complete-modal')?.classList.add('hidden');
  const rem = qs('complete-remarks'); if(rem) rem.value = '';
}

// ═══════════════════════════════════════════════════════════
//  EDIT TASK MODAL
// ═══════════════════════════════════════════════════════════
let _editTaskId = null;

function openEditModal(taskId){
  _editTaskId = taskId;
  const tasks = load(LS.tasks)||[]; const t = tasks.find(x=>x.id===taskId); if(!t) return;
  const modal = qs('edit-modal'); if(!modal) return;

  const ti = qs('edit-task-title');      if(ti) ti.value = t.title||'';
  const sd = qs('edit-actual-start-date'); if(sd) sd.value = t.actualStart ? t.actualStart.slice(0,10) : '';
  const st = qs('edit-actual-start-time'); if(st) st.value = t.actualStart ? t.actualStart.slice(11,16) : '';
  const ed = qs('edit-actual-end-date');   if(ed) ed.value = t.actualEnd   ? t.actualEnd.slice(0,10)   : '';
  const et = qs('edit-actual-end-time');   if(et) et.value = t.actualEnd   ? t.actualEnd.slice(11,16)  : '';
  const rm = qs('edit-remarks');           if(rm) rm.value = t.completedRemarks||'';

  modal.classList.remove('hidden');
}

function closeEditModal(){
  _editTaskId = null;
  qs('edit-modal')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════════════════════
function renderAll(){
  renderSidebar();
  renderClients();
  renderTasks();
  renderAdminUsers();
  renderAdminClients();
  renderAdminTasks();
  renderDashboardStats();
  updateNotifBadge();
}

function startApp(){
  showApp(); renderSidebar(); switchNav('dashboard'); activateTab('tasks'); renderAll();
  const user = currentUser(); if(!user){ showLogin(); return }
  if(user.role !== 'admin') qs('admin-view')?.classList.add('hidden');
  else qs('admin-view')?.classList.remove('hidden');
  // Init timeline date
  const tld = qs('timeline-date'); if(tld && !tld.value) tld.value = todayStr();
  updateNotifBadge();
}

// ═══════════════════════════════════════════════════════════
//  CALENDAR EVENTS (localStorage + server sync)
// ═══════════════════════════════════════════════════════════
function loadCalEvents(){ return load(LS.events)||[] }

function saveCalEvent(ev){
  const evs = loadCalEvents();
  if(!ev.id) ev.id = uid('ev_');
  const idx = evs.findIndex(e=>e.id===ev.id);
  if(idx >= 0) evs[idx] = ev; else evs.push(ev);
  save(LS.events, evs); return ev;
}

function deleteCalEvent(id){ save(LS.events, loadCalEvents().filter(e=>e.id!==id)) }

function getVisibleEvents(){
  const user = currentUser(); if(!user) return [];
  const target = _calOwner || user.id;
  return loadCalEvents().filter(ev => {
    if(ev.createdBy === target) return true;
    if((ev.sharedWith||[]).includes(target)) return true;
    if(user.role === 'admin' && !_calOwner) return true;
    return false;
  });
}

// ─── Calendar rendering ──────────────────────────────────
function renderCalendar(){
  const label = qs('cal-month-label');
  if(label){
    const d = new Date(_calYear, _calMonth, 1);
    label.textContent = d.toLocaleDateString([], {month:'long', year:'numeric'});
  }
  const ownerSel = qs('cal-owner-select');
  const user = currentUser();
  if(ownerSel && user?.role === 'admin'){
    const users = load(LS.users)||[];
    const prev = ownerSel.value;
    ownerSel.innerHTML = '<option value="">My Calendar</option>';
    users.forEach(u => {
      if(u.id !== user.id){ const o=document.createElement('option'); o.value=u.id; o.textContent=u.name; ownerSel.appendChild(o) }
    });
    ownerSel.value = prev;
    ownerSel.classList.remove('hidden');
  }
  document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.calview === _calView));
  const grid = qs('cal-grid'), wv = qs('cal-week-view');
  if(_calView === 'month'){
    grid?.classList.remove('hidden'); wv?.classList.add('hidden'); renderCalMonth();
  } else {
    grid?.classList.add('hidden'); wv?.classList.remove('hidden'); renderCalWeek();
  }
}

function _calDateStr(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderCalMonth(){
  const grid = qs('cal-grid'); if(!grid) return; grid.innerHTML = '';
  const today  = todayStr();
  const events = getVisibleEvents();
  const tasks  = load(LS.tasks)||[];

  const firstDay  = new Date(_calYear, _calMonth, 1);
  const startGrid = new Date(firstDay); startGrid.setDate(startGrid.getDate() - startGrid.getDay());
  const endDay    = new Date(_calYear, _calMonth+1, 0);
  const endGrid   = new Date(endDay);   endGrid.setDate(endGrid.getDate() + (6 - endGrid.getDay()));

  for(let d = new Date(startGrid); d <= endGrid; d.setDate(d.getDate()+1)){
    const dateStr    = _calDateStr(d);
    const isToday    = dateStr === today;
    const otherMonth = d.getMonth() !== _calMonth;

    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (otherMonth?' other-month':'') + (isToday?' today':'');
    cell.dataset.date = dateStr;

    const dayNum = document.createElement('div'); dayNum.className = 'cal-day-num';
    if(isToday){
      const dot = document.createElement('div'); dot.className = 'cal-today-dot'; dot.textContent = d.getDate(); dayNum.appendChild(dot);
    } else {
      const sp = document.createElement('span'); sp.textContent = d.getDate(); dayNum.appendChild(sp);
    }
    const addBtn = document.createElement('button'); addBtn.className = 'cal-add-btn'; addBtn.textContent = '+'; addBtn.title = 'Add event';
    addBtn.onclick = e => { e.stopPropagation(); if(_calAddMode==='task') openCalTaskModal(dateStr); else openEventModal(null, dateStr) };
    dayNum.appendChild(addBtn);
    cell.appendChild(dayNum);
    cell.addEventListener('click', e => { if(e.target===cell||e.target===dayNum||e.target.tagName==='SPAN'){ if(_calAddMode==='task') openCalTaskModal(dateStr); else openEventModal(null, dateStr) } });

    const cu0 = currentUser();
    const calTasks = cu0?.role==='admin' ? tasks : tasks.filter(t=>t.assignedTo===cu0?.id);
    const dayEvs  = events.filter(ev=>ev.date===dateStr).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
    const dueTasks  = calTasks.filter(t=>!t.completed && t.due===dateStr);
    const doneTasks = calTasks.filter(t=>t.completed && t.actualStart && t.actualStart.slice(0,10)===dateStr);
    const allItems  = [
      ...dayEvs.map(ev=>({type:'event',ev})),
      ...dueTasks.map(t=>({type:'task-due',t})),
      ...doneTasks.map(t=>({type:'task-done',t})),
    ];
    const MAX = 3;
    allItems.slice(0, MAX).forEach(item => {
      const chip = document.createElement('div'); chip.className = 'cal-event-chip';
      if(item.type === 'event'){
        chip.style.background = item.ev.color||'#d4af37';
        const cSfx0 = (item.ev.createdBy && cu0 && item.ev.createdBy !== cu0.id) ? ' · by '+getUserName(item.ev.createdBy) : '';
        chip.textContent = (item.ev.startTime ? toHHMM(item.ev.startTime)+' ' : '') + item.ev.title + cSfx0;
        chip.onclick = e => { e.stopPropagation(); openEventModal(item.ev.id) };
      } else if(item.type === 'task-due'){
        chip.classList.add('task-due');
        chip.textContent = '\uD83D\uDCCC Due: ' + item.t.title;
        chip.onclick = e => e.stopPropagation();
      } else {
        chip.classList.add('task-done');
        chip.textContent = '\u2713 ' + item.t.title;
        chip.onclick = e => e.stopPropagation();
      }
      cell.appendChild(chip);
    });
    if(allItems.length > MAX){
      const more = document.createElement('div'); more.className = 'cal-more-link';
      more.textContent = `+${allItems.length-MAX} more`;
      more.onclick = e => { e.stopPropagation(); _showCalDayPopover(dateStr, allItems, more); };
      cell.appendChild(more);
    }
    grid.appendChild(cell);
  }
}

function _showCalDayPopover(dateStr, allItems, anchorEl){
  document.querySelectorAll('.cal-day-popover').forEach(p=>p.remove());
  const pop = document.createElement('div'); pop.className = 'cal-day-popover';
  const hdr = document.createElement('div'); hdr.className = 'cal-day-popover-hdr';
  const d = new Date(dateStr+'T12:00');
  hdr.textContent = d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
  const closeBtn = document.createElement('button'); closeBtn.textContent = '×'; closeBtn.className = 'cal-day-popover-close';
  closeBtn.onclick = () => pop.remove(); hdr.appendChild(closeBtn); pop.appendChild(hdr);
  allItems.forEach(item => {
    const chip = document.createElement('div'); chip.className = 'cal-event-chip';
    chip.style.marginBottom = '4px';
    if(item.type === 'event'){
      chip.style.background = item.ev.color||'#d4af37';
      chip.textContent = (item.ev.startTime ? toHHMM(item.ev.startTime)+' ' : '') + item.ev.title;
      chip.onclick = () => { pop.remove(); openEventModal(item.ev.id); };
    } else if(item.type === 'task-due'){
      chip.classList.add('task-due'); chip.textContent = '\uD83D\uDCCC Due: '+item.t.title; chip.style.cursor='default';
    } else {
      chip.classList.add('task-done'); chip.textContent = '\u2713 '+item.t.title; chip.style.cursor='default';
    }
    pop.appendChild(chip);
  });
  const rect = anchorEl.getBoundingClientRect();
  pop.style.cssText = `position:fixed;top:${Math.min(rect.bottom+4, window.innerHeight-220)}px;left:${Math.min(rect.left, window.innerWidth-200)}px;z-index:9999;width:190px`;
  document.body.appendChild(pop);
  const dismiss = e => { if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener('click',dismiss,true); } };
  setTimeout(()=>document.addEventListener('click',dismiss,true),10);
}

function renderCalWeek(){
  const wv = qs('cal-week-view'); if(!wv) return; wv.innerHTML = '';
  const today  = todayStr();
  const events = getVisibleEvents();
  const refDate  = new Date(_calYear, _calMonth, 1);
  const startW   = new Date(refDate); startW.setDate(startW.getDate() - startW.getDay());
  const START_HOUR = 8;

  const headerDiv = document.createElement('div'); headerDiv.className = 'cal-week-days';
  const corner = document.createElement('div'); corner.className = 'cal-week-day-hdr'; headerDiv.appendChild(corner);
  const weekDays = [];
  for(let i = 0; i < 7; i++){
    const d = new Date(startW); d.setDate(d.getDate()+i); weekDays.push(d);
    const dStr = _calDateStr(d); const isT = dStr === today;
    const hdr = document.createElement('div'); hdr.className = 'cal-week-day-hdr' + (isT?' today':'');
    hdr.innerHTML = `<small>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</small><span>${d.getDate()}</span>`;
    headerDiv.appendChild(hdr);
  }
  wv.appendChild(headerDiv);

  const bodyDiv = document.createElement('div'); bodyDiv.className = 'cal-week-body';
  for(let h = START_HOUR; h < START_HOUR+12; h++){
    const tc = document.createElement('div'); tc.className = 'cal-week-time';
    tc.textContent = `${String(h).padStart(2,'0')}:00`; bodyDiv.appendChild(tc);
    weekDays.forEach(d => {
      const dStr = _calDateStr(d);
      const slot = document.createElement('div'); slot.className = 'cal-week-slot';
      slot.onclick = () => openEventModal(null, dStr, `${String(h).padStart(2,'0')}:00`);
      const slotEvs = events.filter(ev => {
        if(ev.date !== dStr) return false;
        if(!ev.startTime) return h === START_HOUR;
        return parseInt(ev.startTime.slice(0,2),10) === h;
      });
      slotEvs.forEach(ev => {
        const bar = document.createElement('div'); bar.className = 'cal-week-event';
        bar.style.background = ev.color||'#d4af37';
        const cu1 = currentUser();
        const cSfx1 = (ev.createdBy && cu1 && ev.createdBy !== cu1.id) ? ' · by '+getUserName(ev.createdBy) : '';
        bar.textContent = (ev.startTime?toHHMM(ev.startTime)+' ':'')+ev.title+cSfx1;
        bar.onclick = e => { e.stopPropagation(); openEventModal(ev.id) };
        slot.appendChild(bar);
      });
      bodyDiv.appendChild(slot);
    });
  }
  wv.appendChild(bodyDiv);
}

// ─── Event modal ─────────────────────────────────────────
let _editingEventId = null;

function openEventModal(eventId, defaultDate, defaultTime){
  _editingEventId = eventId || null;
  const user  = currentUser();
  const users = load(LS.users)||[];
  const shareList = qs('event-share-list');
  if(shareList){
    shareList.innerHTML = '';
    users.filter(u=>u.id!==user?.id).forEach(u => {
      const item = document.createElement('label'); item.className = 'event-share-item';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.value=u.id; cb.dataset.userId=u.id;
      item.appendChild(cb); item.appendChild(document.createTextNode(u.name)); shareList.appendChild(item);
    });
  }
  if(eventId){
    const ev = loadCalEvents().find(e=>e.id===eventId); if(!ev) return;
    qs('event-modal-heading').textContent = 'Edit Event';
    qs('event-title').value = ev.title||'';
    qs('event-date').value  = ev.date||'';
    qs('event-allday').checked = !ev.startTime;
    qs('event-start-time').value = toHHMM(ev.startTime);
    qs('event-end-time').value   = toHHMM(ev.endTime);
    qs('event-desc').value  = ev.description||'';
    qs('event-color').value = ev.color||'#d4af37';
    (ev.sharedWith||[]).forEach(uid => { const cb=shareList?.querySelector(`input[data-user-id="${uid}"]`); if(cb) cb.checked=true });
    qs('event-delete-btn')?.classList.remove('hidden');
    if(qs('event-time-row')) qs('event-time-row').style.display = ev.startTime ? '' : 'none';
  } else {
    qs('event-modal-heading').textContent = 'New Event';
    qs('event-title').value = '';
    qs('event-date').value  = defaultDate||todayStr();
    qs('event-allday').checked = false;
    qs('event-start-time').value = defaultTime||'';
    qs('event-end-time').value   = '';
    qs('event-desc').value  = '';
    qs('event-color').value = '#d4af37';
    qs('event-delete-btn')?.classList.add('hidden');
    if(qs('event-time-row')) qs('event-time-row').style.display = '';
  }
  qs('event-modal')?.classList.remove('hidden');
  setTimeout(() => qs('event-title')?.focus(), 80);
}

function closeEventModal(){
  qs('event-modal')?.classList.add('hidden');
  _editingEventId = null;
}

function saveEventFromModal(){
  const title = qs('event-title').value.trim(); if(!title) return alert('Please enter an event title.');
  const date  = qs('event-date').value;         if(!date)  return alert('Please select a date.');
  const allDay = qs('event-allday').checked;
  const startT = allDay ? null : (toHHMM(qs('event-start-time').value)||null);
  const endT   = allDay ? null : (toHHMM(qs('event-end-time').value)||null);
  const shared = Array.from(qs('event-share-list')?.querySelectorAll('input[type=checkbox]:checked')||[]).map(cb=>cb.value);
  const user = currentUser();
  const ev = {
    id:          _editingEventId || uid('ev_'),
    title, date,
    startTime:   startT,
    endTime:     endT,
    description: qs('event-desc').value.trim(),
    color:       qs('event-color').value,
    createdBy:   _calOwner || user?.id,
    sharedWith:  shared,
    isTaskRef:   false, taskId: null, taskDueType: null,
  };
  if(_editingEventId){
    const old = loadCalEvents().find(e=>e.id===_editingEventId);
    if(old){ ev.isTaskRef=old.isTaskRef; ev.taskId=old.taskId; ev.taskDueType=old.taskDueType }
  }
  serverOk().then(ok => {
    if(ok){
      const method = _editingEventId ? 'PUT' : 'POST';
      const url    = _editingEventId ? `/api/events/${_editingEventId}` : '/api/events';
      apiCall(method, url, ev).then(()=>syncFromServer()).catch(()=>{});
    }
  });
  saveCalEvent(ev); closeEventModal(); renderCalendar();
  showToast(_editingEventId ? 'Event updated' : 'Event created');
}

// ═══════════════════════════════════════════════════════════
//  CAL TASK MODAL
// ═══════════════════════════════════════════════════════════
let _calTaskDate = '';

function openCalTaskModal(date){
  _calTaskDate = date;
  const lbl = qs('cal-task-date-label'); if(lbl) lbl.textContent = date;
  const ti = qs('cal-task-title'); if(ti) ti.value='';
  const due = qs('cal-task-due'); if(due) due.value = date;
  const rem = qs('cal-task-remarks'); if(rem) rem.value='';
  // Reset complete fields
  _calTaskStatus = 'incomplete';
  const cdi = qs('cal-task-date-input'); if(cdi) cdi.value = date;
  const cst = qs('cal-task-start-time'); if(cst) cst.value='';
  const cet = qs('cal-task-end-time');   if(cet) cet.value='';
  const cf  = qs('cal-complete-fields'); if(cf)  cf.style.display='none';
  const dw  = qs('cal-status-due-wrap'); if(dw)  dw.style.display='';
  const cb  = qs('cal-task-complete-btn'); if(cb) cb.classList.remove('active');
  qs('cal-task-modal')?.classList.remove('hidden');
  setTimeout(()=>qs('cal-task-title')?.focus(),80);
}

function closeCalTaskModal(){
  qs('cal-task-modal')?.classList.add('hidden');
  _calTaskDate = '';
}

async function saveCalTask(){
  const title = qs('cal-task-title')?.value.trim();
  if(!title) return alert('Please enter a task title.');
  const isComplete = _calTaskStatus === 'complete';
  const due      = isComplete ? null : (qs('cal-task-due')?.value || _calTaskDate || null);
  const remarks  = qs('cal-task-remarks')?.value.trim() || null;
  const taskDate = isComplete ? (qs('cal-task-date-input')?.value || _calTaskDate) : '';
  const startTime= isComplete ? toHHMM(qs('cal-task-start-time')?.value||'') : '';
  const endTime  = isComplete ? toHHMM(qs('cal-task-end-time')?.value||'')   : '';
  const startVal = (taskDate && startTime) ? `${taskDate}T${startTime}` : null;
  const endVal   = (taskDate && endTime)   ? `${taskDate}T${endTime}`   : null;
  if(isComplete && (!taskDate || !startTime)) return alert('Please enter date and start time.');
  if(isComplete && !endTime) return alert('Please enter end time.');
  const user = currentUser();
  const payload = {
    title, due,
    assignedTo:       user?.role==='admin' ? null : (user?.id||null),
    completed:        isComplete,
    actualStart:      startVal,
    actualEnd:        endVal,
    completedAt:      isComplete ? new Date().toISOString() : null,
    completedBy:      isComplete ? (user?.id||null) : null,
    completedRemarks: remarks||null,
  };
  closeCalTaskModal();
  if(await serverOk()){
    try{
      await apiCall('POST','/api/tasks',payload);
      await syncFromServer(); renderAll(); renderCalendar(); showToast('Task added'); return;
    }catch(e){ showToast('Error: '+e.message) }
  }
  const tasks2 = load(LS.tasks)||[];
  tasks2.push({id:uid('t_'), ...payload}); save(LS.tasks,tasks2);
  renderAll(); renderCalendar(); showToast('Task added');
}

// ═══════════════════════════════════════════════════════════
//  EVENT WIRING
// ═══════════════════════════════════════════════════════════
function initEvents(){

  // ── Login ──────────────────────────────────────────────
  qs('login-btn').onclick = async () => {
    const u = qs('login-username').value.trim();
    const p = qs('login-password').value.trim();
    if(await serverOk()){
      try{
        const j = await apiCall('POST', '/api/login', {username:u, password:p});
        save(LS.session, {userId:j.user.id}); await syncFromServer();
        qs('login-msg').textContent = ''; startApp(); return;
      }catch(e){ qs('login-msg').textContent = 'Invalid credentials'; showToast('Login failed'); return }
    }
    const user = (load(LS.users)||[]).find(x=>x.username===u && x.password===p);
    if(user){ save(LS.session,{userId:user.id}); qs('login-msg').textContent=''; startApp() }
    else qs('login-msg').textContent = 'Invalid credentials';
  };
  const trig = e => { if(e.key==='Enter'){ e.preventDefault(); qs('login-btn')?.click() } };
  qs('login-username')?.addEventListener('keydown', trig);
  qs('login-password')?.addEventListener('keydown', trig);

  // ── Logout ─────────────────────────────────────────────
  qs('logout-btn').onclick = () => logout();

  // ── Nav ────────────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => switchNav(b.dataset.view));

  // ── Tabs ───────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(b => b.onclick = () => activateTab(b.dataset.tab));

  // ── Status toggle ──────────────────────────────────────
  qs('status-complete-btn')?.addEventListener('click', () => {
    _newTaskStatus === 'complete' ? _setStatus('incomplete') : _setStatus('complete');
  });

  // ── Add task ───────────────────────────────────────────
  qs('add-task-btn').onclick = async () => {
    const title      = qs('new-task-title').value.trim();
    const isComplete = _newTaskStatus === 'complete';
    const taskDate   = isComplete ? (qs('new-task-date')?.value||'')           : '';
    const startTime  = isComplete ? (qs('new-task-start-time')?.value||'')     : '';
    const endTime    = isComplete ? (qs('new-task-end-time')?.value||'')       : '';
    const startVal   = (taskDate && startTime) ? `${taskDate}T${startTime}`    : null;
    const endVal     = (taskDate && endTime)   ? `${taskDate}T${endTime}`      : null;
    const dueVal     = (!isComplete) ? (qs('new-task-due')?.value||null)       : null;
    const remarks    = isComplete ? (qs('new-task-remarks')?.value.trim()||null) : null;
    const addToCal   = qs('task-add-to-cal')?.checked || false;
    const notifyAll  = qs('task-notify-all')?.checked || false;

    if(!title) return alert('Please enter a task title.');
    if(isComplete){
      if(!taskDate||!startTime) return alert('Please enter the date and start time.');
      if(!endTime)              return alert('Please enter the end time.');
      if(!remarks)              return alert('Please enter remarks for this completed task.');
      if(new Date(endVal) < new Date(startVal)) return alert('End time cannot be before start time.');
    }
    if(!isComplete && addToCal && !dueVal) return alert('Please set a Due Date to add this task to the calendar.');

    const user = currentUser();
    const payload = {
      title,
      due:              dueVal,
      assignedTo:       user?.role==='admin' ? null : (user?.id||null),
      completed:        isComplete,
      actualStart:      startVal,
      actualEnd:        endVal,
      completedAt:      isComplete ? new Date().toISOString() : null,
      completedBy:      isComplete ? (user?.id||null) : null,
      completedRemarks: remarks,
    };

    const clearForm = () => {
      qs('new-task-title').value = '';
      if(qs('new-task-date'))       qs('new-task-date').value = '';
      if(qs('new-task-start-time')) qs('new-task-start-time').value = '';
      if(qs('new-task-end-time'))   qs('new-task-end-time').value = '';
      if(qs('new-task-remarks'))    qs('new-task-remarks').value = '';
      if(qs('new-task-due'))        qs('new-task-due').value = '';
      if(qs('task-add-to-cal'))     qs('task-add-to-cal').checked = false;
      if(qs('task-notify-all'))     qs('task-notify-all').checked = false;
      const notifRow = qs('task-notify-all-row'); if(notifRow) notifRow.style.display = 'none';
      _setStatus('incomplete');
    };

    const updateTimeline = () => {
      if(isComplete && startVal){
        const tl = qs('timeline-date'); if(tl) tl.value = startVal.slice(0,10);
      }
    };

    const createCalEvent = taskId => {
      if(!addToCal) return;
      if(isComplete && startVal){
        saveCalEvent({title, date:startVal.slice(0,10), startTime:startVal.slice(11,16), endTime:endVal?endVal.slice(11,16):null, color:'#5b8dd9', createdBy:user?.id, isTaskRef:true, taskId, taskDueType:'scheduled'});
      } else if(!isComplete && dueVal){
        saveCalEvent({title:'\uD83D\uDCCC Due: '+title, date:dueVal, startTime:null, endTime:null, color:'#e67e22', createdBy:user?.id, isTaskRef:true, taskId, taskDueType:'due'});
      }
    };

    const doNotify = () => {
      if(notifyAll && !isComplete && dueVal){
        addNotification(`New task: "${title}" — Due: ${dueVal}`, 'task', null);
      }
    };

    if(await serverOk()){
      try{
        const res = await apiCall('POST', '/api/tasks', payload);
        await syncFromServer();
        const newId = res?.task?.id || null;
        if(newId) createCalEvent(newId);
        doNotify();
        clearForm(); updateTimeline(); renderAll(); showToast('Task added'); return;
      }catch(e){ showToast('Error: '+e.message) }
    }
    const tasks = load(LS.tasks)||[];
    const newTask = {id:uid('t_'), ...payload};
    tasks.push(newTask); save(LS.tasks, tasks);
    createCalEvent(newTask.id);
    doNotify();
    clearForm(); updateTimeline(); renderAll(); showToast('Task added');
  };

  // ── Task filter ────────────────────────────────────────
  qs('task-filter')?.addEventListener('change', e => renderTasks(e.target.value));

  // ── Client search ──────────────────────────────────────
  qs('client-search')?.addEventListener('input', e => renderClients(e.target.value));

  // ── Timeline nav ───────────────────────────────────────
  qs('timeline-date')?.addEventListener('change', () => renderTimeline());
  qs('timeline-prev')?.addEventListener('click', () => {
    const el = qs('timeline-date'); if(!el) return;
    const d = new Date(el.value||todayStr()); d.setDate(d.getDate()-1);
    el.value = _calDateStr(d); renderTimeline();
  });
  qs('timeline-next')?.addEventListener('click', () => {
    const el = qs('timeline-date'); if(!el) return;
    const d = new Date(el.value||todayStr()); d.setDate(d.getDate()+1);
    el.value = _calDateStr(d); renderTimeline();
  });

  // ── Create user ────────────────────────────────────────
  qs('create-user-btn')?.addEventListener('click', async () => {
    const name     = qs('new-user-name').value.trim();
    const username = qs('new-user-username').value.trim();
    const pass     = qs('new-user-pass').value.trim();
    const role     = qs('new-user-role').value;
    if(!name||!username||!pass) return alert('Please fill all user fields');
    const payload  = {name, username, password:pass, role, photo:''};
    if(await serverOk()){
      try{
        await apiCall('POST', '/api/users', payload);
        await syncFromServer();
        qs('new-user-name').value=''; qs('new-user-username').value=''; qs('new-user-pass').value='';
        renderAdminAll(); showToast('User created'); return;
      }catch(e){ showToast('Error: '+e.message) }
    }
    const users = load(LS.users)||[];
    if(users.find(u=>u.username===username)) return alert('Username already taken');
    users.push({id:uid('u_'), ...payload}); save(LS.users, users);
    qs('new-user-name').value=''; qs('new-user-username').value=''; qs('new-user-pass').value='';
    renderAdminAll(); showToast('User created');
  });

  // ── Create client ──────────────────────────────────────
  qs('create-client-btn')?.addEventListener('click', async () => {
    const name = qs('new-client-name').value.trim();
    const sub  = qs('new-client-sub').value.trim();
    if(!name) return alert('Provide client name');
    const payload = {name, subscription:sub||null};
    if(await serverOk()){
      try{ await apiCall('POST','/api/clients',payload); await syncFromServer(); qs('new-client-name').value=''; qs('new-client-sub').value=''; renderAll(); showToast('Client created'); return }
      catch(e){ showToast('Error: '+e.message) }
    }
    const clients = load(LS.clients)||[]; clients.push({id:uid('c_'),...payload}); save(LS.clients,clients);
    qs('new-client-name').value=''; qs('new-client-sub').value=''; renderAll(); showToast('Client created');
  });

  // ── Admin assign task ──────────────────────────────────
  qs('admin-add-task-btn')?.addEventListener('click', async () => {
    const title  = qs('admin-task-title').value.trim();
    const due    = qs('admin-task-due')?.value||null;
    const userId = qs('admin-task-user').value;
    if(!title||!userId) return alert('Provide title and assignee');
    const payload = {title, due, assignedTo:userId};
    if(await serverOk()){
      try{ await apiCall('POST','/api/tasks',payload); await syncFromServer(); qs('admin-task-title').value=''; if(qs('admin-task-due')) qs('admin-task-due').value=''; renderAll(); showToast('Task assigned'); return }
      catch(e){ showToast('Error: '+e.message) }
    }
    const tasks = load(LS.tasks)||[]; tasks.push({id:uid('t_'),...payload,completed:false}); save(LS.tasks,tasks);
    qs('admin-task-title').value=''; if(qs('admin-task-due')) qs('admin-task-due').value=''; renderAll(); showToast('Task assigned');
  });

  // ── Complete modal ─────────────────────────────────────
  qs('complete-cancel')?.addEventListener('click', closeCompleteModal);
  qs('complete-confirm')?.addEventListener('click', async () => {
    const taskId  = _completeModalTaskId; if(!taskId) return;
    const remarks = qs('complete-remarks')?.value.trim()||null;
    const user    = currentUser();
    const now     = new Date().toISOString();
    if(await serverOk()){
      try{
        await apiCall('PUT', `/api/tasks/${taskId}`, {completed:true, completedAt:now, completedRemarks:remarks, completedBy:user?.id||null});
        await syncFromServer(); closeCompleteModal(); renderAll(); showToast('Task completed'); return;
      }catch(e){ showToast('Error: '+e.message) }
    }
    const tasks = load(LS.tasks)||[]; const t = tasks.find(x=>x.id===taskId); if(!t) return closeCompleteModal();
    t.completed=true; t.completedAt=now; t.completedRemarks=remarks; t.completedBy=user?.id||null;
    save(LS.tasks,tasks); closeCompleteModal(); renderAll(); showToast('Task completed');
  });
  qs('complete-modal')?.addEventListener('click', e => { if(e.target===qs('complete-modal')) closeCompleteModal() });

  // ── Edit modal ─────────────────────────────────────────
  qs('edit-cancel')?.addEventListener('click', closeEditModal);
  qs('edit-confirm')?.addEventListener('click', async () => {
    const taskId = _editTaskId; if(!taskId) return;
    const titleVal = qs('edit-task-title')?.value.trim();
    const sdVal    = qs('edit-actual-start-date')?.value||'';
    const stVal    = qs('edit-actual-start-time')?.value||'';
    const edVal    = qs('edit-actual-end-date')?.value||'';
    const etVal    = qs('edit-actual-end-time')?.value||'';
    const rmVal    = qs('edit-remarks')?.value.trim()||null;
    const newStart = (sdVal && stVal) ? `${sdVal}T${stVal}` : null;
    const newEnd   = (edVal && etVal) ? `${edVal}T${etVal}` : null;
    const payload  = { title:titleVal||undefined, actualStart:newStart, actualEnd:newEnd, completedRemarks:rmVal };
    if(newStart || newEnd) payload.completed = true;
    if(await serverOk()){
      try{ await apiCall('PUT',`/api/tasks/${taskId}`,payload); await syncFromServer(); closeEditModal(); renderAll(); showToast('Task updated'); return }
      catch(e){ showToast('Error: '+e.message) }
    }
    const tasks = load(LS.tasks)||[]; const idx = tasks.findIndex(t=>t.id===taskId);
    if(idx>-1){ Object.assign(tasks[idx],payload); save(LS.tasks,tasks) }
    closeEditModal(); renderAll(); showToast('Task updated');
  });
  qs('edit-delete-btn')?.addEventListener('click', async () => {
    const taskId = _editTaskId; if(!taskId) return;
    closeEditModal(); await deleteTask(taskId);
  });
  qs('edit-modal')?.addEventListener('click', e => { if(e.target===qs('edit-modal')) closeEditModal() });

  // ── Calendar nav ───────────────────────────────────────
  qs('cal-prev')?.addEventListener('click', () => {
    _calMonth--; if(_calMonth<0){_calMonth=11;_calYear--} renderCalendar();
  });
  qs('cal-next')?.addEventListener('click', () => {
    _calMonth++; if(_calMonth>11){_calMonth=0;_calYear++} renderCalendar();
  });
  qs('cal-today-btn')?.addEventListener('click', () => {
    _calYear=new Date().getFullYear(); _calMonth=new Date().getMonth(); renderCalendar();
  });
  document.querySelectorAll('.cal-view-btn').forEach(b => b.addEventListener('click', () => {
    _calView = b.dataset.calview; renderCalendar();
  }));
  const ownerSel = qs('cal-owner-select');
  if(ownerSel) ownerSel.addEventListener('change', () => { _calOwner=ownerSel.value||null; renderCalendar() });

  // ── Cal add-mode toggle ───────────────────────────────────────
  document.querySelectorAll('.cal-mode-btn').forEach(b => b.addEventListener('click', () => {
    _calAddMode = b.dataset.calmode;
    document.querySelectorAll('.cal-mode-btn').forEach(x => x.classList.toggle('active', x===b));
  }));

  // ── Cal task modal ──────────────────────────────────────────
  qs('cal-task-cancel')?.addEventListener('click', closeCalTaskModal);
  qs('cal-task-save')?.addEventListener('click', saveCalTask);
  qs('cal-task-modal')?.addEventListener('click', e => { if(e.target===qs('cal-task-modal')) closeCalTaskModal() });
  qs('cal-task-complete-btn')?.addEventListener('click', () => {
    _calTaskStatus = _calTaskStatus==='complete' ? 'incomplete' : 'complete';
    const isC = _calTaskStatus==='complete';
    qs('cal-task-complete-btn')?.classList.toggle('active', isC);
    const dw = qs('cal-status-due-wrap'); if(dw) dw.style.display = isC ? 'none' : '';
    const cf = qs('cal-complete-fields'); if(cf) cf.style.display = isC ? '' : 'none';
  });

  // Task week navigation
  qs('task-week-prev')?.addEventListener('click', () => { _tasksWeekOffset++; renderTasks(qs('task-filter')?.value||'all'); });
  qs('task-week-next')?.addEventListener('click', () => { if(_tasksWeekOffset>0){ _tasksWeekOffset--; renderTasks(qs('task-filter')?.value||'all'); } });

  // ── Event modal wiring ─────────────────────────────────
  qs('event-cancel-btn')?.addEventListener('click', closeEventModal);
  qs('event-save-btn')?.addEventListener('click',   saveEventFromModal);
  qs('event-delete-btn')?.addEventListener('click', () => {
    if(!_editingEventId || _editingEventId === 'null') return;
    if(!confirm('Delete this event?')) return;
    serverOk().then(ok => {
      if(ok) apiCall('DELETE', `/api/events/${_editingEventId}`).then(()=>syncFromServer()).catch(()=>{});
    });
    deleteCalEvent(_editingEventId); closeEventModal(); renderCalendar(); showToast('Event deleted');
  });
  qs('event-allday')?.addEventListener('change', () => {
    if(qs('event-time-row')) qs('event-time-row').style.display = qs('event-allday').checked ? 'none' : '';
  });
  qs('event-modal')?.addEventListener('click', e => { if(e.target===qs('event-modal')) closeEventModal() });

  // ── Task date filter ───────────────────────────────────
  qs('task-date-filter')?.addEventListener('change', e => {
    _taskDate = e.target.value;
    renderTasks(qs('task-filter')?.value || 'all');
  });

  // Show "Notify all" row when due date is set for incomplete task
  qs('new-task-due')?.addEventListener('change', () => {
    const dueVal  = qs('new-task-due')?.value || '';
    const notifRow = qs('task-notify-all-row');
    if(notifRow) notifRow.style.display = (_newTaskStatus === 'incomplete' && dueVal) ? '' : 'none';
  });

  // ── Send custom notification ───────────────────────────
  qs('notif-send-btn')?.addEventListener('click', () => {
    const msg = qs('notif-message')?.value.trim();
    if(!msg) return alert('Please enter a message.');
    addNotification(msg, 'custom', null);
    if(qs('notif-message')) qs('notif-message').value = '';
    renderNotifications();
    showToast('Notification sent');
  });

  // ── Mark all notifications read ────────────────────────
  qs('notif-mark-all-read')?.addEventListener('click', markAllNotifsRead);

  // ── Apply for leave ────────────────────────────────────
  qs('apply-leave-btn')?.addEventListener('click', async () => {
    const u = currentUser(); if(!u) return;
    const startDate = qs('leave-start')?.value;
    const endDate   = qs('leave-end')?.value;
    const reason    = qs('leave-reason')?.value.trim() || null;
    if(!startDate || !endDate) return alert('Please select start and end dates.');
    if(endDate < startDate)    return alert('End date cannot be before start date.');
    const leave = { id:uid('l_'), userId:u.id, startDate, endDate, reason, status:'pending', approvedBy:null, createdAt:new Date().toISOString() };
    const leaves = load(LS.leaves)||[]; leaves.push(leave); save(LS.leaves, leaves);
    addNotification(`${u.name} has applied for leave (${startDate} – ${endDate}).`, 'leave', leave.id);
    if(await serverOk()){
      try{
        await apiCall('POST', '/api/leaves', leave);
        await syncFromServer();
      }catch(e){ showToast('Error: '+e.message) }
    }
    if(qs('leave-start'))  qs('leave-start').value  = '';
    if(qs('leave-end'))    qs('leave-end').value    = '';
    if(qs('leave-reason')) qs('leave-reason').value = '';
    renderLeaves();
    showToast('Leave application submitted');
  });
}

// ═══════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════

// Global storage for the last generated report rows (used by CSV download)
let _reportRows = [];

function renderReports(){
  const el = qs('reports-content');
  if(!el) return;

  // Default month input to current month if blank
  const mi = qs('report-month-input');
  if(mi && !mi.value){
    const n = new Date();
    mi.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
  }
  const monthVal = mi ? mi.value : (() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
  if(!monthVal){ el.innerHTML = '<p class="empty-state">Select a month and click Generate.</p>'; return; }

  const [yr, mo] = monthVal.split('-').map(Number);
  const monthStart = `${yr}-${String(mo).padStart(2,'0')}-01`;
  const monthEnd   = `${yr}-${String(mo).padStart(2,'0')}-${String(new Date(yr, mo, 0).getDate()).padStart(2,'0')}`;
  const monthLabel = new Date(yr, mo-1, 1).toLocaleString([], {month:'long', year:'numeric'});

  const users  = load(LS.users)  || [];
  const tasks  = load(LS.tasks)  || [];
  const leaves = load(LS.leaves) || [];

  _reportRows = [];

  let html = `<h3 class="report-month-heading">${escapeHtml(monthLabel)}</h3>`;

  users.filter(u => u.role !== 'admin').forEach(u => {
    // Completed tasks this month
    const userTasks = tasks.filter(t =>
      t.assignedTo === u.id && t.completed &&
      t.completedAt && t.completedAt.slice(0,10) >= monthStart && t.completedAt.slice(0,10) <= monthEnd
    );

    // Calculate hours per task
    let totalHours = 0;
    const taskRows = userTasks.map(t => {
      let hrs = 0;
      if(t.actualStart && t.actualEnd)
        hrs = (new Date(t.actualEnd) - new Date(t.actualStart)) / 3600000;
      totalHours += hrs;
      _reportRows.push({
        user: u.name, task: t.title,
        completedAt: t.completedAt ? t.completedAt.slice(0,10) : '',
        actualStart: t.actualStart ? toHHMM(t.actualStart.slice(11,16)||'') : '',
        actualEnd:   t.actualEnd   ? toHHMM(t.actualEnd.slice(11,16)||'')   : '',
        hours: hrs > 0 ? hrs.toFixed(2) : ''
      });
      return `<tr>
        <td>${escapeHtml(t.title)}</td>
        <td>${t.completedAt ? t.completedAt.slice(0,10) : '—'}</td>
        <td>${t.actualStart ? t.actualStart.slice(0,10) : '—'}</td>
        <td>${t.actualStart ? toHHMM(t.actualStart.slice(11)||'') : '—'}</td>
        <td>${t.actualEnd   ? toHHMM(t.actualEnd.slice(11)||'')   : '—'}</td>
        <td>${hrs > 0 ? hrs.toFixed(2) : '—'}</td>
      </tr>`;
    }).join('');

    // Approved leaves this month (count overlapping days)
    const userLeaves = leaves.filter(l => l.userId === u.id && l.status === 'approved');
    let leaveDays = 0;
    userLeaves.forEach(l => {
      const ls = l.startDate > monthStart ? l.startDate : monthStart;
      const le = l.endDate   < monthEnd   ? l.endDate   : monthEnd;
      if(ls <= le){
        // count calendar days in range (inclusive)
        const diff = (new Date(le) - new Date(ls)) / 86400000 + 1;
        leaveDays += diff;
      }
    });

    _reportRows.push({ user: u.name, task: '— SUMMARY —', completedAt: '', actualStart: '', actualEnd: '',
      hours: totalHours.toFixed(2), note: `Leave days: ${leaveDays}` });

    html += `
    <div class="report-user-block">
      <div class="report-user-header">
        <span class="report-user-name">${escapeHtml(u.name)}</span>
        <span class="report-user-meta">${userTasks.length} task${userTasks.length===1?'':'s'} &nbsp;|&nbsp; ${totalHours.toFixed(1)}h worked &nbsp;|&nbsp; ${leaveDays} leave day${leaveDays===1?'':'s'}</span>
      </div>
      ${userTasks.length ? `
      <table class="report-table">
        <thead><tr><th>Task</th><th>Completed</th><th>Date</th><th>Start</th><th>End</th><th>Hours</th></tr></thead>
        <tbody>${taskRows}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:right;font-weight:600">Total</td><td style="font-weight:600">${totalHours.toFixed(2)}h</td></tr></tfoot>
      </table>` : `<p class="report-empty">No completed tasks this month.</p>`}
      <p class="report-leave-note">Leave taken this month: <strong>${leaveDays} day${leaveDays===1?'':'s'}</strong></p>
    </div>`;
  });

  if(users.filter(u=>u.role!=='admin').length === 0)
    html = '<p class="empty-state">No employees found.</p>';

  el.innerHTML = html;
}

function downloadReportCSV(){
  if(!_reportRows.length){ showToast('Generate a report first.'); return; }
  const mi = qs('report-month-input');
  const header = ['User','Task','Completed At','Date','Start','End','Hours Worked'];
  const rows = _reportRows.map(r => [
    `"${(r.user||'').replace(/"/g,'""')}"`,
    `"${(r.task||'').replace(/"/g,'""')}"`,
    r.completedAt||'',
    r.actualStart||'',
    r.actualEnd  ||'',
    r.hours      ||''
  ].join(','));
  const csv = [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report-${(mi&&mi.value)||'unknown'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
(async function boot(){
  await seedIfEmpty();
  initEvents();
  // Init timeline date to today
  const tld = qs('timeline-date'); if(tld) tld.value = todayStr();
  if(currentUser()) startApp(); else showLogin();
})();

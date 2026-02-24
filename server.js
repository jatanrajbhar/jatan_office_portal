const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

// ── DB config from environment variables ──
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || 'admin123';
const DB_NAME = process.env.DB_NAME || 'webapp';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);

async function initDB(){
  const pool = mysql.createPool({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, database: DB_NAME,
    waitForConnections: true, connectionLimit: 10,
    ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : undefined
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(255),
      username VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      role VARCHAR(32),
      photo TEXT
    )
  `);
  try{ await pool.query(`ALTER TABLE users MODIFY photo TEXT`) }catch(e){}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      subscription VARCHAR(255)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255),
      assigned_to INT NULL,
      due_date DATE NULL,
      completed TINYINT(1) DEFAULT 0,
      completed_at DATETIME NULL,
      completed_remarks TEXT NULL,
      completed_by INT NULL
    )
  `);

  const newCols = [
    ['planned_start', 'DATETIME NULL'],
    ['planned_end',   'DATETIME NULL'],
    ['assigned_at',   'DATETIME NULL'],
    ['actual_start',  'DATETIME NULL'],
    ['actual_end',    'DATETIME NULL'],
  ];
  for(const [col, def] of newCols){
    try{ await pool.query(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`) }catch(e){}
  }

  // Seed default data
  const [urows] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if(urows[0].c === 0){
    await pool.query('INSERT INTO users (full_name,username,password,role,photo) VALUES ?',[
      [
        ['Admin User','admin','admin123','admin','https://via.placeholder.com/72?text=AD'],
        ['Alice Johnson','alice','alice123','employee','https://via.placeholder.com/72?text=A'],
        ['Bob Smith','bob','bob123','employee','https://via.placeholder.com/72?text=B']
      ]
    ]);
  }
  const [crows] = await pool.query('SELECT COUNT(*) AS c FROM clients');
  if(crows[0].c === 0){
    await pool.query('INSERT INTO clients (name,subscription) VALUES ?',[ [ ['Acme Co','Premium'],['Beta LLC','Standard'] ] ]);
  }
  const [trows] = await pool.query('SELECT COUNT(*) AS c FROM tasks');
  if(trows[0].c === 0){
    await pool.query('INSERT INTO tasks (title,assigned_to,due_date,completed) VALUES ?',[ [ ['Onboard Acme',null,null,0] ] ]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaves (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     VARCHAR(64) NOT NULL,
      start_date  DATE NOT NULL,
      end_date    DATE NOT NULL,
      reason      TEXT,
      status      VARCHAR(20) DEFAULT 'pending',
      approved_by VARCHAR(64),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      message    TEXT NOT NULL,
      type       VARCHAR(30) DEFAULT 'custom',
      ref_id     VARCHAR(64),
      created_by VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_by    TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      title         VARCHAR(255) NOT NULL,
      description   TEXT,
      event_date    DATE NOT NULL,
      start_time    VARCHAR(8),
      end_time      VARCHAR(8),
      color         VARCHAR(7) DEFAULT '#d4af37',
      created_by    VARCHAR(64),
      shared_with   TEXT,
      is_task_ref   TINYINT DEFAULT 0,
      task_id       VARCHAR(64),
      task_due_type VARCHAR(20),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try{ await pool.query(`ALTER TABLE calendar_events MODIFY start_time VARCHAR(8)`) }catch(e){}
  try{ await pool.query(`ALTER TABLE calendar_events MODIFY end_time   VARCHAR(8)`) }catch(e){}

  return pool;
}

// Convert ISO/T-format datetime to MySQL DATETIME string ('YYYY-MM-DD HH:MM:SS')
const toMySQLDT = v => {
  if(!v) return null;
  return v.replace('T',' ').replace('Z','').slice(0,19);
};

function mapUserRow(r){ return { id:r.id.toString(), name:r.full_name, username:r.username, role:r.role, photo:r.photo } }
function mapClientRow(r){ return { id:r.id.toString(), name:r.name, subscription:r.subscription } }
function mapTaskRow(r){
  const pad2 = n => String(n).padStart(2,'0');
  const fmtDT = v => {
    if(!v) return null;
    if(v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}T${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
    return String(v).slice(0,16);
  };
  return {
    id:              r.id.toString(),
    title:           r.title,
    assignedTo:      r.assigned_to  ? r.assigned_to.toString() : null,
    due:             r.due_date     ? (r.due_date instanceof Date ? `${r.due_date.getFullYear()}-${pad2(r.due_date.getMonth()+1)}-${pad2(r.due_date.getDate())}` : String(r.due_date).slice(0,10)) : null,
    plannedStart:    fmtDT(r.planned_start),
    plannedEnd:      fmtDT(r.planned_end),
    assignedAt:      fmtDT(r.assigned_at),
    actualStart:     fmtDT(r.actual_start),
    actualEnd:       fmtDT(r.actual_end),
    completed:       !!r.completed,
    completedAt:     fmtDT(r.completed_at),
    completedRemarks:r.completed_remarks || null,
    completedBy:     r.completed_by ? r.completed_by.toString() : null
  };
}

function mapLeaveRow(r){
  const pad2 = n => String(n).padStart(2,'0');
  const fmtD = v => v instanceof Date ? `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}` : String(v).slice(0,10);
  const fmtDT = v => !v ? null : v instanceof Date ? v.toISOString() : String(v);
  return {
    id: r.id.toString(), userId: r.user_id||null,
    startDate: fmtD(r.start_date), endDate: fmtD(r.end_date),
    reason: r.reason||null, status: r.status||'pending',
    approvedBy: r.approved_by||null, createdAt: fmtDT(r.created_at),
  };
}
function mapNotifRow(r){
  return {
    id: r.id.toString(), message: r.message||'',
    type: r.type||'custom', refId: r.ref_id||null,
    createdBy: r.created_by||null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at||''),
    readBy: r.read_by ? JSON.parse(r.read_by) : [],
  };
}

function mapEventRow(r){
  const pad2 = n => String(n).padStart(2,'0');
  const fmtD = v => v instanceof Date ? `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}` : String(v).slice(0,10);
  return {
    id:          r.id.toString(),
    title:       r.title,
    description: r.description || '',
    date:        fmtD(r.event_date),
    startTime:   r.start_time  || null,
    endTime:     r.end_time    || null,
    color:       r.color       || '#d4af37',
    createdBy:   r.created_by  || null,
    sharedWith:  r.shared_with ? JSON.parse(r.shared_with) : [],
    isTaskRef:   !!r.is_task_ref,
    taskId:      r.task_id       || null,
    taskDueType: r.task_due_type || null,
  };
}

// ── Lazy pool initialization (shared across warm invocations) ──
let _poolPromise = null;
function getPool() {
  if (!_poolPromise) _poolPromise = initDB();
  return _poolPromise;
}

// ── Express App ──
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Diagnostic endpoints — no DB needed
app.get('/api/ping', (_req, res) => res.json({ ok: true }));
app.get('/api/env-check', (_req, res) => res.json({
  DB_HOST:  process.env.DB_HOST  ? '✓ set' : '✗ missing',
  DB_USER:  process.env.DB_USER  ? '✓ set' : '✗ missing',
  DB_PASS:  process.env.DB_PASS  ? '✓ set' : '✗ missing',
  DB_NAME:  process.env.DB_NAME  ? '✓ set' : '✗ missing',
  DB_PORT:  process.env.DB_PORT  ? '✓ set (' + process.env.DB_PORT + ')' : '✗ missing (using 3306)',
}));

// Attach pool to every request
app.use(async (req, res, next) => {
  try { req.pool = await getPool(); next(); }
  catch(e) {
    // Reset promise so next request retries the connection
    _poolPromise = null;
    console.error('DB init error:', e.message);
    res.status(503).json({ ok: false, message: e.message });
  }
});

// Wraps async route handlers so any thrown error goes to Express error middleware
const ah = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get('/api/sync', ah(async (req,res)=>{
  const pool = req.pool;
  const [users]   = await pool.query('SELECT id,full_name,username,role,photo,password FROM users');
  const [clients] = await pool.query('SELECT id,name,subscription FROM clients');
  const [tasks]   = await pool.query('SELECT * FROM tasks');
  const [events]  = await pool.query('SELECT * FROM calendar_events');
  const [leaves]  = await pool.query('SELECT * FROM leaves');
  const [notifs]  = await pool.query('SELECT * FROM notifications');
  res.json({ users:users.map(mapUserRow), clients:clients.map(mapClientRow), tasks:tasks.map(mapTaskRow), events:events.map(mapEventRow), leaves:leaves.map(mapLeaveRow), notifs:notifs.map(mapNotifRow) });
}));

app.post('/api/login', ah(async (req,res)=>{
  const { username, password } = req.body || {};
  if(!username||!password) return res.status(400).json({ok:false,message:'Missing credentials'});
  const pool = req.pool;
  const [rows] = await pool.query('SELECT * FROM users WHERE username=? AND password=? LIMIT 1',[username,password]);
  if(rows.length===0) return res.status(401).json({ok:false,message:'Invalid credentials'});
  res.json({ ok:true, user:mapUserRow(rows[0]) });
}));

// ─── Tasks ───
app.get('/api/tasks', ah(async (req,res)=>{
  const [tasks] = await req.pool.query('SELECT * FROM tasks');
  res.json({ tasks:tasks.map(mapTaskRow) });
}));
app.post('/api/tasks', ah(async (req,res)=>{
  const { title, due, assignedTo, plannedStart, plannedEnd, assignedAt,
          completed, actualStart, actualEnd, completedAt, completedBy, completedRemarks } = req.body || {};
  if(!title) return res.status(400).json({ok:false,message:'Missing title'});
  const pool = req.pool;
  const [r] = await pool.query(
    'INSERT INTO tasks (title,assigned_to,due_date,planned_start,planned_end,assigned_at,completed,actual_start,actual_end,completed_at,completed_by,completed_remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [title, assignedTo||null, due||null, toMySQLDT(plannedStart), toMySQLDT(plannedEnd), toMySQLDT(assignedAt),
     completed?1:0, toMySQLDT(actualStart), toMySQLDT(actualEnd), toMySQLDT(completedAt), completedBy||null, completedRemarks||null]
  );
  const [rows] = await pool.query('SELECT * FROM tasks WHERE id=?',[r.insertId]);
  res.json({ ok:true, task:mapTaskRow(rows[0]) });
}));
app.put('/api/tasks/:id', ah(async (req,res)=>{
  const id = req.params.id;
  const { title, due, assignedTo, completed, completedAt, completedRemarks, completedBy,
          plannedStart, plannedEnd, assignedAt, actualStart, actualEnd } = req.body || {};
  const pool = req.pool;
  const updates = [], params = [];
  if(typeof title           !=='undefined'){ updates.push('title=?');            params.push(title) }
  if(typeof assignedTo      !=='undefined'){ updates.push('assigned_to=?');      params.push(assignedTo||null) }
  if(typeof due             !=='undefined'){ updates.push('due_date=?');          params.push(due||null) }
  if(typeof completed       !=='undefined'){ updates.push('completed=?');         params.push(completed?1:0) }
  if(typeof completedAt     !=='undefined'){ updates.push('completed_at=?');      params.push(toMySQLDT(completedAt)) }
  if(typeof completedRemarks!=='undefined'){ updates.push('completed_remarks=?'); params.push(completedRemarks||null) }
  if(typeof completedBy     !=='undefined'){ updates.push('completed_by=?');      params.push(completedBy||null) }
  if(typeof plannedStart    !=='undefined'){ updates.push('planned_start=?');     params.push(toMySQLDT(plannedStart)) }
  if(typeof plannedEnd      !=='undefined'){ updates.push('planned_end=?');       params.push(toMySQLDT(plannedEnd)) }
  if(typeof assignedAt      !=='undefined'){ updates.push('assigned_at=?');       params.push(toMySQLDT(assignedAt)) }
  if(typeof actualStart     !=='undefined'){ updates.push('actual_start=?');      params.push(toMySQLDT(actualStart)) }
  if(typeof actualEnd       !=='undefined'){ updates.push('actual_end=?');        params.push(toMySQLDT(actualEnd)) }
  if(updates.length===0) return res.status(400).json({ok:false,message:'No fields'});
  params.push(id);
  await pool.query(`UPDATE tasks SET ${updates.join(',')} WHERE id=?`, params);
  const [rows] = await pool.query('SELECT * FROM tasks WHERE id=?',[id]);
  res.json({ ok:true, task:mapTaskRow(rows[0]) });
}));
app.delete('/api/tasks/:id', ah(async (req,res)=>{
  const id = req.params.id;
  if(!id || id === 'null' || !/^\d+$/.test(id)) return res.status(400).json({ok:false, message:'Invalid task ID'});
  await req.pool.query('DELETE FROM tasks WHERE id=?',[id]);
  res.json({ok:true});
}));

// ─── Users ───
app.get('/api/users', ah(async (req,res)=>{
  const [rows] = await req.pool.query('SELECT id,full_name,username,role,photo FROM users');
  res.json({ users:rows.map(mapUserRow) });
}));
app.post('/api/users', ah(async (req,res)=>{
  const { name, username, password, role, photo } = req.body || {};
  if(!username||!password||!name) return res.status(400).json({ok:false,message:'Missing fields'});
  const pool = req.pool;
  const [r] = await pool.query('INSERT INTO users (full_name,username,password,role,photo) VALUES (?,?,?,?,?)',[name,username,password,role||'employee',photo||null]);
  const [rows] = await pool.query('SELECT id,full_name,username,role,photo FROM users WHERE id=?',[r.insertId]);
  res.json({ ok:true, user:mapUserRow(rows[0]) });
}));
app.put('/api/users/:id', ah(async (req,res)=>{
  const id = req.params.id;
  const { name, username, password, role, photo } = req.body || {};
  const pool = req.pool; const updates=[], params=[];
  if(typeof name    !=='undefined'){ updates.push('full_name=?'); params.push(name) }
  if(typeof username!=='undefined'){ updates.push('username=?');  params.push(username) }
  if(typeof password!=='undefined'){ updates.push('password=?');  params.push(password) }
  if(typeof role    !=='undefined'){ updates.push('role=?');      params.push(role) }
  if(typeof photo   !=='undefined'){ updates.push('photo=?');     params.push(photo) }
  if(updates.length===0) return res.status(400).json({ok:false});
  params.push(id);
  await pool.query(`UPDATE users SET ${updates.join(',')} WHERE id=?`, params);
  const [rows] = await pool.query('SELECT id,full_name,username,role,photo FROM users WHERE id=?',[id]);
  res.json({ ok:true, user:mapUserRow(rows[0]) });
}));
app.delete('/api/users/:id', ah(async (req,res)=>{
  await req.pool.query('DELETE FROM users WHERE id=?',[req.params.id]);
  res.json({ok:true});
}));

// ─── Clients ───
app.get('/api/clients', ah(async (req,res)=>{
  const [rows] = await req.pool.query('SELECT id,name,subscription FROM clients');
  res.json({ clients:rows.map(mapClientRow) });
}));
app.post('/api/clients', ah(async (req,res)=>{
  const { name, subscription } = req.body || {};
  if(!name) return res.status(400).json({ok:false});
  const pool = req.pool;
  const [r] = await pool.query('INSERT INTO clients (name,subscription) VALUES (?,?)',[name,subscription||null]);
  const [rows] = await pool.query('SELECT id,name,subscription FROM clients WHERE id=?',[r.insertId]);
  res.json({ ok:true, client:mapClientRow(rows[0]) });
}));
app.put('/api/clients/:id', ah(async (req,res)=>{
  const id = req.params.id; const { name, subscription } = req.body || {};
  const pool = req.pool; const updates=[], params=[];
  if(typeof name        !=='undefined'){ updates.push('name=?');         params.push(name) }
  if(typeof subscription!=='undefined'){ updates.push('subscription=?'); params.push(subscription) }
  if(updates.length===0) return res.status(400).json({ok:false});
  params.push(id);
  await pool.query(`UPDATE clients SET ${updates.join(',')} WHERE id=?`, params);
  const [rows] = await pool.query('SELECT id,name,subscription FROM clients WHERE id=?',[id]);
  res.json({ ok:true, client:mapClientRow(rows[0]) });
}));
app.delete('/api/clients/:id', ah(async (req,res)=>{
  await req.pool.query('DELETE FROM clients WHERE id=?',[req.params.id]);
  res.json({ok:true});
}));

// ─── Leaves ───
app.get('/api/leaves', ah(async (req,res)=>{
  const [rows] = await req.pool.query('SELECT * FROM leaves');
  res.json({ leaves: rows.map(mapLeaveRow) });
}));
app.post('/api/leaves', ah(async (req,res)=>{
  const { userId, startDate, endDate, reason } = req.body||{};
  if(!userId||!startDate||!endDate) return res.status(400).json({ok:false,message:'Missing fields'});
  const pool = req.pool;
  const [r] = await pool.query('INSERT INTO leaves (user_id,start_date,end_date,reason) VALUES (?,?,?,?)',[userId,startDate,endDate,reason||null]);
  const [rows] = await pool.query('SELECT * FROM leaves WHERE id=?',[r.insertId]);
  res.json({ ok:true, leave: mapLeaveRow(rows[0]) });
}));
app.put('/api/leaves/:id', ah(async (req,res)=>{
  const id = req.params.id;
  const { status, approvedBy } = req.body||{};
  const pool = req.pool;
  if(!status) return res.status(400).json({ok:false});
  await pool.query('UPDATE leaves SET status=?,approved_by=? WHERE id=?',[status,approvedBy||null,id]);
  const [rows] = await pool.query('SELECT * FROM leaves WHERE id=?',[id]);
  res.json({ ok:true, leave: mapLeaveRow(rows[0]) });
}));

// ─── Notifications ───
app.get('/api/notifications', ah(async (req,res)=>{
  const [rows] = await req.pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
  res.json({ notifs: rows.map(mapNotifRow) });
}));
app.post('/api/notifications', ah(async (req,res)=>{
  const { message, type, refId, createdBy } = req.body||{};
  if(!message) return res.status(400).json({ok:false,message:'Missing message'});
  const pool = req.pool;
  const [r] = await pool.query('INSERT INTO notifications (message,type,ref_id,created_by) VALUES (?,?,?,?)',[message,type||'custom',refId||null,createdBy||null]);
  const [rows] = await pool.query('SELECT * FROM notifications WHERE id=?',[r.insertId]);
  res.json({ ok:true, notif: mapNotifRow(rows[0]) });
}));
app.put('/api/notifications/:id', ah(async (req,res)=>{
  const id = req.params.id;
  const { readBy } = req.body||{};
  if(!readBy) return res.status(400).json({ok:false});
  await req.pool.query('UPDATE notifications SET read_by=? WHERE id=?',[JSON.stringify(readBy),id]);
  res.json({ ok:true });
}));

// ─── Calendar Events ───
app.get('/api/events', ah(async (req,res)=>{
  const [rows] = await req.pool.query('SELECT * FROM calendar_events');
  res.json({ events:rows.map(mapEventRow) });
}));
app.post('/api/events', ah(async (req,res)=>{
  const { title,description,date,startTime,endTime,color,createdBy,sharedWith,isTaskRef,taskId,taskDueType } = req.body||{};
  if(!title||!date) return res.status(400).json({ok:false,message:'Missing title or date'});
  const pool = req.pool;
  const [r] = await pool.query(
    'INSERT INTO calendar_events (title,description,event_date,start_time,end_time,color,created_by,shared_with,is_task_ref,task_id,task_due_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [title,description||null,date,startTime||null,endTime||null,color||'#d4af37',createdBy||null,JSON.stringify(sharedWith||[]),isTaskRef?1:0,taskId||null,taskDueType||null]
  );
  const [rows] = await pool.query('SELECT * FROM calendar_events WHERE id=?',[r.insertId]);
  res.json({ ok:true, event:mapEventRow(rows[0]) });
}));
app.put('/api/events/:id', ah(async (req,res)=>{
  const id = req.params.id;
  const { title,description,date,startTime,endTime,color,sharedWith } = req.body||{};
  const pool = req.pool; const updates=[], params=[];
  if(typeof title       !=='undefined'){ updates.push('title=?');       params.push(title) }
  if(typeof description !=='undefined'){ updates.push('description=?'); params.push(description||null) }
  if(typeof date        !=='undefined'){ updates.push('event_date=?');  params.push(date) }
  if(typeof startTime   !=='undefined'){ updates.push('start_time=?');  params.push(startTime||null) }
  if(typeof endTime     !=='undefined'){ updates.push('end_time=?');    params.push(endTime||null) }
  if(typeof color       !=='undefined'){ updates.push('color=?');       params.push(color) }
  if(typeof sharedWith  !=='undefined'){ updates.push('shared_with=?'); params.push(JSON.stringify(sharedWith||[])) }
  if(updates.length===0) return res.status(400).json({ok:false});
  params.push(id);
  await pool.query(`UPDATE calendar_events SET ${updates.join(',')} WHERE id=?`, params);
  const [rows] = await pool.query('SELECT * FROM calendar_events WHERE id=?',[id]);
  res.json({ ok:true, event:mapEventRow(rows[0]) });
}));
app.delete('/api/events/:id', ah(async (req,res)=>{
  const id = req.params.id;
  if(!id || id === 'null' || !/^\d+$/.test(id)) return res.status(400).json({ok:false, message:'Invalid event ID'});
  await req.pool.query('DELETE FROM calendar_events WHERE id=?',[id]);
  res.json({ok:true});
}));

// Global error handler
app.use((err,req,res,_next)=>{
  console.error('[API Error]', req.method, req.path, err.message);
  res.status(500).json({ok:false, message:err.message});
});

// Listen only when running locally (not on Vercel serverless)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, ()=>{ console.log(`Server started on port ${PORT}`) });
}

module.exports = app;

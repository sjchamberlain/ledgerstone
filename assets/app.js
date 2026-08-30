
/* =========================================================
   DATA LAYER — talks to api.php, which enforces every permission
   server-side. Hiding buttons here is UX only, never the security
   boundary: pm_require_admin() in api.php is what actually blocks writes.
   ========================================================= */
let DATA = {
  buildings: [], units: [], owners: [], tenants: [], leases: [],
  ledger: [], maintenance: [], ownerLedger: [], communications: [], tenantCommunications: []
};
let CURRENT_USER = window.PM_USER || {role:'owner'};
let CSRF_TOKEN = window.PM_CSRF || '';
let USERS_LIST = []; // populated on demand for the Users admin tab

function isAdmin(){ return CURRENT_USER && CURRENT_USER.role === 'admin'; }

async function apiCall(action, body, method){
  method = method || (body ? 'POST' : 'GET');
  const opts = { method, headers: {} };
  if(body){
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-CSRF-Token'] = CSRF_TOKEN;
    opts.body = JSON.stringify(body);
  }
  const url = method==='GET' ? `api.php?action=${action}` : `api.php?action=${action}`;
  const res = await fetch(url, opts);
  let json;
  try{ json = await res.json(); }catch(e){ throw new Error('Server returned an unreadable response.'); }
  if(!res.ok){ throw new Error(json.error || json.message || ('Request failed ('+res.status+')')); }
  return json;
}

async function loadData(){
  try{
    const data = await apiCall('getAll', null, 'GET');
    pm_normalize_ids(data);
    DATA = data;
    CURRENT_USER = data.currentUser;
    CSRF_TOKEN = data.csrfToken;
    document.body.className = isAdmin() ? 'role-admin' : 'role-owner';
    if(currentTab==='reports' && !isAdmin() && !ownerReportState.ownerId){
      ownerReportState.ownerId = String(CURRENT_USER.ownerId||'');
    }
  }catch(e){
    console.error('Load failed', e);
  }
  render();
}

// The server sends real integer ids (MySQL auto-increment). Everywhere in this
// app that reads an id back out of the DOM — onclick="...('${x.id}')", a
// <select> value, an oninput handler — JS hands it back as a *string*.
// Rather than touch every `===` comparison in the file, normalize every id
// and foreign key to a string once, right here, so the two sides always match.
function pm_normalize_ids(data){
  const s = v => (v===null || v===undefined || v==='') ? '' : String(v);
  (data.buildings||[]).forEach(b=>{ b.id=s(b.id); (b.owners||[]).forEach(o=>{ o.ownerId=s(o.ownerId); }); });
  (data.units||[]).forEach(u=>{ u.id=s(u.id); u.buildingId=s(u.buildingId); });
  (data.owners||[]).forEach(o=>{ o.id=s(o.id); });
  (data.tenants||[]).forEach(t=>{ t.id=s(t.id); });
  (data.leases||[]).forEach(l=>{ l.id=s(l.id); l.unitId=s(l.unitId); l.tenantId=s(l.tenantId); });
  (data.ledger||[]).forEach(e=>{ e.id=s(e.id); e.leaseId=s(e.leaseId); });
  (data.maintenance||[]).forEach(m=>{ m.id=s(m.id); m.buildingId=s(m.buildingId); m.unitId=s(m.unitId); });
  (data.ownerLedger||[]).forEach(e=>{ e.id=s(e.id); e.ownerId=s(e.ownerId); e.buildingId=s(e.buildingId); });
  (data.communications||[]).forEach(c=>{ c.id=s(c.id); c.ownerId=s(c.ownerId); c.buildingId=s(c.buildingId); });
  (data.tenantCommunications||[]).forEach(c=>{ c.id=s(c.id); c.tenantId=s(c.tenantId); c.leaseId=s(c.leaseId); });
  if(data.currentUser) data.currentUser.ownerId = s(data.currentUser.ownerId);
}
function pm_normalize_user_row(u){
  const s = v => (v===null || v===undefined || v==='') ? '' : String(v);
  u.id = s(u.id); u.ownerId = s(u.ownerId);
  return u;
}
async function refreshData(){ await loadData(); }

async function apiSave(entity, record){ return apiCall('save', {entity, record}); }
async function apiDelete(entity, id){ return apiCall('delete', {entity, id}); }

function todayISO(){ return new Date().toISOString().slice(0,10); }

/* =========================================================
   LOOKUPS & COMPUTATION HELPERS
   ========================================================= */
function getBuilding(id){ return DATA.buildings.find(b=>b.id===id); }
function getUnit(id){ return DATA.units.find(u=>u.id===id); }
function getOwner(id){ return DATA.owners.find(o=>o.id===id); }
function getTenant(id){ return DATA.tenants.find(t=>t.id===id); }
function getLease(id){ return DATA.leases.find(l=>l.id===id); }

function unitsForBuilding(bid){ return DATA.units.filter(u=>u.buildingId===bid); }
function activeLeaseForUnit(unitId){ return DATA.leases.find(l=>l.unitId===unitId && l.status==='active'); }
function leasesForBuilding(bid){
  const unitIds = unitsForBuilding(bid).map(u=>u.id);
  return DATA.leases.filter(l=>unitIds.includes(l.unitId));
}
function unitLabel(unitId){
  const u = getUnit(unitId);
  if(!u) return '—';
  const b = getBuilding(u.buildingId);
  return (b?b.name:'?') + ' · Unit ' + u.number;
}
function buildingOfUnit(unitId){ const u=getUnit(unitId); return u?getBuilding(u.buildingId):null; }

function money(n){
  n = Number(n||0);
  const neg = n<0;
  const s = Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return (neg?'-':'') + '$' + s;
}
function fmtDate(d){
  if(!d) return '—';
  const dt = new Date(d+'T00:00:00');
  if(isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function daysBetween(a,b){
  const da = new Date(a+'T00:00:00'), db = new Date(b+'T00:00:00');
  return Math.round((da-db)/86400000);
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function leaseLedgerEntries(leaseId){
  return DATA.ledger.filter(e=>e.leaseId===leaseId).sort((a,b)=>a.date<b.date?-1:1);
}
function leaseBalance(leaseId){
  const entries = leaseLedgerEntries(leaseId);
  let bal = 0;
  entries.forEach(e=>{ bal += (e.type==='charge'? Number(e.amount) : -Number(e.amount)); });
  return bal;
}

// FIFO aging: allocate payments to oldest charges first, return {balance, daysLate, bucket, oldestUnpaidDate}
function fifoAging(leaseId, asOfDate){
  const entries = DATA.ledger.filter(e=>e.leaseId===leaseId && e.date<=asOfDate);
  const charges = entries.filter(e=>e.type==='charge').sort((a,b)=>a.date<b.date?-1:1)
    .map(e=>({date:e.date, remaining:Number(e.amount)}));
  let paymentPool = entries.filter(e=>e.type==='payment').reduce((s,e)=>s+Number(e.amount),0);
  for(const c of charges){
    if(paymentPool<=0) break;
    const applied = Math.min(c.remaining, paymentPool);
    c.remaining -= applied;
    paymentPool -= applied;
  }
  const unpaid = charges.filter(c=>c.remaining > 0.005);
  const balance = unpaid.reduce((s,c)=>s+c.remaining,0);
  if(unpaid.length===0){
    return {balance:0, daysLate:0, bucket:'current', oldestUnpaidDate:null};
  }
  const oldestDate = unpaid.reduce((min,c)=> (c.date<min?c.date:min), unpaid[0].date);
  let daysLate = daysBetween(asOfDate, oldestDate);
  if(daysLate<0) daysLate=0;
  let bucket;
  if(daysLate<=30) bucket='0-30';
  else if(daysLate<=60) bucket='31-60';
  else if(daysLate<=90) bucket='61-90';
  else bucket='90+';
  return {balance, daysLate, bucket, oldestUnpaidDate:oldestDate};
}

function isDateInRange(d, start, end){
  if(!d) return false;
  if(start && d<start) return false;
  if(end && d>end) return false;
  return true;
}

/* =========================================================
   APP / NAV STATE
   ========================================================= */
let currentTab = 'dashboard';
let modal = null;   // {type:'building'|'unit'|..., mode:'add'|'edit'}
let draft = null;   // working copy of entity being edited in modal
let confirmState = null; // {message, onYes: fn}
let ledgerSelectedLease = null;
let filters = { maintBuilding:'', ownerBillBuilding:'', commOwner:'', commBuilding:'', tcommTenant:'', tcommBuilding:'', commContactType:'' };
let viewingOwnerId = null;
let viewingTenantId = null;
let ownerReportState = { ownerId:'', start:'', end:'' , building:''};
let arrearsReportState = { asOf: todayISO(), building:'' };
let feeGenState = { buildingId:'', month: new Date().toISOString().slice(0,7) };

const NAV_BASE = [
  {id:'dashboard', label:'Dashboard'},
  {id:'properties', label:'Buildings & Units'},
  {id:'owners', label:'Owners'},
  {id:'tenants', label:'Tenants'},
  {id:'leases', label:'Leases'},
  {id:'ledger', label:'Tenant Ledger'},
  {id:'maintenance', label:'Maintenance'},
  {id:'billing', label:'Owner Billing'},
  {id:'communications', label:'Communications'},
  {id:'reports', label:'Reports'}
];
const NAV_ADMIN_ONLY = [{id:'users', label:'Users'}];
function currentNav(){ return isAdmin() ? [...NAV_BASE, ...NAV_ADMIN_ONLY] : NAV_BASE; }

function setTab(t){
  currentTab=t;
  if(t==='users' && isAdmin()){ loadUsers(); } else { render(); }
}

/* =========================================================
   RENDER SHELL
   ========================================================= */
function render(){
  const app = document.getElementById('app');
  app.innerHTML = renderSidebar() + '<div class="main">' + renderTab() + '</div>' + renderModal() + renderConfirm();
}

function renderSidebar(){
  const nav = currentNav();
  let items = nav.map((n,i)=>`
    <div class="nav-item ${currentTab===n.id?'active':''}" onclick="setTab('${n.id}')">
      <span class="nav-num">${String(i+1).padStart(2,'0')}</span><span>${n.label}</span>
    </div>`).join('');
  return `<div class="sidebar">
    <div class="brand">
      <div class="brand-mark">Ledgerstone</div>
      <div class="brand-sub">Property Operations</div>
    </div>
    <div class="nav">${items}</div>
    <div class="sidebar-foot">
      <div>${esc(CURRENT_USER.displayName||CURRENT_USER.username||'')} · ${isAdmin()?'Staff':'Owner'}</div>
      <div style="margin-top:6px;"><a href="#" onclick="openModal('changePassword','edit');return false;" style="color:#9FB2C4;">Change password</a> · <a href="logout.php" style="color:#9FB2C4;">Log out</a></div>
    </div>
  </div>`;
}

function renderTab(){
  switch(currentTab){
    case 'dashboard': return renderDashboard();
    case 'properties': return renderProperties();
    case 'owners': return renderOwners();
    case 'tenants': return renderTenants();
    case 'leases': return renderLeases();
    case 'ledger': return renderLedger();
    case 'maintenance': return renderMaintenance();
    case 'billing': return renderBilling();
    case 'communications': return renderCommunications();
    case 'reports': return renderReports();
    case 'users': return isAdmin() ? renderUsers() : renderDashboard();
    default: return '';
  }
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function renderDashboard(){
  const occupied = DATA.units.filter(u=>activeLeaseForUnit(u.id)).length;
  const totalUnits = DATA.units.length;
  const occPct = totalUnits? Math.round(100*occupied/totalUnits) : 0;
  const activeLeases = DATA.leases.filter(l=>l.status==='active');
  const totalArrears = activeLeases.reduce((s,l)=> s + Math.max(0, leaseBalance(l.id)), 0);
  const openMaint = DATA.maintenance.filter(m=>m.status!=='completed').length;
  const now = new Date();
  const monthStart = now.toISOString().slice(0,7)+'-01';
  const monthEnd = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);
  const rentThisMonth = DATA.ledger.filter(e=>e.type==='payment' && e.category==='rent' && isDateInRange(e.date, monthStart, monthEnd))
    .reduce((s,e)=>s+Number(e.amount),0);

  const arrearsRows = activeLeases.map(l=>({l, bal: leaseBalance(l.id)}))
    .filter(x=>x.bal>0.5).sort((a,b)=>b.bal-a.bal).slice(0,6);
  const maintRows = DATA.maintenance.filter(m=>m.status!=='completed')
    .sort((a,b)=> (a.priority==='urgent'?0:1) - (b.priority==='urgent'?0:1)).slice(0,6);

  return `
  <div class="page-head">
    <div><h1 class="page-title">Dashboard</h1><div class="page-sub">Portfolio overview across all buildings</div></div>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Buildings</div><div class="kpi-value">${DATA.buildings.length}</div></div>
    <div class="kpi"><div class="kpi-label">Occupancy</div><div class="kpi-value">${occPct}%</div><div class="subtle">${occupied} of ${totalUnits} units</div></div>
    <div class="kpi"><div class="kpi-label">Rent Collected (MTD)</div><div class="kpi-value good">${money(rentThisMonth)}</div></div>
    <div class="kpi"><div class="kpi-label">Total Arrears</div><div class="kpi-value ${totalArrears>0?'bad':''}">${money(totalArrears)}</div></div>
    <div class="kpi"><div class="kpi-label">Open Maintenance</div><div class="kpi-value ${openMaint>0?'bad':''}">${openMaint}</div></div>
  </div>

  <div class="row" style="align-items:flex-start;gap:20px;">
    <div class="panel" style="flex:1;min-width:320px;">
      <h3>Tenants in arrears</h3>
      ${arrearsRows.length? `<table><thead><tr><th>Tenant</th><th>Unit</th><th class="num">Balance</th></tr></thead><tbody>
        ${arrearsRows.map(x=>`<tr><td>${esc(getTenant(x.l.tenantId)?.name||'—')}</td><td>${esc(unitLabel(x.l.unitId))}</td><td class="num balance-pos">${money(x.bal)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">No outstanding balances.</div>`}
    </div>
    <div class="panel" style="flex:1;min-width:320px;">
      <h3>Open maintenance requests</h3>
      ${maintRows.length? `<table><thead><tr><th>Title</th><th>Unit</th><th>Priority</th><th>Status</th></tr></thead><tbody>
        ${maintRows.map(m=>`<tr><td>${esc(m.title)}</td><td>${esc(m.unitId?unitLabel(m.unitId):(getBuilding(m.buildingId)?.name||'—'))}</td><td>${priorityTag(m.priority)}</td><td>${statusTag(m.status)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">Nothing open. Nice.</div>`}
    </div>
  </div>`;
}

function priorityTag(p){
  const map = {low:'tag-neutral', medium:'tag-warn', high:'tag-bad', urgent:'tag-bad'};
  return `<span class="tag ${map[p]||'tag-neutral'}">${esc(p)}</span>`;
}
function statusTag(s){
  const map = {open:'tag-bad', in_progress:'tag-warn', completed:'tag-good', active:'tag-good', ended:'tag-neutral'};
  const label = {open:'Open', in_progress:'In progress', completed:'Completed', active:'Active', ended:'Ended'}[s] || s;
  return `<span class="tag ${map[s]||'tag-neutral'}">${esc(label)}</span>`;
}

/* =========================================================
   PROPERTIES: BUILDINGS + UNITS
   ========================================================= */
function renderProperties(){
  const blocks = DATA.buildings.map(b=>{
    const units = unitsForBuilding(b.id);
    const ownerLine = (b.owners||[]).map(o=>{
      const own = getOwner(o.ownerId);
      return `${own?own.name:'?'} (${o.pct}%)`;
    }).join(', ') || 'No owners assigned';
    const feeLine = b.feeType==='percent' ? `${b.feeValue}% of collected rent` : `${money(b.feeValue)} / unit / month`;
    return `<div class="building-block">
      <div class="building-head">
        <div>
          <h4>${esc(b.name)}</h4>
          <div class="addr">${esc(b.address||'')}</div>
          <div class="subtle" style="margin-top:4px;">Owners: ${esc(ownerLine)} &nbsp;·&nbsp; Fee: ${esc(feeLine)}</div>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('unit','add',null,'${b.id}')">+ Unit</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('building','edit','${b.id}')">Edit</button>
          <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete ${esc(b.name)} and all its units? Leases and ledger tied to those units will remain but become unlinked from a building.','deleteBuilding','${b.id}')">Delete</button>
        </div>
      </div>
      <div class="unit-table-wrap">
        ${units.length? `<table><thead><tr><th>Unit</th><th>Beds</th><th>Baths</th><th>Sqft</th><th>Status</th><th>Tenant</th><th></th></tr></thead><tbody>
          ${units.map(u=>{
            const lease = activeLeaseForUnit(u.id);
            const tenant = lease? getTenant(lease.tenantId) : null;
            return `<tr>
              <td>${esc(u.number)}</td><td>${esc(u.beds)}</td><td>${esc(u.baths)}</td><td>${esc(u.sqft||'—')}</td>
              <td>${lease? statusTag('active') : '<span class="tag tag-neutral">Vacant</span>'}</td>
              <td>${tenant? esc(tenant.name) : '—'}</td>
              <td class="row" style="justify-content:flex-end;">
                <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('unit','edit','${u.id}')">Edit</button>
                <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete unit ${esc(u.number)}?','deleteUnit','${u.id}')">Delete</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody></table>` : `<div class="empty">No units yet.</div>`}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="page-head">
    <div><h1 class="page-title">Buildings &amp; Units</h1><div class="page-sub">Your portfolio, unit by unit</div></div>
    <button class="btn admin-only" onclick="openModal('building','add')">+ Add Building</button>
  </div>
  ${blocks || '<div class="panel"><div class="empty">No buildings yet. Add your first one to get started.</div></div>'}
  `;
}

/* =========================================================
   OWNERS
   ========================================================= */
function viewOwner(id){ viewingOwnerId = id; render(); }
function renderOwners(){
  if(viewingOwnerId) return renderOwnerDetail(viewingOwnerId);
  const rows = DATA.owners.map(o=>{
    const stakes = DATA.buildings.filter(b=>(b.owners||[]).some(x=>x.ownerId===o.id))
      .map(b=>{ const pct = b.owners.find(x=>x.ownerId===o.id).pct; return `${b.name} (${pct}%)`; }).join(', ');
    return `<tr>
      <td><span class="mini-link" style="text-decoration:none;font-weight:600;color:var(--ink);" onclick="viewOwner('${o.id}')">${esc(o.name)}</span></td><td>${esc(o.email||'—')}</td><td>${esc(o.phone||'—')}</td>
      <td>${esc(stakes||'—')}</td>
      <td class="row" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="viewOwner('${o.id}')">View</button>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('communication','add',null,'${o.id}')">Log contact</button>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('owner','edit','${o.id}')">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete owner ${esc(o.name)}? This will remove them from any buildings.','deleteOwner','${o.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Owners</h1><div class="page-sub">Building owners you manage on behalf of</div></div>
    <button class="btn admin-only" onclick="openModal('owner','add')">+ Add Owner</button>
  </div>
  <div class="panel">
    ${DATA.owners.length? `<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Stakes</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No owners yet.</div>`}
  </div>`;
}

function renderOwnerDetail(id){
  const o = getOwner(id);
  if(!o){ viewingOwnerId=null; return renderOwners(); }
  const stakes = DATA.buildings.filter(b=>(b.owners||[]).some(x=>x.ownerId===o.id));
  const buildingRows = stakes.map(b=>{
    const pct = b.owners.find(x=>x.ownerId===o.id).pct;
    const feeLine = b.feeType==='percent' ? `${b.feeValue}% of collected rent` : `${money(b.feeValue)} / unit / month`;
    return `<tr><td>${esc(b.name)}</td><td>${esc(b.address||'—')}</td><td class="num">${pct}%</td><td>${esc(feeLine)}</td></tr>`;
  }).join('');

  const billing = DATA.ownerLedger.filter(e=>e.ownerId===o.id).sort((a,b)=>b.date<a.date?-1:1);
  const balance = billing.reduce((s,e)=> s + (e.type==='charge'?Number(e.amount):-Number(e.amount)), 0);
  const billingRows = billing.slice(0,25).map(e=>`<tr>
    <td>${fmtDate(e.date)}</td><td>${esc(getBuilding(e.buildingId)?.name||'—')}</td>
    <td>${e.type==='charge'?'<span class="tag tag-bad">Fee</span>':'<span class="tag tag-good">Payment</span>'}</td>
    <td>${esc(e.memo||'—')}</td><td class="num">${money(e.amount)}</td>
  </tr>`).join('');

  const comms = DATA.communications.filter(c=>c.ownerId===o.id).sort((a,b)=>b.date<a.date?-1:1);
  const commRows = comms.map(c=>`<tr>
    <td>${fmtDate(c.date)}</td><td>${commTypeTag(c.method)}</td><td>${esc(c.subject||'—')}</td><td>${c.followUpDate?fmtDate(c.followUpDate):'—'}</td>
  </tr>`).join('');

  return `
  <div class="page-head">
    <div>
      <span class="mini-link" onclick="viewingOwnerId=null;render();">← Back to owners</span>
      <h1 class="page-title" style="margin-top:6px;">${esc(o.name)}</h1>
      <div class="page-sub">${esc(o.email||'')}${o.email&&o.phone?' · ':''}${esc(o.phone||'')}</div>
    </div>
    <div class="row">
      <button class="btn btn-ghost admin-only" onclick="openModal('communication','add',null,'${o.id}')">+ Log contact</button>
      <button class="btn btn-ghost admin-only" onclick="openModal('owner','edit','${o.id}')">Edit owner</button>
    </div>
  </div>

  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    <div class="kpi"><div class="kpi-label">Buildings owned</div><div class="kpi-value">${stakes.length}</div></div>
    <div class="kpi"><div class="kpi-label">Balance owed to you</div><div class="kpi-value ${balance>0.5?'bad':''}">${money(balance)}</div></div>
    <div class="kpi"><div class="kpi-label">Contacts logged</div><div class="kpi-value">${comms.length}</div></div>
  </div>

  <div class="panel">
    <h3>Buildings</h3>
    ${buildingRows? `<table><thead><tr><th>Building</th><th>Address</th><th class="num">Stake</th><th>Fee</th></tr></thead><tbody>${buildingRows}</tbody></table>` : `<div class="empty">No buildings assigned to this owner yet.</div>`}
  </div>

  <div class="panel">
    <h3>Billing ledger</h3>
    ${billingRows? `<table><thead><tr><th>Date</th><th>Building</th><th>Type</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>${billingRows}</tbody></table>` : `<div class="empty">No billing entries yet.</div>`}
  </div>

  <div class="panel">
    <h3>Communications</h3>
    ${commRows? `<table><thead><tr><th>Date</th><th>Method</th><th>Subject</th><th>Follow-up</th></tr></thead><tbody>${commRows}</tbody></table>` : `<div class="empty">No communications logged yet.</div>`}
  </div>`;
}

/* =========================================================
   TENANTS
   ========================================================= */
function viewTenant(id){ viewingTenantId = id; render(); }
function renderTenants(){
  if(viewingTenantId) return renderTenantDetail(viewingTenantId);
  const rows = DATA.tenants.map(t=>{
    const lease = DATA.leases.find(l=>l.tenantId===t.id && l.status==='active');
    return `<tr>
      <td><span class="mini-link" style="text-decoration:none;font-weight:600;color:var(--ink);" onclick="viewTenant('${t.id}')">${esc(t.name)}</span></td><td>${esc(t.email||'—')}</td><td>${esc(t.phone||'—')}</td>
      <td>${lease? esc(unitLabel(lease.unitId)) : '<span class="subtle">No active lease</span>'}</td>
      <td class="row" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="viewTenant('${t.id}')">View</button>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('tenantComm','add',null,'${t.id}')">Log contact</button>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('tenant','edit','${t.id}')">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete tenant ${esc(t.name)}?','deleteTenant','${t.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Tenants</h1><div class="page-sub">Everyone renting from you, across all buildings</div></div>
    <button class="btn admin-only" onclick="openModal('tenant','add')">+ Add Tenant</button>
  </div>
  <div class="panel">
    ${DATA.tenants.length? `<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Unit</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No tenants yet.</div>`}
  </div>`;
}

function renderTenantDetail(id){
  const t = getTenant(id);
  if(!t){ viewingTenantId=null; return renderTenants(); }
  const leases = DATA.leases.filter(l=>l.tenantId===t.id).sort((a,b)=> (b.status==='active'?1:0)-(a.status==='active'?1:0));
  const leaseRows = leases.map(l=>{
    const bal = leaseBalance(l.id);
    return `<tr>
      <td>${esc(unitLabel(l.unitId))}</td><td>${fmtDate(l.startDate)} → ${l.endDate?fmtDate(l.endDate):'open'}</td>
      <td class="num">${money(l.rentAmount)}</td><td>${statusTag(l.status)}</td>
      <td class="num ${bal>0.5?'balance-pos':''}">${money(bal)}</td>
      <td class="row" style="justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="setTab('ledger');selectLease('${l.id}')">Open ledger</button></td>
    </tr>`;
  }).join('');

  const leaseUnitIds = leases.map(l=>l.unitId);
  const maint = DATA.maintenance.filter(m=>leaseUnitIds.includes(m.unitId)).sort((a,b)=>b.dateReported<a.dateReported?-1:1);
  const maintRows = maint.map(m=>`<tr>
    <td>${esc(m.title)}</td><td>${esc(unitLabel(m.unitId))}</td><td>${priorityTag(m.priority)}</td><td>${statusTag(m.status)}</td><td>${fmtDate(m.dateReported)}</td>
  </tr>`).join('');

  const comms = DATA.tenantCommunications.filter(c=>c.tenantId===t.id).sort((a,b)=>b.date<a.date?-1:1);
  const commRows = comms.map(c=>`<tr>
    <td>${fmtDate(c.date)}</td><td>${commTypeTag(c.method)}</td><td>${esc(c.subject||'—')}</td><td>${c.followUpDate?fmtDate(c.followUpDate):'—'}</td>
  </tr>`).join('');

  const totalBalance = leases.filter(l=>l.status==='active').reduce((s,l)=>s+Math.max(0,leaseBalance(l.id)),0);

  return `
  <div class="page-head">
    <div>
      <span class="mini-link" onclick="viewingTenantId=null;render();">← Back to tenants</span>
      <h1 class="page-title" style="margin-top:6px;">${esc(t.name)}</h1>
      <div class="page-sub">${esc(t.email||'')}${t.email&&t.phone?' · ':''}${esc(t.phone||'')}</div>
    </div>
    <div class="row">
      <button class="btn btn-ghost admin-only" onclick="openModal('tenantComm','add',null,'${t.id}')">+ Log contact</button>
      <button class="btn btn-ghost admin-only" onclick="openModal('tenant','edit','${t.id}')">Edit tenant</button>
    </div>
  </div>

  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    <div class="kpi"><div class="kpi-label">Leases</div><div class="kpi-value">${leases.length}</div></div>
    <div class="kpi"><div class="kpi-label">Current balance</div><div class="kpi-value ${totalBalance>0.5?'bad':''}">${money(totalBalance)}</div></div>
    <div class="kpi"><div class="kpi-label">Open maintenance</div><div class="kpi-value">${maint.filter(m=>m.status!=='completed').length}</div></div>
  </div>

  <div class="panel">
    <h3>Leases</h3>
    ${leaseRows? `<table><thead><tr><th>Unit</th><th>Term</th><th class="num">Rent</th><th>Status</th><th class="num">Balance</th><th></th></tr></thead><tbody>${leaseRows}</tbody></table>` : `<div class="empty">No leases yet.</div>`}
  </div>

  <div class="panel">
    <h3>Maintenance requests</h3>
    ${maintRows? `<table><thead><tr><th>Title</th><th>Unit</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead><tbody>${maintRows}</tbody></table>` : `<div class="empty">No maintenance requests logged for this tenant's units.</div>`}
  </div>

  <div class="panel">
    <h3>Communications</h3>
    ${commRows? `<table><thead><tr><th>Date</th><th>Method</th><th>Subject</th><th>Follow-up</th></tr></thead><tbody>${commRows}</tbody></table>` : `<div class="empty">No communications logged yet.</div>`}
  </div>`;
}

/* =========================================================
   LEASES
   ========================================================= */
function renderLeases(){
  const rows = DATA.leases.slice().sort((a,b)=> (b.status==='active'?1:0) - (a.status==='active'?1:0)).map(l=>{
    const bal = leaseBalance(l.id);
    return `<tr>
      <td>${esc(getTenant(l.tenantId)?.name||'—')}</td>
      <td>${esc(unitLabel(l.unitId))}</td>
      <td>${fmtDate(l.startDate)} → ${l.endDate?fmtDate(l.endDate):'open'}</td>
      <td class="num">${money(l.rentAmount)}</td>
      <td>${statusTag(l.status)}</td>
      <td class="num ${bal>0.5?'balance-pos':''}">${money(bal)}</td>
      <td class="row" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="setTab('ledger');selectLease('${l.id}')">Ledger</button>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('lease','edit','${l.id}')">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this lease? Ledger entries tied to it remain but become orphaned.','deleteLease','${l.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Leases</h1><div class="page-sub">Who's renting what, and on what terms</div></div>
    <button class="btn admin-only" onclick="openModal('lease','add')">+ Add Lease</button>
  </div>
  <div class="panel">
    ${DATA.leases.length? `<table><thead><tr><th>Tenant</th><th>Unit</th><th>Term</th><th class="num">Rent</th><th>Status</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No leases yet.</div>`}
  </div>`;
}

/* =========================================================
   TENANT LEDGER
   ========================================================= */
function selectLease(id){ ledgerSelectedLease = id; render(); }

function renderLedger(){
  const leaseOptions = DATA.leases.map(l=>`<option value="${l.id}" ${ledgerSelectedLease===l.id?'selected':''}>${esc(getTenant(l.tenantId)?.name||'?')} — ${esc(unitLabel(l.unitId))}</option>`).join('');
  let body = '<div class="empty">Select a lease to view its ledger.</div>';
  if(ledgerSelectedLease){
    const lease = getLease(ledgerSelectedLease);
    if(!lease){ ledgerSelectedLease=null; }
    else{
      const entries = leaseLedgerEntries(lease.id);
      let running = 0;
      const rowsHtml = entries.map(e=>{
        running += (e.type==='charge'? Number(e.amount) : -Number(e.amount));
        return `<tr>
          <td>${fmtDate(e.date)}</td>
          <td>${e.type==='charge'? '<span class="tag tag-bad">Charge</span>' : '<span class="tag tag-good">Payment</span>'}</td>
          <td>${esc(e.category)}</td>
          <td>${esc(e.memo||'—')}</td>
          <td class="num">${e.type==='charge'?money(e.amount):'—'}</td>
          <td class="num">${e.type==='payment'?money(e.amount):'—'}</td>
          <td class="num">${money(running)}</td>
          <td class="row" style="justify-content:flex-end;">
            <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this ledger entry?','deleteLedgerEntry','${e.id}')">Delete</button>
          </td>
        </tr>`;
      }).join('');
      const bal = leaseBalance(lease.id);
      body = `
      <div class="row" style="justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="font-size:15px;font-weight:600;">${esc(getTenant(lease.tenantId)?.name||'?')}</div>
          <div class="subtle">${esc(unitLabel(lease.unitId))} · Rent ${money(lease.rentAmount)}/mo · Lease ${fmtDate(lease.startDate)} → ${lease.endDate?fmtDate(lease.endDate):'open'}</div>
        </div>
        <div style="text-align:right;">
          <div class="subtle">Current balance</div>
          <div style="font-family:var(--mono);font-size:20px;font-weight:600;" class="${bal>0.5?'balance-pos':''}">${money(bal)}</div>
        </div>
      </div>
      <div class="row" style="margin-bottom:14px;">
        <button class="btn admin-only" onclick="openModal('ledgerCharge','add',null,'${lease.id}')">+ Add Charge</button>
        <button class="btn btn-ghost admin-only" onclick="openModal('ledgerPayment','add',null,'${lease.id}')">+ Record Payment</button>
      </div>
      ${entries.length? `<table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Memo</th><th class="num">Charge</th><th class="num">Payment</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>` : `<div class="empty">No transactions yet.</div>`}
      `;
    }
  }
  return `
  <div class="page-head">
    <div><h1 class="page-title">Tenant Ledger</h1><div class="page-sub">Charges, payments, and running balance per lease</div></div>
  </div>
  <div class="panel">
    <div class="field" style="max-width:420px;">
      <label>Select lease</label>
      <select onchange="selectLease(this.value)"><option value="">— choose a lease —</option>${leaseOptions}</select>
    </div>
    ${body}
  </div>`;
}

/* =========================================================
   MAINTENANCE
   ========================================================= */
function renderMaintenance(){
  const list = DATA.maintenance.filter(m=> !filters.maintBuilding || m.buildingId===filters.maintBuilding)
    .slice().sort((a,b)=> (a.dateReported<b.dateReported?1:-1));
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${filters.maintBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const rows = list.map(m=>`<tr>
    <td>${esc(m.title)}</td>
    <td>${esc(m.buildingId?getBuilding(m.buildingId)?.name||'—':'—')}${m.unitId? ' · '+esc(getUnit(m.unitId)?.number||'') : ''}</td>
    <td>${priorityTag(m.priority)}</td>
    <td>${statusTag(m.status)}</td>
    <td>${fmtDate(m.dateReported)}</td>
    <td>${m.dateCompleted?fmtDate(m.dateCompleted):'—'}</td>
    <td class="num">${m.cost?money(m.cost):'—'}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('maintenance','edit','${m.id}')">Edit</button>
      <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this maintenance request?','deleteMaintenance','${m.id}')">Delete</button>
    </td>
  </tr>`).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Maintenance</h1><div class="page-sub">Requests and repair tracking across your buildings</div></div>
    <button class="btn admin-only" onclick="openModal('maintenance','add')">+ Add Request</button>
  </div>
  <div class="filter-bar">
    <select onchange="filters.maintBuilding=this.value;render();"><option value="">All buildings</option>${buildingOptions}</select>
  </div>
  <div class="panel">
    ${list.length? `<table><thead><tr><th>Title</th><th>Location</th><th>Priority</th><th>Status</th><th>Reported</th><th>Completed</th><th class="num">Cost</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No maintenance requests.</div>`}
  </div>`;
}

/* =========================================================
   OWNER BILLING (management fees)
   ========================================================= */
function renderBilling(){
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${feeGenState.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const ownerFilterOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${filters.ownerBillBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');

  const list = DATA.ownerLedger.filter(e=> !filters.ownerBillBuilding || e.buildingId===filters.ownerBillBuilding)
    .slice().sort((a,b)=> b.date<a.date?-1:1);
  const rows = list.map(e=>`<tr>
    <td>${fmtDate(e.date)}</td>
    <td>${esc(getOwner(e.ownerId)?.name||'—')}</td>
    <td>${esc(getBuilding(e.buildingId)?.name||'—')}</td>
    <td>${e.type==='charge'?'<span class="tag tag-bad">Fee charged</span>':'<span class="tag tag-good">Payment received</span>'}</td>
    <td>${esc(e.memo||'—')}</td>
    <td class="num">${money(e.amount)}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this billing entry?','deleteOwnerLedgerEntry','${e.id}')">Delete</button>
    </td>
  </tr>`).join('');

  // running balance owed by each owner (charges - payments), across all buildings
  const balances = {};
  DATA.ownerLedger.forEach(e=>{
    balances[e.ownerId] = (balances[e.ownerId]||0) + (e.type==='charge'?Number(e.amount):-Number(e.amount));
  });
  const balanceRows = DATA.owners.map(o=>`<tr><td>${esc(o.name)}</td><td class="num ${balances[o.id]>0.5?'balance-pos':''}">${money(balances[o.id]||0)}</td></tr>`).join('');

  return `
  <div class="page-head">
    <div><h1 class="page-title">Owner Billing</h1><div class="page-sub">Management fees you charge building owners, and what they've paid</div></div>
    <button class="btn admin-only" onclick="openModal('ownerLedger','add')">+ Manual Entry</button>
  </div>

  <div class="panel">
    <h3>Generate monthly management fee</h3>
    <div class="row" style="align-items:flex-end;">
      <div class="field" style="min-width:220px;">
        <label>Building</label>
        <select onchange="feeGenState.buildingId=this.value;">
          <option value="">— choose —</option>${buildingOptions}
        </select>
      </div>
      <div class="field" style="min-width:160px;">
        <label>Month</label>
        <input type="month" value="${feeGenState.month}" oninput="feeGenState.month=this.value;">
      </div>
      <button class="btn" onclick="generateMonthlyFee()">Generate Fee Charges</button>
    </div>
    <div class="subtle">Calculates rent collected that month for the building, applies the building's fee rate, and splits the charge across its owners by ownership %.</div>
  </div>

  <div class="row" style="align-items:flex-start;gap:20px;">
    <div class="panel" style="flex:2;min-width:400px;">
      <h3>Billing ledger</h3>
      <div class="filter-bar"><select onchange="filters.ownerBillBuilding=this.value;render();"><option value="">All buildings</option>${ownerFilterOptions}</select></div>
      ${list.length? `<table><thead><tr><th>Date</th><th>Owner</th><th>Building</th><th>Type</th><th>Memo</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No billing entries yet.</div>`}
    </div>
    <div class="panel" style="flex:1;min-width:260px;">
      <h3>Balance owed, by owner</h3>
      ${DATA.owners.length? `<table><thead><tr><th>Owner</th><th class="num">Owes</th></tr></thead><tbody>${balanceRows}</tbody></table>` : `<div class="empty">No owners yet.</div>`}
    </div>
  </div>`;
}

async function generateMonthlyFee(){
  if(!feeGenState.buildingId){ alertMsg('Choose a building first.'); return; }
  if(!feeGenState.month){ alertMsg('Choose a month.'); return; }
  try{
    const result = await apiCall('generateFee', {buildingId:feeGenState.buildingId, month:feeGenState.month});
    if(result.ok){ await refreshData(); }
    alertMsg(result.message || 'Done.');
  }catch(e){
    alertMsg('Could not generate fee: '+e.message);
  }
}

function alertMsg(msg){
  confirmState = {message: msg, onlyOk:true};
  render();
}

/* =========================================================
   COMMUNICATIONS (owners + tenants, combined log)
   ========================================================= */
function commTypeTag(t){
  const label = {call:'Call', email:'Email', text:'Text', in_person:'In person', letter:'Letter'}[t] || t;
  return `<span class="tag tag-neutral">${esc(label)}</span>`;
}
function buildingOfTenantComm(c){
  const lease = c.leaseId? getLease(c.leaseId) : null;
  if(!lease) return '';
  const b = buildingOfUnit(lease.unitId);
  return b? b.id : '';
}
function renderCommunications(){
  const ownerOptions = DATA.owners.map(o=>`<option value="${o.id}" ${filters.commOwner===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const tenantOptions = DATA.tenants.map(t=>`<option value="${t.id}" ${filters.tcommTenant===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${filters.commBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');

  // Combine both logs into one virtual list, tagged by kind
  let combined = [
    ...DATA.communications.map(c=>({...c, kind:'owner'})),
    ...DATA.tenantCommunications.map(c=>({...c, kind:'tenant'}))
  ];
  combined = combined.filter(c=>{
    if(filters.commContactType==='owner' && c.kind!=='owner') return false;
    if(filters.commContactType==='tenant' && c.kind!=='tenant') return false;
    if(filters.commOwner && !(c.kind==='owner' && c.ownerId===filters.commOwner)) return false;
    if(filters.tcommTenant && !(c.kind==='tenant' && c.tenantId===filters.tcommTenant)) return false;
    if(filters.commBuilding){
      const b = c.kind==='owner' ? c.buildingId : buildingOfTenantComm(c);
      if(b!==filters.commBuilding) return false;
    }
    return true;
  }).sort((a,b)=> b.date<a.date?-1:1);

  const allFollowUps = [
    ...DATA.communications.map(c=>({...c, kind:'owner'})),
    ...DATA.tenantCommunications.map(c=>({...c, kind:'tenant'}))
  ].filter(c=>c.followUpDate && c.followUpDate>=todayISO())
   .sort((a,b)=>a.followUpDate<b.followUpDate?-1:1).slice(0,6);

  const rows = combined.map(c=>{
    const name = c.kind==='owner' ? (getOwner(c.ownerId)?.name||'—') : (getTenant(c.tenantId)?.name||'—');
    const location = c.kind==='owner'
      ? esc(c.buildingId? getBuilding(c.buildingId)?.name||'—' : '—')
      : esc(c.leaseId? unitLabel(getLease(c.leaseId)?.unitId) : '—');
    const editAction = c.kind==='owner' ? `openModal('communication','edit','${c.id}')` : `openModal('tenantComm','edit','${c.id}')`;
    const delAction = c.kind==='owner' ? `deleteCommunication` : `deleteTenantComm`;
    return `<tr>
      <td>${fmtDate(c.date)}</td>
      <td>${c.kind==='owner'?'<span class="tag tag-neutral">Owner</span>':'<span class="tag tag-neutral">Tenant</span>'}</td>
      <td>${esc(name)}</td>
      <td>${location}</td>
      <td>${commTypeTag(c.method)}</td>
      <td>${esc(c.subject||'—')}</td>
      <td>${c.followUpDate? fmtDate(c.followUpDate) : '—'}</td>
      <td class="row" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm admin-only" onclick="${editAction}">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this communication log entry?','${delAction}','${c.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <div><h1 class="page-title">Communications</h1><div class="page-sub">Log of calls, emails, and letters with owners and tenants</div></div>
    <div class="row">
      <button class="btn btn-ghost admin-only" onclick="openModal('communication','add')">+ Log Owner Contact</button>
      <button class="btn admin-only" onclick="openModal('tenantComm','add')">+ Log Tenant Contact</button>
    </div>
  </div>

  ${allFollowUps.length? `<div class="panel">
    <h3>Upcoming follow-ups</h3>
    <table><thead><tr><th>Follow-up date</th><th>Contact</th><th>Subject</th></tr></thead><tbody>
      ${allFollowUps.map(c=>`<tr><td>${fmtDate(c.followUpDate)}</td><td>${c.kind==='owner'?esc(getOwner(c.ownerId)?.name||'—'):esc(getTenant(c.tenantId)?.name||'—')}</td><td>${esc(c.subject||'—')}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}

  <div class="filter-bar">
    <select onchange="filters.commContactType=this.value;filters.commOwner='';filters.tcommTenant='';render();">
      <option value="" ${!filters.commContactType?'selected':''}>All contacts</option>
      <option value="owner" ${filters.commContactType==='owner'?'selected':''}>Owners only</option>
      <option value="tenant" ${filters.commContactType==='tenant'?'selected':''}>Tenants only</option>
    </select>
    ${filters.commContactType!=='tenant'? `<select onchange="filters.commOwner=this.value;render();"><option value="">All owners</option>${ownerOptions}</select>` : ''}
    ${filters.commContactType!=='owner'? `<select onchange="filters.tcommTenant=this.value;render();"><option value="">All tenants</option>${tenantOptions}</select>` : ''}
    <select onchange="filters.commBuilding=this.value;render();"><option value="">All buildings</option>${buildingOptions}</select>
  </div>
  <div class="panel">
    ${combined.length? `<table><thead><tr><th>Date</th><th>Type</th><th>Contact</th><th>Location</th><th>Method</th><th>Subject</th><th>Follow-up</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No communications logged yet.</div>`}
  </div>`;
}

/* =========================================================
   REPORTS
   ========================================================= */
function renderReports(){
  return `
  <div class="page-head">
    <div><h1 class="page-title">Reports</h1><div class="page-sub">Owner statements and arrears, on demand</div></div>
  </div>
  ${renderOwnerReport()}
  ${renderArrearsReport()}
  `;
}

function renderOwnerReport(){
  if(!isAdmin() && !ownerReportState.ownerId){ ownerReportState.ownerId = String(CURRENT_USER.ownerId||''); }
  const ownerOptions = DATA.owners.map(o=>`<option value="${o.id}" ${String(ownerReportState.ownerId)===String(o.id)?'selected':''}>${esc(o.name)}</option>`).join('');
  let content = '<div class="empty">Choose an owner and a date range.</div>';
  if(ownerReportState.ownerId && ownerReportState.start && ownerReportState.end){
    const owner = getOwner(ownerReportState.ownerId);
    const stakeBuildings = DATA.buildings.filter(b=>(b.owners||[]).some(o=>o.ownerId===owner.id));
    let grandNet = 0;
    const rowsHtml = stakeBuildings.map(b=>{
      const pct = b.owners.find(o=>o.ownerId===owner.id).pct;
      const unitIds = unitsForBuilding(b.id).map(u=>u.id);
      const leaseIds = DATA.leases.filter(l=>unitIds.includes(l.unitId)).map(l=>l.id);
      const rent = DATA.ledger.filter(e=>e.type==='payment' && e.category==='rent' && leaseIds.includes(e.leaseId) && isDateInRange(e.date, ownerReportState.start, ownerReportState.end)).reduce((s,e)=>s+Number(e.amount),0);
      const otherIncome = DATA.ledger.filter(e=>e.type==='payment' && e.category!=='rent' && leaseIds.includes(e.leaseId) && isDateInRange(e.date, ownerReportState.start, ownerReportState.end)).reduce((s,e)=>s+Number(e.amount),0);
      const maint = DATA.maintenance.filter(m=>m.buildingId===b.id && isDateInRange(m.dateCompleted||m.dateReported, ownerReportState.start, ownerReportState.end)).reduce((s,m)=>s+Number(m.cost||0),0);
      const gross = rent + otherIncome;
      const netOperating = gross - maint;
      const ownerGross = gross * pct/100;
      const ownerMaint = maint * pct/100;
      const ownerNetOperating = netOperating * pct/100;
      const fee = DATA.ownerLedger.filter(e=>e.ownerId===owner.id && e.buildingId===b.id && e.type==='charge' && isDateInRange(e.date, ownerReportState.start, ownerReportState.end)).reduce((s,e)=>s+Number(e.amount),0);
      const netToOwner = ownerNetOperating - fee;
      grandNet += netToOwner;
      return `<tr><td>${esc(b.name)}</td><td class="num">${pct}%</td><td class="num">${money(ownerGross)}</td><td class="num">${money(ownerMaint)}</td><td class="num">${money(fee)}</td><td class="num" style="font-weight:600;">${money(netToOwner)}</td></tr>`;
    }).join('');
    content = `
    <table><thead><tr><th>Building</th><th class="num">Stake</th><th class="num">Owner's Gross Income</th><th class="num">Owner's Maint. Share</th><th class="num">Mgmt Fee</th><th class="num">Net to Owner</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" class="empty">This owner has no building stakes.</td></tr>'}
    ${stakeBuildings.length? `<tr class="report-total-row"><td colspan="5">Total, ${esc(owner.name)}</td><td class="num">${money(grandNet)}</td></tr>` : ''}
    </tbody></table>`;
  }
  return `
  <div class="panel">
    <h3>Owner statement</h3>
    <div class="row" style="align-items:flex-end;margin-bottom:14px;">
      <div class="field" style="min-width:200px;"><label>Owner</label><select onchange="ownerReportState.ownerId=this.value;render();"><option value="">— choose —</option>${ownerOptions}</select></div>
      <div class="field" style="min-width:150px;"><label>Start</label><input type="date" value="${ownerReportState.start}" oninput="ownerReportState.start=this.value;"></div>
      <div class="field" style="min-width:150px;"><label>End</label><input type="date" value="${ownerReportState.end}" oninput="ownerReportState.end=this.value;"></div>
      <button class="btn btn-ghost" onclick="render()">Run</button>
      <button class="btn-ghost btn no-print" onclick="window.print()">Print</button>
    </div>
    ${content}
  </div>`;
}

function renderArrearsReport(){
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${arrearsReportState.building===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const asOf = arrearsReportState.asOf || todayISO();
  let leases = DATA.leases.filter(l=>l.status==='active');
  if(arrearsReportState.building){
    const unitIds = unitsForBuilding(arrearsReportState.building).map(u=>u.id);
    leases = leases.filter(l=>unitIds.includes(l.unitId));
  }
  const results = leases.map(l=>({l, aging: fifoAging(l.id, asOf)})).filter(x=>x.aging.balance>0.5)
    .sort((a,b)=>b.aging.balance-a.aging.balance);
  const buckets = {'0-30':0,'31-60':0,'61-90':0,'90+':0};
  results.forEach(x=>{ buckets[x.aging.bucket]+=x.aging.balance; });
  const rows = results.map(x=>`<tr>
    <td>${esc(getTenant(x.l.tenantId)?.name||'—')}</td>
    <td>${esc(unitLabel(x.l.unitId))}</td>
    <td>${esc(buildingOfUnit(x.l.unitId)?.name||'—')}</td>
    <td class="num balance-pos">${money(x.aging.balance)}</td>
    <td class="num">${x.aging.daysLate}</td>
    <td>${bucketTag(x.aging.bucket)}</td>
  </tr>`).join('');
  return `
  <div class="panel">
    <h3>Arrears report</h3>
    <div class="row" style="align-items:flex-end;margin-bottom:14px;">
      <div class="field" style="min-width:170px;"><label>As of</label><input type="date" value="${asOf}" oninput="arrearsReportState.asOf=this.value;"></div>
      <div class="field" style="min-width:200px;"><label>Building</label><select onchange="arrearsReportState.building=this.value;render();"><option value="">All buildings</option>${buildingOptions}</select></div>
      <button class="btn btn-ghost" onclick="render()">Run</button>
      <button class="btn-ghost btn no-print" onclick="window.print()">Print</button>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px;">
      <div class="kpi"><div class="kpi-label">0–30 days</div><div class="kpi-value">${money(buckets['0-30'])}</div></div>
      <div class="kpi"><div class="kpi-label">31–60 days</div><div class="kpi-value">${money(buckets['31-60'])}</div></div>
      <div class="kpi"><div class="kpi-label">61–90 days</div><div class="kpi-value">${money(buckets['61-90'])}</div></div>
      <div class="kpi"><div class="kpi-label">90+ days</div><div class="kpi-value bad">${money(buckets['90+'])}</div></div>
    </div>
    ${results.length? `<table><thead><tr><th>Tenant</th><th>Unit</th><th>Building</th><th class="num">Balance</th><th class="num">Days Late</th><th>Bucket</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No one is behind as of this date.</div>`}
  </div>`;
}
function bucketTag(b){
  const map = {'0-30':'tag-warn','31-60':'tag-warn','61-90':'tag-bad','90+':'tag-bad'};
  return `<span class="tag ${map[b]}">${b}</span>`;
}

/* =========================================================
   USERS (admin only) — accounts, roles, and which owner a
   login is scoped to
   ========================================================= */
async function loadUsers(){
  try{
    const data = await apiCall('getUsers', null, 'GET');
    USERS_LIST = (data.users||[]).map(pm_normalize_user_row);
  }catch(e){
    alertMsg('Could not load users: '+e.message);
  }
  render();
}
function renderUsers(){
  const rows = USERS_LIST.map(u=>`<tr>
    <td>${esc(u.username)}</td>
    <td>${u.role==='admin'?'<span class="tag tag-neutral">Staff</span>':'<span class="tag tag-neutral">Owner</span>'}</td>
    <td>${u.role==='owner'? esc(getOwner(u.ownerId)?.name||'—') : '—'}</td>
    <td>${esc(u.displayName||'—')}</td>
    <td>${esc(u.email||'—')}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="openModal('user','edit','${u.id}')">Edit</button>
      <button class="btn-danger btn btn-sm" onclick="askDelete('Delete the login for ${esc(u.username)}? They will no longer be able to sign in.','deleteUser','${u.id}')">Delete</button>
    </td>
  </tr>`).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Users</h1><div class="page-sub">Who can log in, and what they can see</div></div>
    <button class="btn" onclick="openModal('user','add')">+ Add User</button>
  </div>
  <div class="panel">
    ${USERS_LIST.length? `<table><thead><tr><th>Username</th><th>Role</th><th>Owner</th><th>Name</th><th>Email</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No users yet.</div>`}
  </div>`;
}
function userForm(){
  const ownerOpts = DATA.owners.map(o=>`<option value="${o.id}" ${String(draft.ownerId)===String(o.id)?'selected':''}>${esc(o.name)}</option>`).join('');
  return `
  <div class="field"><label>Username</label><input value="${esc(draft.username)}" oninput="updateDraft('username',this.value)"></div>
  <div class="field"><label>Role</label>
    <select onchange="updateDraft('role',this.value);reRenderModalBody()">
      <option value="admin" ${draft.role==='admin'?'selected':''}>Staff (full access)</option>
      <option value="owner" ${draft.role==='owner'?'selected':''}>Owner (locked to their building)</option>
    </select>
  </div>
  ${draft.role==='owner'? `<div class="field"><label>Linked owner record</label><select onchange="updateDraft('ownerId',this.value)"><option value="">— select —</option>${ownerOpts}</select></div>` : ''}
  <div class="field"><label>Display name</label><input value="${esc(draft.displayName)}" oninput="updateDraft('displayName',this.value)"></div>
  <div class="field"><label>Email</label><input value="${esc(draft.email)}" oninput="updateDraft('email',this.value)"></div>
  <div class="field"><label>${draft.id?'New password (leave blank to keep current)':'Password'}</label><input type="password" oninput="updateDraft('password',this.value)"></div>`;
}
function changePasswordForm(){
  return `
  <div class="field"><label>Current password</label><input type="password" oninput="updateDraft('current',this.value)"></div>
  <div class="field"><label>New password</label><input type="password" oninput="updateDraft('new',this.value)"></div>
  <div class="field"><label>Confirm new password</label><input type="password" oninput="updateDraft('confirm',this.value)"></div>`;
}

/* =========================================================
   MODAL SYSTEM
   ========================================================= */
function openModal(type, mode, id, extra){
  modal = {type, mode, id};
  switch(type){
    case 'building':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getBuilding(id))) : {id:null, name:'', address:'', feeType:'percent', feeValue:8, owners:[]};
      break;
    case 'unit':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getUnit(id))) : {id:null, buildingId: extra||'', number:'', beds:1, baths:1, sqft:'', notes:''};
      break;
    case 'owner':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getOwner(id))) : {id:null, name:'', email:'', phone:''};
      break;
    case 'tenant':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getTenant(id))) : {id:null, name:'', email:'', phone:''};
      break;
    case 'lease':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getLease(id))) : {id:null, unitId:'', tenantId:'', startDate: todayISO(), endDate:'', rentAmount:0, depositAmount:0, billingDay:1, status:'active'};
      break;
    case 'maintenance':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.maintenance.find(m=>m.id===id))) : {id:null, buildingId:'', unitId:'', title:'', description:'', priority:'medium', status:'open', dateReported: todayISO(), dateCompleted:'', cost:0, notes:''};
      break;
    case 'ledgerCharge':
      draft = {id:null, leaseId: extra, date: todayISO(), type:'charge', category:'rent', amount:0, memo:''};
      break;
    case 'ledgerPayment':
      draft = {id:null, leaseId: extra, date: todayISO(), type:'payment', category:'rent', amount:0, memo:''};
      break;
    case 'ownerLedger':
      draft = {id:null, ownerId:'', buildingId:'', date: todayISO(), type:'charge', amount:0, memo:''};
      break;
    case 'communication':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.communications.find(c=>c.id===id))) : {id:null, ownerId: extra||'', buildingId:'', date: todayISO(), method:'call', subject:'', notes:'', followUpDate:''};
      break;
    case 'tenantComm':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.tenantCommunications.find(c=>c.id===id))) : {id:null, tenantId: extra||'', leaseId:'', date: todayISO(), method:'call', subject:'', notes:'', followUpDate:''};
      break;
    case 'user':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(USERS_LIST.find(u=>u.id===id))) : {id:null, username:'', role:'owner', ownerId:'', displayName:'', email:'', password:''};
      if(mode==='edit') draft.password = '';
      break;
    case 'changePassword':
      draft = {current:'', new:'', confirm:''};
      break;
  }
  render();
}
function closeModal(){ modal=null; draft=null; render(); }
function updateDraft(field, value){ draft[field]=value; }
function updateDraftNum(field, value){ draft[field]=Number(value); }

function addOwnerRow(){
  draft.owners = draft.owners || [];
  draft.owners.push({ownerId:'', pct:0});
  render();
}
function removeOwnerRow(idx){ draft.owners.splice(idx,1); render(); }
function updateOwnerRow(idx, field, value){ draft.owners[idx][field] = field==='pct'? Number(value) : value; }

async function saveModal(){
  const t = modal.type;
  if(t==='changePassword'){
    if(draft.new !== draft.confirm){ alertMsg('New password and confirmation don\'t match.'); return; }
    try{
      const result = await apiCall('changePassword', {current: draft.current, new: draft.new});
      if(result.ok){ closeModal(); alertMsg(result.message||'Password updated.'); }
      else { alertMsg(result.message || 'Could not change password.'); }
    }catch(e){ alertMsg('Could not change password: '+e.message); }
    return;
  }
  if(t==='user'){
    try{
      const result = await apiCall('saveUser', draft);
      if(result.ok){ closeModal(); await loadUsers(); }
      else { alertMsg(result.message || 'Could not save user.'); }
    }catch(e){ alertMsg('Could not save user: '+e.message); }
    return;
  }
  const leaseToReturnTo = (t==='ledgerCharge'||t==='ledgerPayment') ? draft.leaseId : null;
  try{
    await apiSave(t, draft);
    closeModal();
    await refreshData();
    if(leaseToReturnTo){ ledgerSelectedLease = leaseToReturnTo; render(); }
  }catch(e){
    alertMsg('Could not save: '+e.message);
  }
}

function renderModal(){
  if(!modal) return '';
  let title='', sub='', body='';
  switch(modal.type){
    case 'building': title = modal.mode==='add'?'Add Building':'Edit Building'; body = buildingForm(); break;
    case 'unit': title = modal.mode==='add'?'Add Unit':'Edit Unit'; body = unitForm(); break;
    case 'owner': title = modal.mode==='add'?'Add Owner':'Edit Owner'; body = ownerForm(); break;
    case 'tenant': title = modal.mode==='add'?'Add Tenant':'Edit Tenant'; body = tenantForm(); break;
    case 'lease': title = modal.mode==='add'?'Add Lease':'Edit Lease'; body = leaseForm(); break;
    case 'maintenance': title = modal.mode==='add'?'Add Maintenance Request':'Edit Maintenance Request'; body = maintenanceForm(); break;
    case 'ledgerCharge': title = 'Add Charge'; body = ledgerEntryForm(); break;
    case 'ledgerPayment': title = 'Record Payment'; body = ledgerEntryForm(); break;
    case 'ownerLedger': title = 'Owner Billing Entry'; body = ownerLedgerForm(); break;
    case 'communication': title = modal.mode==='add'?'Log Communication':'Edit Communication'; body = communicationForm(); break;
    case 'tenantComm': title = modal.mode==='add'?'Log Communication':'Edit Communication'; body = tenantCommForm(); break;
    case 'user': title = modal.mode==='add'?'Add User':'Edit User'; body = userForm(); break;
    case 'changePassword': title = 'Change Password'; body = changePasswordForm(); break;
  }
  return `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-box">
      <span class="close-x" onclick="closeModal()">&times;</span>
      <h3>${title}</h3>
      ${body}
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn" onclick="saveModal()">Save</button>
      </div>
    </div>
  </div>`;
}

function buildingForm(){
  const owners = draft.owners||[];
  const ownerOpts = (selected)=>DATA.owners.map(o=>`<option value="${o.id}" ${selected===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  return `
  <div class="field"><label>Building name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)" placeholder="e.g. 14 Elm Street"></div>
  <div class="field"><label>Address</label><input value="${esc(draft.address)}" oninput="updateDraft('address',this.value)" placeholder="Street, City, State"></div>
  <div class="field-row">
    <div class="field"><label>Management fee type</label>
      <select onchange="updateDraft('feeType',this.value)">
        <option value="percent" ${draft.feeType==='percent'?'selected':''}>% of collected rent</option>
        <option value="flat" ${draft.feeType==='flat'?'selected':''}>Flat $ per unit / month</option>
      </select>
    </div>
    <div class="field"><label>Fee value</label><input type="number" step="0.01" value="${draft.feeValue}" oninput="updateDraftNum('feeValue',this.value)"></div>
  </div>
  <div class="field">
    <label>Owners &amp; ownership %</label>
    <div id="ownerRows">
      ${owners.map((o,i)=>`<div class="owner-row">
        <select onchange="updateOwnerRow(${i},'ownerId',this.value)">
          <option value="">— select owner —</option>${ownerOpts(o.ownerId)}
        </select>
        <input type="number" step="0.1" value="${o.pct}" placeholder="%" oninput="updateOwnerRow(${i},'pct',this.value)">
        <span class="close-x" style="position:static;font-size:16px;" onclick="removeOwnerRow(${i})">&times;</span>
      </div>`).join('')}
    </div>
    <span class="mini-link" onclick="addOwnerRow()">+ add owner</span>
    ${DATA.owners.length===0? '<div class="subtle" style="margin-top:6px;">No owners in the system yet — add one from the Owners tab first.</div>' : ''}
  </div>`;
}

function unitForm(){
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  return `
  <div class="field"><label>Building</label><select onchange="updateDraft('buildingId',this.value)"><option value="">— select —</option>${bOpts}</select></div>
  <div class="field"><label>Unit number / label</label><input value="${esc(draft.number)}" oninput="updateDraft('number',this.value)" placeholder="e.g. 2B"></div>
  <div class="field-row">
    <div class="field"><label>Beds</label><input type="number" value="${draft.beds}" oninput="updateDraftNum('beds',this.value)"></div>
    <div class="field"><label>Baths</label><input type="number" step="0.5" value="${draft.baths}" oninput="updateDraftNum('baths',this.value)"></div>
    <div class="field"><label>Sqft</label><input type="number" value="${draft.sqft}" oninput="updateDraftNum('sqft',this.value)"></div>
  </div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function ownerForm(){
  return `
  <div class="field"><label>Name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)"></div>
  <div class="field"><label>Email</label><input value="${esc(draft.email)}" oninput="updateDraft('email',this.value)"></div>
  <div class="field"><label>Phone</label><input value="${esc(draft.phone)}" oninput="updateDraft('phone',this.value)"></div>`;
}
function tenantForm(){
  return `
  <div class="field"><label>Name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)"></div>
  <div class="field"><label>Email</label><input value="${esc(draft.email)}" oninput="updateDraft('email',this.value)"></div>
  <div class="field"><label>Phone</label><input value="${esc(draft.phone)}" oninput="updateDraft('phone',this.value)"></div>`;
}

function leaseForm(){
  const unitOpts = DATA.units.map(u=>`<option value="${u.id}" ${draft.unitId===u.id?'selected':''}>${esc(unitLabel(u.id))}</option>`).join('');
  const tenantOpts = DATA.tenants.map(t=>`<option value="${t.id}" ${draft.tenantId===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Unit</label><select onchange="updateDraft('unitId',this.value)"><option value="">— select —</option>${unitOpts}</select></div>
    <div class="field"><label>Tenant</label><select onchange="updateDraft('tenantId',this.value)"><option value="">— select —</option>${tenantOpts}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Start date</label><input type="date" value="${draft.startDate}" oninput="updateDraft('startDate',this.value)"></div>
    <div class="field"><label>End date</label><input type="date" value="${draft.endDate||''}" oninput="updateDraft('endDate',this.value)"></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Monthly rent</label><input type="number" step="0.01" value="${draft.rentAmount}" oninput="updateDraftNum('rentAmount',this.value)"></div>
    <div class="field"><label>Deposit held</label><input type="number" step="0.01" value="${draft.depositAmount}" oninput="updateDraftNum('depositAmount',this.value)"></div>
    <div class="field"><label>Rent due day</label><input type="number" min="1" max="28" value="${draft.billingDay}" oninput="updateDraftNum('billingDay',this.value)"></div>
  </div>
  <div class="field"><label>Status</label>
    <select onchange="updateDraft('status',this.value)">
      <option value="active" ${draft.status==='active'?'selected':''}>Active</option>
      <option value="ended" ${draft.status==='ended'?'selected':''}>Ended</option>
    </select>
  </div>`;
}

function maintenanceForm(){
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const units = draft.buildingId ? unitsForBuilding(draft.buildingId) : [];
  const uOpts = units.map(u=>`<option value="${u.id}" ${draft.unitId===u.id?'selected':''}>${esc(u.number)}</option>`).join('');
  return `
  <div class="field"><label>Title</label><input value="${esc(draft.title)}" oninput="updateDraft('title',this.value)" placeholder="e.g. Leaking faucet"></div>
  <div class="field-row">
    <div class="field"><label>Building</label><select onchange="updateDraft('buildingId',this.value);updateDraft('unitId','');reRenderModalBody()"><option value="">— select —</option>${bOpts}</select></div>
    <div class="field"><label>Unit (optional)</label><select onchange="updateDraft('unitId',this.value)"><option value="">— whole building —</option>${uOpts}</select></div>
  </div>
  <div class="field"><label>Description</label><textarea oninput="updateDraft('description',this.value)">${esc(draft.description||'')}</textarea></div>
  <div class="field-row">
    <div class="field"><label>Priority</label>
      <select onchange="updateDraft('priority',this.value)">
        ${['low','medium','high','urgent'].map(p=>`<option value="${p}" ${draft.priority===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Status</label>
      <select onchange="updateDraft('status',this.value)">
        <option value="open" ${draft.status==='open'?'selected':''}>Open</option>
        <option value="in_progress" ${draft.status==='in_progress'?'selected':''}>In progress</option>
        <option value="completed" ${draft.status==='completed'?'selected':''}>Completed</option>
      </select>
    </div>
  </div>
  <div class="field-row">
    <div class="field"><label>Date reported</label><input type="date" value="${draft.dateReported}" oninput="updateDraft('dateReported',this.value)"></div>
    <div class="field"><label>Date completed</label><input type="date" value="${draft.dateCompleted||''}" oninput="updateDraft('dateCompleted',this.value)"></div>
    <div class="field"><label>Cost</label><input type="number" step="0.01" value="${draft.cost}" oninput="updateDraftNum('cost',this.value)"></div>
  </div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}
function reRenderModalBody(){ render(); }

function ledgerEntryForm(){
  const lease = getLease(draft.leaseId);
  const isCharge = draft.type==='charge';
  return `
  <div class="modal-sub">${esc(getTenant(lease?.tenantId)?.name||'')} — ${esc(unitLabel(lease?.unitId))}</div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" value="${draft.amount}" oninput="updateDraftNum('amount',this.value)"></div>
  </div>
  <div class="field"><label>Category</label>
    <select onchange="updateDraft('category',this.value)">
      ${(isCharge? ['rent','late_fee','utility','other'] : ['rent','deposit','other']).map(c=>`<option value="${c}" ${draft.category===c?'selected':''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="field"><label>Memo</label><input value="${esc(draft.memo)}" oninput="updateDraft('memo',this.value)" placeholder="Optional note"></div>`;
}

function ownerLedgerForm(){
  const oOpts = DATA.owners.map(o=>`<option value="${o.id}" ${draft.ownerId===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Owner</label><select onchange="updateDraft('ownerId',this.value)"><option value="">— select —</option>${oOpts}</select></div>
    <div class="field"><label>Building</label><select onchange="updateDraft('buildingId',this.value)"><option value="">— select —</option>${bOpts}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" value="${draft.amount}" oninput="updateDraftNum('amount',this.value)"></div>
  </div>
  <div class="field"><label>Type</label>
    <select onchange="updateDraft('type',this.value)">
      <option value="charge" ${draft.type==='charge'?'selected':''}>Fee charged to owner</option>
      <option value="payment" ${draft.type==='payment'?'selected':''}>Payment received from owner</option>
    </select>
  </div>
  <div class="field"><label>Memo</label><input value="${esc(draft.memo)}" oninput="updateDraft('memo',this.value)"></div>`;
}

function communicationForm(){
  const oOpts = DATA.owners.map(o=>`<option value="${o.id}" ${draft.ownerId===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Owner</label><select onchange="updateDraft('ownerId',this.value)"><option value="">— select —</option>${oOpts}</select></div>
    <div class="field"><label>Building (optional)</label><select onchange="updateDraft('buildingId',this.value)"><option value="">— none —</option>${bOpts}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Method</label>
      <select onchange="updateDraft('method',this.value)">
        ${['call','email','text','in_person','letter'].map(m=>`<option value="${m}" ${draft.method===m?'selected':''}>${{call:'Call',email:'Email',text:'Text',in_person:'In person',letter:'Letter'}[m]}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="field"><label>Subject</label><input value="${esc(draft.subject)}" oninput="updateDraft('subject',this.value)" placeholder="e.g. Q3 maintenance costs"></div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)" placeholder="What was discussed / decided">${esc(draft.notes||'')}</textarea></div>
  <div class="field"><label>Follow-up date (optional)</label><input type="date" value="${draft.followUpDate||''}" oninput="updateDraft('followUpDate',this.value)"></div>`;
}

function tenantCommForm(){
  const tOpts = DATA.tenants.map(t=>`<option value="${t.id}" ${draft.tenantId===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  const tenantLeases = draft.tenantId ? DATA.leases.filter(l=>l.tenantId===draft.tenantId) : [];
  const lOpts = tenantLeases.map(l=>`<option value="${l.id}" ${draft.leaseId===l.id?'selected':''}>${esc(unitLabel(l.unitId))}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Tenant</label><select onchange="updateDraft('tenantId',this.value);updateDraft('leaseId','');reRenderModalBody()"><option value="">— select —</option>${tOpts}</select></div>
    <div class="field"><label>Unit / lease (optional)</label><select onchange="updateDraft('leaseId',this.value)"><option value="">— none —</option>${lOpts}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Method</label>
      <select onchange="updateDraft('method',this.value)">
        ${['call','email','text','in_person','letter'].map(m=>`<option value="${m}" ${draft.method===m?'selected':''}>${{call:'Call',email:'Email',text:'Text',in_person:'In person',letter:'Letter'}[m]}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="field"><label>Subject</label><input value="${esc(draft.subject)}" oninput="updateDraft('subject',this.value)" placeholder="e.g. Late rent reminder"></div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)" placeholder="What was discussed / decided">${esc(draft.notes||'')}</textarea></div>
  <div class="field"><label>Follow-up date (optional)</label><input type="date" value="${draft.followUpDate||''}" oninput="updateDraft('followUpDate',this.value)"></div>`;
}

/* =========================================================
   CONFIRM / DELETE
   ========================================================= */
function askDelete(message, action, id){
  confirmState = {message, action, id};
  render();
}
function renderConfirm(){
  if(!confirmState) return '';
  if(confirmState.onlyOk){
    return `<div class="modal-overlay"><div class="modal-box" style="max-width:420px;">
      <p style="margin-top:6px;">${esc(confirmState.message)}</p>
      <div class="modal-actions"><button class="btn" onclick="confirmState=null;render();">OK</button></div>
    </div></div>`;
  }
  return `<div class="modal-overlay"><div class="modal-box" style="max-width:420px;">
    <h3>Confirm</h3>
    <p style="color:var(--ink-soft);font-size:13.5px;">${esc(confirmState.message)}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="confirmState=null;render();">Cancel</button>
      <button class="btn-danger btn" onclick="runConfirmedAction()">Delete</button>
    </div>
  </div></div>`;
}
// Maps the legacy per-row action names (kept in the onclick attributes above)
// to the entity name api.php expects for a delete call.
const DELETE_ENTITY_MAP = {
  deleteBuilding:'building', deleteUnit:'unit', deleteOwner:'owner', deleteTenant:'tenant',
  deleteLease:'lease', deleteLedgerEntry:'ledgerEntry', deleteMaintenance:'maintenance',
  deleteOwnerLedgerEntry:'ownerLedger', deleteCommunication:'communication', deleteTenantComm:'tenantComm'
};
async function runConfirmedAction(){
  const {action, id} = confirmState;
  confirmState = null;
  try{
    if(action==='deleteUser'){
      await apiCall('deleteUser', {id});
      await loadUsers();
    } else {
      const entity = DELETE_ENTITY_MAP[action];
      await apiDelete(entity, id);
      await refreshData();
    }
  }catch(e){
    alertMsg('Could not delete: '+e.message);
  }
}

/* =========================================================
   INIT
   ========================================================= */
loadData();

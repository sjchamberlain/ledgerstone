
/* =========================================================
   DATA LAYER — talks to api.php, which enforces every permission
   server-side. Hiding buttons here is UX only, never the security
   boundary: pm_require_admin() in api.php is what actually blocks writes.
   ========================================================= */
let DATA = {
  buildings: [], units: [], owners: [], tenants: [], vendors: [], leases: [],
  ledger: [], maintenance: [], trustTransactions: [], securityDeposits: [], securityDepositTransactions: [],
  ownerStatements: [], ownerTransfers: [], communications: [], tenantCommunications: [],
  appliances: [], rooms: [], roomOpenings: [], timeEntries: [], stampLog: []
};
let CURRENT_USER = window.PM_USER || {role:'owner'};
let CSRF_TOKEN = window.PM_CSRF || '';
let USERS_LIST = []; // populated on demand for the Users admin tab
let APP_VERSION = null;        // version seen on the first load this session
let NEW_VERSION_AVAILABLE = false; // true once a poll sees a different version deployed

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
    if(currentTab==='reports' && !isAdmin() && !statementGenState.ownerId){
      statementGenState.ownerId = String(CURRENT_USER.ownerId||'');
    }
    if(CURRENT_USER.mustChangePassword){
      forcedPasswordChange = true;
      openModal('changePassword','edit');
    }
    pm_note_version(data.appVersion);
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
  (data.vendors||[]).forEach(v=>{ v.id=s(v.id); });
  (data.leases||[]).forEach(l=>{ l.id=s(l.id); l.unitId=s(l.unitId); l.tenantId=s(l.tenantId); });
  (data.ledger||[]).forEach(e=>{ e.id=s(e.id); e.leaseId=s(e.leaseId); e.chargeId=s(e.chargeId); });
  (data.maintenance||[]).forEach(m=>{ m.id=s(m.id); m.buildingId=s(m.buildingId); m.unitId=s(m.unitId); m.vendorId=s(m.vendorId); m.approvedBy=s(m.approvedBy); });
  (data.trustTransactions||[]).forEach(e=>{ e.id=s(e.id); e.ownerId=s(e.ownerId); e.buildingId=s(e.buildingId); });
  (data.securityDeposits||[]).forEach(d=>{ d.id=s(d.id); d.leaseId=s(d.leaseId); d.unitId=s(d.unitId); d.tenantId=s(d.tenantId); d.buildingId=s(d.buildingId); });
  (data.securityDepositTransactions||[]).forEach(t=>{ t.id=s(t.id); t.securityDepositId=s(t.securityDepositId); });
  (data.ownerStatements||[]).forEach(st=>{ st.id=s(st.id); st.ownerId=s(st.ownerId); st.buildingId=s(st.buildingId); });
  (data.ownerTransfers||[]).forEach(tr=>{ tr.id=s(tr.id); tr.buildingId=s(tr.buildingId); tr.fromOwnerId=s(tr.fromOwnerId); tr.toOwnerId=s(tr.toOwnerId); });
  (data.communications||[]).forEach(c=>{ c.id=s(c.id); c.ownerId=s(c.ownerId); c.buildingId=s(c.buildingId); });
  (data.tenantCommunications||[]).forEach(c=>{ c.id=s(c.id); c.tenantId=s(c.tenantId); c.leaseId=s(c.leaseId); });
  (data.appliances||[]).forEach(a=>{ a.id=s(a.id); a.unitId=s(a.unitId); });
  (data.rooms||[]).forEach(r=>{ r.id=s(r.id); r.unitId=s(r.unitId); });
  (data.roomOpenings||[]).forEach(o=>{ o.id=s(o.id); o.roomId=s(o.roomId); });
  (data.timeEntries||[]).forEach(t=>{ t.id=s(t.id); t.buildingId=s(t.buildingId); t.unitId=s(t.unitId); t.userId=s(t.userId); });
  (data.stampLog||[]).forEach(l=>{ l.id=s(l.id); l.buildingId=s(l.buildingId); l.ownerId=s(l.ownerId); });
  if(data.currentUser) data.currentUser.ownerId = s(data.currentUser.ownerId);
}
function pm_normalize_user_row(u){
  const s = v => (v===null || v===undefined || v==='') ? '' : String(v);
  u.id = s(u.id); u.ownerId = s(u.ownerId);
  return u;
}
async function refreshData(){ await loadData(); }

function pm_note_version(serverVersion){
  if(!serverVersion) return;
  if(APP_VERSION === null){ APP_VERSION = serverVersion; return; }
  if(serverVersion !== APP_VERSION && !NEW_VERSION_AVAILABLE){
    NEW_VERSION_AVAILABLE = true;
    render();
  }
}

async function pm_poll_version(){
  try{
    const r = await apiCall('version', null, 'GET');
    pm_note_version(r.version);
  }catch(e){ /* offline or logged out — ignore, next poll will retry */ }
}
setInterval(pm_poll_version, 5 * 60 * 1000);

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
function getVendor(id){ return DATA.vendors.find(v=>v.id===id); }
function getLease(id){ return DATA.leases.find(l=>l.id===id); }
function getMaintenance(id){ return DATA.maintenance.find(m=>m.id===id); }
function depositForLease(leaseId){ return DATA.securityDeposits.find(d=>d.leaseId===leaseId); }
function trustBalance(ownerId, buildingId){
  const rows = DATA.trustTransactions.filter(e=>e.ownerId===ownerId && e.buildingId===buildingId);
  if(!rows.length) return 0;
  return rows[rows.length-1].runningBalance; // fetched pre-sorted by date,id
}
function ownerPctOfBuilding(ownerId, buildingId){
  const b = getBuilding(buildingId);
  const o = (b?.owners||[]).find(x=>x.ownerId===ownerId);
  return o ? Number(o.pct) : 0;
}

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

// Lets a non-native clickable element (e.g. a role="tab" div) respond to
// Enter/Space like a real button, for keyboard and screen-reader users.
function onActivateKey(event, fn){
  if(event.key==='Enter' || event.key===' '){
    event.preventDefault();
    fn();
  }
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
let forcedPasswordChange = false; // true = must-change-password modal, can't be dismissed
let modal = null;   // {type:'building'|'unit'|..., mode:'add'|'edit'}
let draft = null;   // working copy of entity being edited in modal
let confirmState = null; // {message, onYes: fn}
let ledgerSelectedLease = null;
let filters = { maintBuilding:'', ownerBillBuilding:'', commOwner:'', commBuilding:'', tcommTenant:'', tcommBuilding:'', commContactType:'' };
let viewingOwnerId = null;
let viewingTenantId = null;
let viewingUnitId = null;
let arrearsReportState = { asOf: todayISO(), building:'' };
let statementGenState = { ownerId:'', buildingId:'', month: new Date().toISOString().slice(0,7), stampRate:'' };
let viewingStatementId = null;
let timecardFilters = { building:'', activity:'' };
let timecardReportState = { building:'', start:'', end:'' };

const NAV_TREE = [
  {id:'dashboard', label:'Dashboard'},
  {id:'properties-group', label:'Properties', children:[
    {id:'properties', label:'Units'},
    {id:'leases', label:'Leases'},
    {id:'maintenance', label:'Maintenance'},
  ]},
  {id:'people-group', label:'People', children:[
    {id:'owners', label:'Owners'},
    {id:'tenants', label:'Tenants'},
    {id:'vendors', label:'Vendors'},
  ]},
  {id:'ledger', label:'Ledger'},
  {id:'trust', label:'Trust & Deposits'},
  {id:'communications', label:'Communications'},
  {id:'printables', label:'Printables', adminOnly:true},
  {id:'management-group', label:'Management', children:[
    {id:'reports', label:'Reports'},
    {id:'timecards', label:'Timecards', adminOnly:true},
    {id:'users', label:'Users', adminOnly:true},
  ]},
];
function currentNav(){
  const admin = isAdmin();
  return NAV_TREE
    .filter(n => admin || !n.adminOnly)
    .map(n => n.children ? {...n, children: n.children.filter(c => admin || !c.adminOnly)} : n)
    .filter(n => !n.children || n.children.length > 0);
}

let navExpanded = {}; // group id -> true once the user expands it; absent/false = collapsed by default
function toggleNavGroup(gid){ navExpanded[gid] = !navExpanded[gid]; render(); }

function setTab(t){
  currentTab=t;
  if(t==='users' && isAdmin()){ loadUsers(); } else { render(); }
}

/* =========================================================
   RENDER SHELL
   ========================================================= */
function render(){
  const app = document.getElementById('app');
  app.classList.toggle('has-reload-bar', NEW_VERSION_AVAILABLE);
  app.innerHTML = renderReloadBar() + renderSidebar() + '<div class="main">' + renderTab() + '</div>' + renderModal() + renderConfirm();
}

function renderReloadBar(){
  if(!NEW_VERSION_AVAILABLE) return '';
  return `<div class="reload-bar">
    <span>A new version of Ledgerstone has been deployed.</span>
    <button class="btn btn-sm" onclick="location.reload()">Reload now</button>
  </div>`;
}

function renderSidebar(){
  const nav = currentNav();
  let items = nav.map((n,i)=>{
    const num = `<span class="nav-num">${String(i+1).padStart(2,'0')}</span>`;
    if(n.children){
      const hasActiveChild = n.children.some(c=>c.id===currentTab);
      const expanded = hasActiveChild || !!navExpanded[n.id];
      const kids = n.children.map(c=>`
        <div class="nav-item nav-item-child ${currentTab===c.id?'active':''}" role="tab" tabindex="0" aria-selected="${currentTab===c.id}" onclick="setTab('${c.id}')" onkeydown="onActivateKey(event,()=>setTab('${c.id}'))">
          <span>${c.label}</span>
        </div>`).join('');
      return `<div class="nav-group">
        <div class="nav-item nav-group-head" role="button" tabindex="0" aria-expanded="${expanded}" onclick="toggleNavGroup('${n.id}')" onkeydown="onActivateKey(event,()=>toggleNavGroup('${n.id}'))">
          ${num}<span>${n.label}</span><span class="nav-caret ${expanded?'open':''}">&rsaquo;</span>
        </div>
        <div class="nav-children" ${expanded?'':'style="display:none;"'}>${kids}</div>
      </div>`;
    }
    return `<div class="nav-item ${currentTab===n.id?'active':''}" role="tab" tabindex="0" aria-selected="${currentTab===n.id}" onclick="setTab('${n.id}')" onkeydown="onActivateKey(event,()=>setTab('${n.id}'))">
      ${num}<span>${n.label}</span>
    </div>`;
  }).join('');
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
    case 'vendors': return renderVendors();
    case 'leases': return renderLeases();
    case 'ledger': return renderLedger();
    case 'maintenance': return renderMaintenance();
    case 'trust': return renderTrust();
    case 'communications': return renderCommunications();
    case 'printables': return isAdmin() ? renderPrintables() : renderDashboard();
    case 'reports': return renderReports();
    case 'timecards': return isAdmin() ? renderTimecards() : renderDashboard();
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
function applianceAge(installDate){
  if(!installDate) return null;
  const years = daysBetween(todayISO(), installDate)/365.25;
  return Math.max(0, Math.floor(years));
}
function renderProperties(){
  if(viewingUnitId) return renderUnitDetail(viewingUnitId);
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
          <button class="btn btn-ghost btn-sm admin-only" onclick="openOwnerTransferModal('${b.id}')">Transfer Ownership</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('building','edit','${b.id}')">Edit</button>
          <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete ${esc(b.name)} and all its units? Leases and ledger tied to those units will remain but become unlinked from a building.','deleteBuilding','${b.id}')">Delete</button>
        </div>
      </div>
      ${(b.roofLastServiced||b.electricalLoad||b.exteriorPaintColor||b.profileNotes)? `<div class="subtle" style="padding:0 16px 10px;">
        ${b.roofLastServiced? `Roof last serviced: ${fmtDate(b.roofLastServiced)}` : ''}
        ${b.electricalLoad? ` &nbsp;·&nbsp; Electrical: ${esc(b.electricalLoad)}` : ''}
        ${b.exteriorPaintColor? ` &nbsp;·&nbsp; Exterior paint: ${esc(b.exteriorPaintColor)}` : ''}
      </div>` : ''}
      <div class="unit-table-wrap">
        ${units.length? `<table><thead><tr><th>Unit</th><th>Beds</th><th>Baths</th><th>Sqft</th><th>Status</th><th>Tenant</th><th></th></tr></thead><tbody>
          ${units.map(u=>{
            const lease = activeLeaseForUnit(u.id);
            const tenant = lease? getTenant(lease.tenantId) : null;
            return `<tr>
              <td><span class="mini-link" onclick="viewingUnitId='${u.id}';render();">${esc(u.number)}</span></td><td>${esc(u.beds)}</td><td>${esc(u.baths)}</td><td>${esc(u.sqft||'—')}</td>
              <td>${lease? statusTag('active') : '<span class="tag tag-neutral">Vacant</span>'}</td>
              <td>${tenant? esc(tenant.name) : '—'}</td>
              <td class="row" style="justify-content:flex-end;">
                <button class="btn btn-ghost btn-sm" onclick="viewingUnitId='${u.id}';render();">Profile</button>
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
    <div><h1 class="page-title">Properties</h1><div class="page-sub">Your portfolio, unit by unit</div></div>
    <button class="btn admin-only" onclick="openModal('building','add')">+ Add Building</button>
  </div>
  ${blocks || '<div class="panel"><div class="empty">No buildings yet. Add your first one to get started.</div></div>'}
  `;
}

let ownerTransferDraft = null;
function openOwnerTransferModal(buildingId){
  ownerTransferDraft = {buildingId, fromOwnerId:'', toOwnerId:'', transferDate: todayISO(), notes:''};
  modal = {type:'ownerTransfer', mode:'add'};
  render();
}
async function saveOwnerTransfer(){
  if(!ownerTransferDraft.fromOwnerId || !ownerTransferDraft.toOwnerId){ alertMsg('Choose the outgoing and incoming owner.'); return; }
  try{
    const result = await apiCall('transferOwner', ownerTransferDraft);
    if(result.ok){ modal=null; ownerTransferDraft=null; await refreshData(); }
    alertMsg(result.message || 'Done.');
  }catch(e){ alertMsg('Could not transfer: '+e.message); }
}
function ownerTransferForm(){
  const b = getBuilding(ownerTransferDraft.buildingId);
  const currentOwnerOpts = (b.owners||[]).map(o=>{
    const own = getOwner(o.ownerId);
    return `<option value="${o.ownerId}" ${ownerTransferDraft.fromOwnerId===o.ownerId?'selected':''}>${esc(own?own.name:'?')} (${o.pct}%)</option>`;
  }).join('');
  const toOwnerOpts = DATA.owners.filter(o=>o.id!==ownerTransferDraft.fromOwnerId).map(o=>`<option value="${o.id}" ${ownerTransferDraft.toOwnerId===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const fromBalance = ownerTransferDraft.fromOwnerId ? trustBalance(ownerTransferDraft.fromOwnerId, ownerTransferDraft.buildingId) : null;
  const depositTotal = DATA.securityDeposits.filter(d=>d.buildingId===ownerTransferDraft.buildingId && d.status!=='refunded').reduce((s,d)=>s+Number(d.amountHeld),0);
  return `
  <div class="modal-sub">${esc(b.name)}</div>
  <div class="field"><label>Outgoing owner</label><select onchange="ownerTransferDraft.fromOwnerId=this.value">${ownerTransferDraft.fromOwnerId?'':'<option value="">— select —</option>'}${currentOwnerOpts}</select></div>
  <div class="field"><label>Incoming owner</label><select onchange="ownerTransferDraft.toOwnerId=this.value"><option value="">— select —</option>${toOwnerOpts}</select></div>
  <div class="field"><label>Transfer date</label><input type="date" value="${ownerTransferDraft.transferDate}" oninput="ownerTransferDraft.transferDate=this.value"></div>
  <div class="field"><label>Notes</label><textarea oninput="ownerTransferDraft.notes=this.value">${esc(ownerTransferDraft.notes||'')}</textarea></div>
  ${fromBalance!==null? `<div class="subtle">Trust balance to transfer: ${money(fromBalance)}. Security deposits on record for this building (${money(depositTotal)}) automatically stay with the building — the incoming owner assumes responsibility for them without a separate step, and this transfer records both amounts for the audit trail.</div>` : ''}`;
}

/* =========================================================
   UNIT PROFILE (wall/faceplate color, appliances)
   ========================================================= */
function openingLabel(o){
  return o.label || (o.type==='door'?'Door':'Window');
}
function dimText(w,h){
  if(w==null && h==null) return '—';
  if(w!=null && h!=null) return `${w}" × ${h}"`;
  return `${w!=null?w+'"':'?'} × ${h!=null?h+'"':'?'}`;
}
function renderUnitDetail(id){
  const u = getUnit(id);
  if(!u){ viewingUnitId=null; return renderProperties(); }
  const b = getBuilding(u.buildingId);
  const appliances = DATA.appliances.filter(a=>a.unitId===u.id);
  const rows = appliances.map(a=>{
    const age = applianceAge(a.installDate);
    return `<tr>
      <td>${esc(a.type)}</td><td>${esc(a.make||'—')}</td><td>${esc(a.model||'—')}</td><td>${esc(a.serialNumber||'—')}</td>
      <td>${a.installDate? fmtDate(a.installDate) : '—'}</td>
      <td>${age===null? '—' : (age===0?'<1 yr':age+' yr')}</td>
      <td class="row no-print" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('appliance','edit','${a.id}')">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this appliance record?','deleteAppliance','${a.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  const rooms = DATA.rooms.filter(r=>r.unitId===u.id);
  const roomBlocks = rooms.map(r=>{
    const openings = DATA.roomOpenings.filter(o=>o.roomId===r.id);
    const openingRows = openings.map(o=>`<tr>
      <td>${o.type==='door'?'Door':'Window'}</td><td>${esc(openingLabel(o))}</td><td>${dimText(o.widthIn,o.heightIn)}</td>
      <td>${esc(o.notes||'—')}</td>
      <td class="row no-print" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('roomOpening','edit','${o.id}')">Edit</button>
        <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this ${o.type} measurement?','deleteRoomOpening','${o.id}')">Delete</button>
      </td>
    </tr>`).join('');
    return `<div class="room-block" style="border-top:1px solid var(--line);padding:14px 0;">
      <div class="page-head" style="margin-bottom:8px;">
        <div>
          <h4 style="margin:0;">${esc(r.name)}</h4>
          <div class="subtle">
            ${r.lengthIn||r.widthIn? `Size: ${dimText(r.lengthIn,r.widthIn)}` : 'Size not recorded'}
            ${r.paintColor? ` &nbsp;·&nbsp; Paint: ${esc(r.paintColor)}` : ''}
          </div>
        </div>
        <div class="row no-print">
          <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('roomOpening','add',null,'${r.id}')">+ Door/Window</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('room','edit','${r.id}')">Edit</button>
          <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete ${esc(r.name)} and its door/window measurements?','deleteRoom','${r.id}')">Delete</button>
        </div>
      </div>
      ${r.notes? `<div class="subtle" style="margin-bottom:8px;">${esc(r.notes)}</div>` : ''}
      ${openings.length? `<table><thead><tr><th>Type</th><th>Label</th><th>Size (W × H)</th><th>Notes</th><th></th></tr></thead><tbody>${openingRows}</tbody></table>` : `<div class="empty">No doors or windows measured for this room yet.</div>`}
    </div>`;
  }).join('');

  return `
  <div class="page-head">
    <div>
      <span class="mini-link no-print" onclick="viewingUnitId=null;render();">← Back to properties</span>
      <h1 class="page-title" style="margin-top:6px;">${esc(b?b.name:'?')} · Unit ${esc(u.number)}</h1>
      <div class="page-sub">${esc(u.beds)} bed / ${esc(u.baths)} bath${u.sqft?' · '+esc(u.sqft)+' sqft':''}</div>
    </div>
    <div class="row no-print">
      <button class="btn btn-ghost" onclick="window.print()">Print</button>
      <button class="btn btn-ghost admin-only" onclick="openModal('unit','edit','${u.id}')">Edit unit</button>
    </div>
  </div>

  <div class="panel">
    <h3>Interior profile</h3>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Wall color</div><div class="kpi-value" style="font-size:15px;">${esc(u.wallColor||'—')}</div></div>
      <div class="kpi"><div class="kpi-label">Faceplate color</div><div class="kpi-value" style="font-size:15px;">${esc(u.faceplateColor||'—')}</div></div>
    </div>
    ${u.notes? `<div class="subtle" style="margin-top:4px;">${esc(u.notes)}</div>` : ''}
  </div>

  <div class="panel">
    <div class="page-head" style="margin-bottom:12px;">
      <h3 style="margin:0;">Rooms &amp; measurements</h3>
      <button class="btn btn-ghost btn-sm admin-only no-print" onclick="openModal('room','add',null,'${u.id}')">+ Add Room</button>
    </div>
    ${roomBlocks || `<div class="empty">No rooms logged yet. Add each room while the unit is vacant to capture size, paint color, and door/window measurements.</div>`}
  </div>

  <div class="panel">
    <div class="page-head" style="margin-bottom:12px;">
      <h3 style="margin:0;">Appliances</h3>
      <button class="btn btn-ghost btn-sm admin-only no-print" onclick="openModal('appliance','add',null,'${u.id}')">+ Add Appliance</button>
    </div>
    ${appliances.length? `<table><thead><tr><th>Type</th><th>Make</th><th>Model</th><th>Serial #</th><th>Installed</th><th>Age</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No appliances logged for this unit yet.</div>`}
  </div>`;
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
        <button class="btn btn-ghost btn-sm admin-only" onclick="printForRecipient('owner','${o.id}')">Envelope</button>
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

  const billing = DATA.trustTransactions.filter(e=>e.ownerId===o.id).sort((a,b)=>b.date<a.date?-1:1 || b.id-a.id);
  const TRUST_TAG = {income:'tag-good', fee:'tag-bad', expense:'tag-bad', disbursement:'tag-neutral', transfer_in:'tag-good', transfer_out:'tag-bad', adjustment:'tag-neutral'};
  const billingRows = billing.slice(0,25).map(e=>`<tr>
    <td>${fmtDate(e.date)}</td><td>${esc(getBuilding(e.buildingId)?.name||'—')}</td>
    <td><span class="tag ${TRUST_TAG[e.type]||'tag-neutral'}">${esc(e.type.replace('_',' '))}</span></td>
    <td>${esc(e.memo||'—')}</td><td class="num">${money(e.amount)}</td><td class="num">${money(e.runningBalance)}</td>
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

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Buildings owned</div><div class="kpi-value">${stakes.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total trust balance</div><div class="kpi-value">${money(stakes.reduce((s,b)=>s+trustBalance(o.id,b.id),0))}</div></div>
    <div class="kpi"><div class="kpi-label">Contacts logged</div><div class="kpi-value">${comms.length}</div></div>
  </div>

  <div class="panel">
    <h3>Buildings</h3>
    ${buildingRows? `<table><thead><tr><th>Building</th><th>Address</th><th class="num">Stake</th><th>Fee</th><th class="num">Trust balance</th></tr></thead><tbody>${stakes.map(b=>{
      const pct = b.owners.find(x=>x.ownerId===o.id).pct;
      const feeLine = b.feeType==='percent' ? `${b.feeValue}% of collected rent` : `${money(b.feeValue)} / unit / month`;
      return `<tr><td>${esc(b.name)}</td><td>${esc(b.address||'—')}</td><td class="num">${pct}%</td><td>${esc(feeLine)}</td><td class="num">${money(trustBalance(o.id,b.id))}</td></tr>`;
    }).join('')}</tbody></table>` : `<div class="empty">No buildings assigned to this owner yet.</div>`}
  </div>

  <div class="panel">
    <h3>Trust ledger</h3>
    ${billingRows? `<table><thead><tr><th>Date</th><th>Building</th><th>Type</th><th>Memo</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>${billingRows}</tbody></table>` : `<div class="empty">No trust activity yet.</div>`}
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
        <button class="btn btn-ghost btn-sm admin-only" onclick="printForRecipient('tenant','${t.id}')">Envelope</button>
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

  <div class="kpi-grid">
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
   VENDORS
   ========================================================= */
function renderVendors(){
  const rows = DATA.vendors.map(v=>`<tr>
    <td>${esc(v.name)}</td><td>${esc(v.trade||'—')}</td><td>${esc(v.email||'—')}</td><td>${esc(v.phone||'—')}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm admin-only" onclick="printForRecipient('vendor','${v.id}')">Envelope</button>
      <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('vendor','edit','${v.id}')">Edit</button>
      <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete vendor ${esc(v.name)}?','deleteVendor','${v.id}')">Delete</button>
    </td>
  </tr>`).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Vendors</h1><div class="page-sub">Contractors and service providers you work with</div></div>
    <button class="btn admin-only" onclick="openModal('vendor','add')">+ Add Vendor</button>
  </div>
  <div class="panel">
    ${DATA.vendors.length? `<table><thead><tr><th>Name</th><th>Trade</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No vendors yet.</div>`}
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
      const deposit = depositForLease(lease.id);
      body = `
      <div class="row" style="justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="font-size:15px;font-weight:600;">${esc(getTenant(lease.tenantId)?.name||'?')}</div>
          <div class="subtle">${esc(unitLabel(lease.unitId))} · Rent ${money(lease.rentAmount)}/mo · Lease ${fmtDate(lease.startDate)} → ${lease.endDate?fmtDate(lease.endDate):'open'}</div>
          <div class="subtle">Security deposit: ${deposit? money(deposit.amountHeld)+' held ('+esc(depositStatusTag(deposit.status).replace(/<[^>]+>/g,''))+')' : 'none on record yet'} <span style="color:var(--ink-soft);">— segregated from this ledger; record it as a payment with category "deposit."</span></div>
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
    <div><h1 class="page-title">Ledger</h1><div class="page-sub">Charges, payments, and running balance per lease</div></div>
    <button class="btn btn-ghost btn-sm admin-only" onclick="runRentDueCheck()">Run rent-due check now</button>
  </div>
  <div class="panel admin-only" style="padding:10px 16px;">
    <div class="subtle">Rent charges are created automatically each day for any active lease whose billing day is today (set up via cron — see README). Use the button above to run that check on demand, e.g. right after adding a new lease.</div>
  </div>
  <div class="panel">
    <div class="field" style="max-width:420px;">
      <label>Select lease</label>
      <select onchange="selectLease(this.value)"><option value="">— choose a lease —</option>${leaseOptions}</select>
    </div>
    ${body}
  </div>`;
}

async function runRentDueCheck(){
  try{
    const result = await apiCall('generateRentDue', {});
    if(result.ok){ await refreshData(); }
    alertMsg(result.message || 'Done.');
  }catch(e){ alertMsg('Could not run rent-due check: '+e.message); }
}

/* =========================================================
   MAINTENANCE
   ========================================================= */
function renderMaintenance(){
  const list = DATA.maintenance.filter(m=> !filters.maintBuilding || m.buildingId===filters.maintBuilding)
    .slice().sort((a,b)=> (a.dateReported<b.dateReported?1:-1));
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${filters.maintBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const rows = list.map(m=>{
    const canDecide = m.approvalStatus==='pending' && (isAdmin() || (m.buildingId && ownerPctOfBuilding(CURRENT_USER.ownerId, m.buildingId) > 0));
    return `<tr>
    <td>${esc(m.title)}</td>
    <td>${esc(m.buildingId?getBuilding(m.buildingId)?.name||'—':'—')}${m.unitId? ' · '+esc(getUnit(m.unitId)?.number||'') : ''}</td>
    <td>${esc(m.vendorId?getVendor(m.vendorId)?.name||'—':'—')}</td>
    <td>${priorityTag(m.priority)}</td>
    <td>${statusTag(m.status)}</td>
    <td>${approvalStatusTag(m.approvalStatus)}</td>
    <td>${fmtDate(m.dateReported)}</td>
    <td>${m.dateCompleted?fmtDate(m.dateCompleted):'—'}</td>
    <td class="num">${m.cost?money(m.cost):'—'}</td>
    <td class="row" style="justify-content:flex-end;">
      ${canDecide? `<button class="btn btn-sm" style="background:var(--good,#2a8f5a);color:#fff;" onclick="decideMaintenanceApproval('${m.id}','approved')">Approve</button>
      <button class="btn-danger btn btn-sm" onclick="decideMaintenanceApproval('${m.id}','denied')">Deny</button>` : ''}
      <button class="btn btn-ghost btn-sm admin-only" onclick="openModal('maintenance','edit','${m.id}')">Edit</button>
      <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this maintenance request?','deleteMaintenance','${m.id}')">Delete</button>
    </td>
  </tr>`;
  }).join('');
  return `
  <div class="page-head">
    <div><h1 class="page-title">Maintenance</h1><div class="page-sub">Requests and repair tracking across your buildings</div></div>
    <button class="btn admin-only" onclick="openModal('maintenance','add')">+ Add Request</button>
  </div>
  <div class="filter-bar">
    <select onchange="filters.maintBuilding=this.value;render();"><option value="">All buildings</option>${buildingOptions}</select>
  </div>
  <div class="panel">
    ${list.length? `<table><thead><tr><th>Title</th><th>Location</th><th>Vendor</th><th>Priority</th><th>Status</th><th>Approval</th><th>Reported</th><th>Completed</th><th class="num">Cost</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No maintenance requests.</div>`}
  </div>`;
}

/* =========================================================
   TRUST & DEPOSITS — the owner trust cash ledger (segregated from
   security deposits) per owner/building, plus the deposit sub-ledger.
   Management fees, postage, and disbursements are no longer generated
   here as separate actions — they're rolled into one statement per
   owner per month from Reports → Owner Statements, so an owner gets a
   single monthly invoice instead of several scattered charges.
   ========================================================= */
function renderTrust(){
  if(viewingUnitId){} // no-op, keeps this function symmetrical with others that branch on a detail view
  const buildingFilterOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${filters.ownerBillBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');

  const trustRows = DATA.trustTransactions.filter(e=> !filters.ownerBillBuilding || e.buildingId===filters.ownerBillBuilding)
    .slice().sort((a,b)=> b.date<a.date?-1:1 || b.id-a.id);
  const TYPE_TAG = {
    income:'<span class="tag tag-good">Income</span>', fee:'<span class="tag tag-bad">Fee</span>',
    expense:'<span class="tag tag-bad">Expense</span>', disbursement:'<span class="tag tag-neutral">Disbursed</span>',
    transfer_in:'<span class="tag tag-good">Transfer in</span>', transfer_out:'<span class="tag tag-bad">Transfer out</span>',
    adjustment:'<span class="tag tag-neutral">Adjustment</span>',
  };
  const rows = trustRows.slice(0,80).map(e=>`<tr>
    <td>${fmtDate(e.date)}</td>
    <td>${esc(getOwner(e.ownerId)?.name||'—')}</td>
    <td>${esc(getBuilding(e.buildingId)?.name||'—')}</td>
    <td>${TYPE_TAG[e.type]||e.type}</td>
    <td>${esc(e.memo||'—')}</td>
    <td class="num">${money(e.amount)}</td>
    <td class="num">${money(e.runningBalance)}</td>
    <td class="row" style="justify-content:flex-end;">
      ${['fee','disbursement','adjustment'].includes(e.type) ? `<button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this manual entry?','deleteTrustTransaction','${e.id}')">Delete</button>` : ''}
    </td>
  </tr>`).join('');

  // current balance per owner/building pair
  const balanceKeys = {};
  DATA.trustTransactions.forEach(e=>{ balanceKeys[e.ownerId+'|'+e.buildingId] = e; });
  const balanceRows = Object.values(balanceKeys).map(e=>`<tr>
    <td>${esc(getOwner(e.ownerId)?.name||'—')}</td><td>${esc(getBuilding(e.buildingId)?.name||'—')}</td>
    <td class="num">${money(e.runningBalance)}</td>
  </tr>`).join('');

  const depositRows = DATA.securityDeposits.slice().sort((a,b)=> b.dateReceived<a.dateReceived?-1:1).map(d=>{
    const lease = getLease(d.leaseId);
    return `<tr>
      <td>${esc(getTenant(d.tenantId)?.name||'—')}</td>
      <td>${esc(unitLabel(d.unitId))}</td>
      <td>${fmtDate(d.dateReceived)}</td>
      <td class="num">${money(d.amountHeld)}</td>
      <td>${depositStatusTag(d.status)}</td>
      <td class="row" style="justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm admin-only" onclick="openDepositTxModal('${d.id}')">Refund / Deduct</button>
      </td>
    </tr>`;
  }).join('');
  const depositTotal = DATA.securityDeposits.reduce((s,d)=>s+Number(d.amountHeld),0);

  return `
  <div class="page-head">
    <div><h1 class="page-title">Trust &amp; Deposits</h1><div class="page-sub">Each owner's share of pooled trust cash, kept separate from tenant security deposits</div></div>
    <button class="btn btn-ghost admin-only" onclick="openTrustAdjustmentModal()">+ Manual Entry</button>
  </div>

  <div class="row" style="align-items:flex-start;gap:20px;">
    <div class="panel" style="flex:2;min-width:400px;">
      <h3>Trust ledger</h3>
      <div class="filter-bar"><select onchange="filters.ownerBillBuilding=this.value;render();"><option value="">All buildings</option>${buildingFilterOptions}</select></div>
      ${rows.length? `<table><thead><tr><th>Date</th><th>Owner</th><th>Building</th><th>Type</th><th>Memo</th><th class="num">Amount</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No trust activity yet — it fills in automatically as rent is collected, fees are billed, and repairs complete.</div>`}
    </div>
    <div class="panel" style="flex:1;min-width:260px;">
      <h3>Current trust balance, by owner &amp; building</h3>
      ${balanceRows? `<table><thead><tr><th>Owner</th><th>Building</th><th class="num">Balance</th></tr></thead><tbody>${balanceRows}</tbody></table>` : `<div class="empty">No owners yet.</div>`}
      <div class="subtle" style="margin-top:8px;">Management fees, postage, and disbursements post together once per month — see Reports → Owner Statements.</div>
    </div>
  </div>

  <div class="panel">
    <div class="page-head" style="margin-bottom:10px;">
      <h3 style="margin:0;">Security deposits held</h3>
      <div class="kpi-value" style="font-size:18px;">${money(depositTotal)}</div>
    </div>
    <div class="subtle" style="margin-bottom:10px;">Segregated from the trust ledger above — tied to unit, tenant, and lease, and automatically stays with the building if it's sold.</div>
    ${depositRows.length? `<table><thead><tr><th>Tenant</th><th>Unit</th><th>Received</th><th class="num">Held</th><th>Status</th><th></th></tr></thead><tbody>${depositRows}</tbody></table>` : `<div class="empty">No security deposits recorded yet — record one on the tenant ledger as a payment with category "deposit."</div>`}
  </div>`;
}
function depositStatusTag(s){
  const map = {held:'tag-good', partially_refunded:'tag-warn', refunded:'tag-neutral', applied:'tag-neutral'};
  const label = {held:'Held', partially_refunded:'Partially refunded', refunded:'Refunded', applied:'Applied'}[s]||s;
  return `<span class="tag ${map[s]||'tag-neutral'}">${esc(label)}</span>`;
}

let depositTxDraft = null;
function openDepositTxModal(depositId){
  depositTxDraft = {securityDepositId: depositId, type:'refund', amount:0, date: todayISO(), memo:''};
  modal = {type:'depositTx', mode:'add'};
  render();
}
async function saveDepositTx(){
  try{
    const result = await apiCall('postDepositTransaction', depositTxDraft);
    if(result.ok){ modal=null; depositTxDraft=null; await refreshData(); alertMsg(result.message); }
    else alertMsg(result.message||'Could not save.');
  }catch(e){ alertMsg('Could not save: '+e.message); }
}
function depositTxForm(){
  const d = DATA.securityDeposits.find(x=>x.id===depositTxDraft.securityDepositId);
  return `
  <div class="modal-sub">${esc(getTenant(d.tenantId)?.name||'')} — ${esc(unitLabel(d.unitId))} · currently holding ${money(d.amountHeld)}</div>
  <div class="field"><label>Type</label>
    <select onchange="depositTxDraft.type=this.value">
      <option value="refund" ${depositTxDraft.type==='refund'?'selected':''}>Refund to tenant</option>
      <option value="deduction" ${depositTxDraft.type==='deduction'?'selected':''}>Deduction (damage, unpaid balance, etc.)</option>
    </select>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${depositTxDraft.date}" oninput="depositTxDraft.date=this.value"></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" value="${depositTxDraft.amount}" oninput="depositTxDraft.amount=Number(this.value)"></div>
  </div>
  <div class="field"><label>Memo</label><input value="${esc(depositTxDraft.memo)}" oninput="depositTxDraft.memo=this.value" placeholder="e.g. Carpet replacement"></div>`;
}

let trustAdjDraft = null;
function openTrustAdjustmentModal(){
  trustAdjDraft = {ownerId:'', buildingId:'', type:'fee', date: todayISO(), amount:0, memo:''};
  modal = {type:'trustAdjustment', mode:'add'};
  render();
}
async function saveTrustAdjustment(){
  try{
    const result = await apiCall('postTrustAdjustment', trustAdjDraft);
    if(result.ok){ modal=null; trustAdjDraft=null; await refreshData(); alertMsg(result.message); }
    else alertMsg(result.message||'Could not save.');
  }catch(e){ alertMsg('Could not save: '+e.message); }
}
function trustAdjustmentForm(){
  const oOpts = DATA.owners.map(o=>`<option value="${o.id}" ${trustAdjDraft.ownerId===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${trustAdjDraft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Owner</label><select onchange="trustAdjDraft.ownerId=this.value">${trustAdjDraft.ownerId?'':'<option value="">— select —</option>'}${oOpts}</select></div>
    <div class="field"><label>Building</label><select onchange="trustAdjDraft.buildingId=this.value">${trustAdjDraft.buildingId?'':'<option value="">— select —</option>'}${bOpts}</select></div>
  </div>
  <div class="field"><label>Type</label>
    <select onchange="trustAdjDraft.type=this.value">
      <option value="fee" ${trustAdjDraft.type==='fee'?'selected':''}>Fee (decreases balance)</option>
      <option value="disbursement" ${trustAdjDraft.type==='disbursement'?'selected':''}>Disbursement (decreases balance)</option>
      <option value="adjustment" ${trustAdjDraft.type==='adjustment'?'selected':''}>Adjustment (can be negative)</option>
    </select>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${trustAdjDraft.date}" oninput="trustAdjDraft.date=this.value"></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" value="${trustAdjDraft.amount}" oninput="trustAdjDraft.amount=Number(this.value)"></div>
  </div>
  <div class="field"><label>Memo</label><input value="${esc(trustAdjDraft.memo)}" oninput="trustAdjDraft.memo=this.value"></div>`;
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
  if(viewingStatementId) return renderOwnerReport();
  return `
  <div class="page-head">
    <div><h1 class="page-title">Reports</h1><div class="page-sub">Owner statements and arrears, on demand</div></div>
  </div>
  ${renderOwnerReport()}
  ${renderArrearsReport()}
  `;
}

function renderOwnerReport(){
  if(viewingStatementId) return renderStatementDetail(viewingStatementId);
  if(!isAdmin() && !statementGenState.ownerId){ statementGenState.ownerId = String(CURRENT_USER.ownerId||''); }
  const ownerOptions = DATA.owners.map(o=>`<option value="${o.id}" ${String(statementGenState.ownerId)===String(o.id)?'selected':''}>${esc(o.name)}</option>`).join('');
  const ownerBuildings = statementGenState.ownerId ? DATA.buildings.filter(b=>(b.owners||[]).some(o=>o.ownerId===statementGenState.ownerId)) : [];
  const buildingOptions = ownerBuildings.map(b=>`<option value="${b.id}" ${statementGenState.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');

  const visibleStatements = isAdmin() ? DATA.ownerStatements : DATA.ownerStatements.filter(s=>s.ownerId===CURRENT_USER.ownerId);
  const statementRows = visibleStatements.slice(0,25).map(s=>`<tr>
    <td>${fmtDate(s.periodStart).replace(/\d+,\s/,'')}</td>
    <td>${esc(getOwner(s.ownerId)?.name||'—')}</td>
    <td>${esc(getBuilding(s.buildingId)?.name||'—')}</td>
    <td class="num">${money(s.rentCollected+s.lateFeesCollected+s.otherIncome)}</td>
    <td class="num">${money(s.managementFee+s.repairsTotal+s.otherExpenses)}</td>
    <td class="num" style="font-weight:600;">${money(s.amountDisbursed)}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="viewingStatementId='${s.id}';render();">View</button>
      <a class="btn btn-ghost btn-sm" href="owner_statement_pdf.php?id=${s.id}" target="_blank" style="text-decoration:none;">PDF</a>
      <button class="btn-danger btn btn-sm admin-only" onclick="askDelete('Delete this statement? This does not reverse the fee/postage/disbursement it posted to the trust ledger.','deleteOwnerStatement','${s.id}')">Delete</button>
    </td>
  </tr>`).join('');

  return `
  ${isAdmin() ? `<div class="panel">
    <h3>Generate owner statement</h3>
    <div class="page-sub" style="margin:-6px 0 14px;">One statement per owner per building per month — it rolls the management fee, any unbilled postage, and the period's completed repairs into a single invoice, then discloses whatever's disbursed above the building's reserve.</div>
    <div class="row" style="align-items:flex-end;margin-bottom:6px;">
      <div class="field" style="min-width:200px;"><label>Owner</label><select onchange="statementGenState.ownerId=this.value;statementGenState.buildingId='';render();"><option value="">— choose —</option>${ownerOptions}</select></div>
      <div class="field" style="min-width:200px;"><label>Building</label><select onchange="statementGenState.buildingId=this.value;"><option value="">— choose —</option>${buildingOptions}</select></div>
      <div class="field" style="min-width:150px;"><label>Month</label><input type="month" value="${statementGenState.month}" oninput="statementGenState.month=this.value;"></div>
      <div class="field" style="min-width:150px;"><label>Postage rate (optional)</label><input type="number" step="0.01" placeholder="e.g. 0.68" value="${statementGenState.stampRate}" oninput="statementGenState.stampRate=this.value;"></div>
      <button class="btn" onclick="generateOwnerStatement()">Generate</button>
    </div>
    <div class="subtle">Leave the postage rate blank to skip billing unbilled stamps this cycle — they'll roll into the next statement instead.</div>
  </div>` : ''}

  <div class="panel">
    <h3>Owner statements</h3>
    ${statementRows? `<table><thead><tr><th>Month</th><th>Owner</th><th>Building</th><th class="num">Collected</th><th class="num">Expenses</th><th class="num">Disbursed</th><th></th></tr></thead><tbody>${statementRows}</tbody></table>` : `<div class="empty">No statements generated yet.</div>`}
  </div>`;
}

async function generateOwnerStatement(){
  if(!statementGenState.ownerId || !statementGenState.buildingId){ alertMsg('Choose an owner and building.'); return; }
  if(!statementGenState.month){ alertMsg('Choose a month.'); return; }
  try{
    const result = await apiCall('generateOwnerStatement', {
      ownerId: statementGenState.ownerId, buildingId: statementGenState.buildingId,
      month: statementGenState.month, stampRate: statementGenState.stampRate,
    });
    if(result.ok){ await refreshData(); viewingStatementId = String(result.id); }
    alertMsg(result.message || 'Done.');
  }catch(e){
    alertMsg('Could not generate statement: '+e.message);
  }
}

function renderStatementDetail(id){
  const s = DATA.ownerStatements.find(x=>x.id===id);
  if(!s){ viewingStatementId=null; return renderOwnerReport(); }
  const li = s.lineItems||{};
  const unitRows = (li.units||[]).map(u=>`<tr><td>${esc(u.unit)}</td><td class="num">${money(u.rentDue)}</td><td class="num">${money(u.rentCollected)}</td></tr>`).join('');
  const repairRows = (li.repairs||[]).map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${esc(r.vendor||'—')}</td><td>${esc(r.description)}</td><td class="num">${money(r.amount)}</td></tr>`).join('');
  const totalCollected = s.rentCollected + s.lateFeesCollected + s.otherIncome;
  const totalExpenses = s.managementFee + s.repairsTotal + (li.postage?.amount||0) + s.otherExpenses;
  return `
  <div class="page-head">
    <div>
      <span class="mini-link no-print" onclick="viewingStatementId=null;render();">← Back to statements</span>
      <h1 class="page-title" style="margin-top:6px;">${esc(getBuilding(s.buildingId)?.name||'?')}</h1>
      <div class="page-sub">${esc(getOwner(s.ownerId)?.name||'')} · ${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)}</div>
    </div>
    <div class="row no-print">
      <button class="btn btn-ghost" onclick="window.print()">Print</button>
      <a class="btn" href="owner_statement_pdf.php?id=${s.id}" target="_blank" style="text-decoration:none;">Download PDF</a>
    </div>
  </div>
  <div class="panel">
    <h3>Income</h3>
    <table><thead><tr><th>Unit</th><th class="num">Rent Due</th><th class="num">Rent Collected</th></tr></thead><tbody>
      ${unitRows}
      <tr class="report-total-row"><td>Total</td><td class="num">${money(s.rentDue)}</td><td class="num">${money(s.rentCollected)}</td></tr>
    </tbody></table>
    <table style="margin-top:10px;"><tbody>
      <tr><td>Late fees collected</td><td class="num">${money(s.lateFeesCollected)}</td></tr>
      <tr><td>Other income (pet / parking / utility reimbursement, etc.)</td><td class="num">${money(s.otherIncome)}</td></tr>
      <tr class="report-total-row"><td>Total collected</td><td class="num">${money(totalCollected)}</td></tr>
    </tbody></table>
  </div>
  <div class="panel">
    <h3>Expenses</h3>
    <table><tbody><tr><td>Management fee</td><td class="num">${money(s.managementFee)}</td></tr></tbody></table>
    ${repairRows? `<table style="margin-top:10px;"><thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${repairRows}</tbody></table>` : ''}
    <table style="margin-top:10px;"><tbody>
      <tr><td>Repairs &amp; maintenance</td><td class="num">${money(s.repairsTotal)}</td></tr>
      ${li.postage?.amount? `<tr><td>Postage (${li.postage.stampCount} stamp(s))</td><td class="num">${money(li.postage.amount)}</td></tr>` : ''}
      ${s.otherExpenses>0? `<tr><td>Other expenses</td><td class="num">${money(s.otherExpenses)}</td></tr>` : ''}
      <tr class="report-total-row"><td>Total expenses</td><td class="num">${money(totalExpenses)}</td></tr>
    </tbody></table>
  </div>
  <div class="panel">
    <h3>Net</h3>
    <table><tbody>
      <tr><td>Reserve held back</td><td class="num">${money(s.reserveHeld)}</td></tr>
      <tr class="report-total-row"><td>Amount disbursed</td><td class="num">${money(s.amountDisbursed)}</td></tr>
      <tr><td>Ending trust balance, this building</td><td class="num">${money(s.endingTrustBalance)}</td></tr>
    </tbody></table>
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
    <div class="kpi-grid" style="margin-bottom:16px;">
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
   PRINTABLES — envelopes and form letters, with return/to
   addresses pulled from building & owner records, plus a
   stamp-usage log that can be billed to an owner
   ========================================================= */
let printState = {
  toType:'tenant', toId:'', toName:'', toAddress:'',
  fromType:'building', fromId:'', fromName:'', fromAddress:'',
  billBuildingId:'', billOwnerId:'', quantity:1,
  letterSubject:'', letterBody:'',
  stampRate:0.73, billToOwner:'', billToBuilding:'',
};

function nl2br(s){ return esc(s||'').replace(/\n/g,'<br>'); }

// Resolves a {name, address, buildingId, ownerId} block for the given
// party type/id, used to prefill the To/From fields on the envelope and
// letter builders below. buildingId/ownerId (when known) also seed which
// owner the resulting postage gets billed to.
function resolveParty(type, id){
  if(!id) return null;
  if(type==='tenant'){
    const t = getTenant(id); if(!t) return null;
    const leases = DATA.leases.filter(l=>l.tenantId===id);
    const lease = leases.find(l=>l.status==='active') || leases[leases.length-1];
    const unit = lease ? getUnit(lease.unitId) : null;
    const b = unit ? getBuilding(unit.buildingId) : null;
    const address = b ? [b.address, unit?('Unit '+unit.number):''].filter(Boolean).join('\n') : '';
    return {name:t.name, address, buildingId: b?b.id:'', ownerId:''};
  }
  if(type==='vendor'){
    const v = getVendor(id); if(!v) return null;
    return {name:v.name, address:v.address||'', buildingId:'', ownerId:''};
  }
  if(type==='owner'){
    const o = getOwner(id); if(!o) return null;
    return {name:o.name, address:o.mailingAddress||'', buildingId:'', ownerId:o.id};
  }
  if(type==='building'){
    const b = getBuilding(id); if(!b) return null;
    return {name:b.name, address:b.address||'', buildingId:b.id, ownerId:''};
  }
  return null;
}

function printSetTo(type){ printState.toType=type; printState.toId=''; printState.toName=''; printState.toAddress=''; render(); }
function printSetFrom(type){ printState.fromType=type; printState.fromId=''; printState.fromName=''; printState.fromAddress=''; render(); }
function printPickTo(id){
  printState.toId=id;
  const p = resolveParty(printState.toType, id);
  if(p){ printState.toName=p.name; printState.toAddress=p.address; if(p.buildingId) printState.billBuildingId=p.buildingId; if(p.ownerId) printState.billOwnerId=p.ownerId; }
  render();
}
function printPickFrom(id){
  printState.fromId=id;
  const p = resolveParty(printState.fromType, id);
  if(p){ printState.fromName=p.name; printState.fromAddress=p.address; if(p.buildingId) printState.billBuildingId=p.buildingId; if(p.ownerId) printState.billOwnerId=p.ownerId; }
  render();
}
// Jump into Printables with a recipient already picked — used by the
// "Envelope" quick links on the Owners/Tenants/Vendors lists.
function printForRecipient(type, id){
  currentTab='printables';
  printState.toType=type;
  printPickTo(id);
}

const LETTER_TEMPLATES = {
  lateRent: (ctx)=>`This letter is to notify you that your rent payment is past due as of ${fmtDate(todayISO())}.\n\nPlease remit payment as soon as possible to avoid further action. If you have already sent payment, please disregard this notice.\n\nContact us if you have any questions.`,
  renewal: (ctx)=>`Your lease is coming up for renewal. We'd like to offer you the opportunity to renew for another term.\n\nPlease let us know your intentions at your earliest convenience so we can prepare the paperwork.`,
  general: (ctx)=>``,
};
function printInsertTemplate(key){
  printState.letterBody = LETTER_TEMPLATES[key] ? LETTER_TEMPLATES[key]() : '';
  render();
}

async function logStampUse(purpose){
  try{
    await apiSave('stampLog', {
      id:null, date: todayISO(), buildingId: printState.billBuildingId||'', ownerId: printState.billOwnerId||'',
      quantity: printState.quantity||1, purpose, billed:false,
    });
    await refreshData();
  }catch(e){ console.error('Could not log stamp use', e); }
}

function partySelectorFields(prefix, typeVal, idVal, onType, onPick){
  const typeOpts = [['tenant','Tenant'],['vendor','Vendor'],['owner','Owner'],['building','Building'],['custom','Custom / other']]
    .map(([v,l])=>`<option value="${v}" ${typeVal===v?'selected':''}>${l}</option>`).join('');
  let list = '';
  if(typeVal==='tenant') list = DATA.tenants.map(t=>`<option value="${t.id}" ${idVal===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
  else if(typeVal==='vendor') list = DATA.vendors.map(v=>`<option value="${v.id}" ${idVal===v.id?'selected':''}>${esc(v.name)}</option>`).join('');
  else if(typeVal==='owner') list = DATA.owners.map(o=>`<option value="${o.id}" ${idVal===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  else if(typeVal==='building') list = DATA.buildings.map(b=>`<option value="${b.id}" ${idVal===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>${prefix} — type</label><select onchange="${onType}(this.value)">${typeOpts}</select></div>
    ${typeVal==='custom' ? '' : `<div class="field"><label>${prefix} — who</label><select onchange="${onPick}(this.value)"><option value="">— select —</option>${list}</select></div>`}
  </div>`;
}

function renderPrintables(){
  return `
  <div class="page-head">
    <div><h1 class="page-title">Printables</h1><div class="page-sub">Envelopes and form letters, addressed from your building &amp; owner records</div></div>
  </div>
  ${renderEnvelopeBuilder()}
  ${renderLetterBuilder()}
  ${renderStampLog()}
  `;
}

function renderEnvelopeBuilder(){
  return `
  <div class="panel">
    <h3>Print an envelope</h3>
    <div class="page-sub" style="margin:-6px 0 14px;">Choose who it's from and who it's going to — addresses are pulled from that record and can be edited below before printing.</div>
    ${partySelectorFields('From', printState.fromType, printState.fromId, 'printSetFrom', 'printPickFrom')}
    <div class="field-row">
      <div class="field"><label>Return name</label><input value="${esc(printState.fromName)}" oninput="printState.fromName=this.value"></div>
      <div class="field"><label>Return address</label><textarea oninput="printState.fromAddress=this.value">${esc(printState.fromAddress)}</textarea></div>
    </div>
    ${partySelectorFields('To', printState.toType, printState.toId, 'printSetTo', 'printPickTo')}
    <div class="field-row">
      <div class="field"><label>To name</label><input value="${esc(printState.toName)}" oninput="printState.toName=this.value"></div>
      <div class="field"><label>To address</label><textarea oninput="printState.toAddress=this.value">${esc(printState.toAddress)}</textarea></div>
    </div>
    <div class="field-row" style="align-items:flex-end;">
      <div class="field" style="max-width:140px;"><label>Stamps used</label><input type="number" min="1" value="${printState.quantity}" oninput="printState.quantity=Number(this.value)"></div>
      <button class="btn no-print" onclick="printEnvelope()">Print Envelope</button>
    </div>
    <div class="envelope-preview no-print">
      <div class="envelope-return">${esc(printState.fromName)}<br>${nl2br(printState.fromAddress)}</div>
      <div class="envelope-to">${esc(printState.toName)}<br>${nl2br(printState.toAddress)}</div>
    </div>
  </div>`;
}

function renderLetterBuilder(){
  return `
  <div class="panel">
    <h3>Send a form letter</h3>
    <div class="page-sub" style="margin:-6px 0 14px;">Uses the same From/To addresses as the envelope above. Pick a starting template or write your own.</div>
    <div class="field-row">
      <div class="field"><label>Subject</label><input value="${esc(printState.letterSubject)}" oninput="printState.letterSubject=this.value" placeholder="e.g. Late rent notice"></div>
    </div>
    <div class="row" style="margin-bottom:8px;">
      <button class="btn btn-ghost btn-sm" onclick="printInsertTemplate('lateRent')">Insert: Late Rent Notice</button>
      <button class="btn btn-ghost btn-sm" onclick="printInsertTemplate('renewal')">Insert: Lease Renewal</button>
    </div>
    <div class="field"><label>Body</label><textarea style="min-height:180px;" oninput="printState.letterBody=this.value">${esc(printState.letterBody)}</textarea></div>
    <button class="btn no-print" onclick="printLetter()">Print Letter</button>
  </div>`;
}

function renderStampLog(){
  const unbilled = DATA.stampLog.filter(s=>!s.billed);
  const ownerOpts = DATA.owners.map(o=>`<option value="${o.id}" ${printState.billToOwner===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  const buildingOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${printState.billToBuilding===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const matching = unbilled.filter(s=> (!printState.billToOwner || s.ownerId===printState.billToOwner) && (!printState.billToBuilding || s.buildingId===printState.billToBuilding));
  const qty = matching.reduce((s,x)=>s+Number(x.quantity),0);

  const allRows = DATA.stampLog.slice(0,50).map(s=>`<tr>
    <td>${fmtDate(s.date)}</td>
    <td>${esc(s.purpose||'—')}</td>
    <td>${esc(getBuilding(s.buildingId)?.name||'—')}</td>
    <td>${esc(getOwner(s.ownerId)?.name||'—')}</td>
    <td class="num">${s.quantity}</td>
    <td>${s.billed?'<span class="tag tag-good">Billed</span>':'<span class="tag tag-warn">Unbilled</span>'}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="openModal('stampLog','edit','${s.id}')">Edit</button>
      <button class="btn-danger btn btn-sm" onclick="askDelete('Delete this stamp log entry?','deleteStampLog','${s.id}')">Delete</button>
    </td>
  </tr>`).join('');

  return `
  <div class="panel">
    <h3>Stamps</h3>
    <div class="page-sub" style="margin:-6px 0 14px;">Every envelope and letter you print logs a stamp here. Unbilled usage rolls into that owner's next generated statement (Reports → Owner Statements) instead of being billed separately here — one invoice per owner per month.</div>
    <div class="row" style="align-items:flex-end;margin-bottom:14px;">
      <div class="field"><label>Owner</label><select onchange="printState.billToOwner=this.value;render();"><option value="">— any —</option>${ownerOpts}</select></div>
      <div class="field"><label>Building (optional)</label><select onchange="printState.billToBuilding=this.value;render();"><option value="">— any —</option>${buildingOpts}</select></div>
      <div class="kpi" style="margin:0;"><div class="kpi-label">Unbilled, this filter</div><div class="kpi-value">${qty} stamp(s)</div></div>
      <button class="btn btn-ghost" onclick="openModal('stampLog','add')">+ Log Stamps</button>
    </div>
    ${allRows? `<table><thead><tr><th>Date</th><th>Purpose</th><th>Building</th><th>Owner</th><th class="num">Qty</th><th>Status</th><th></th></tr></thead><tbody>${allRows}</tbody></table>` : `<div class="empty">No stamp usage logged yet.</div>`}
  </div>`;
}

async function printEnvelope(){
  if(!printState.toName || !printState.toAddress){ alertMsg('Enter a "To" name and address first.'); return; }
  const w = window.open('', '_blank', 'width=760,height=380');
  if(!w){ alertMsg('Pop-up blocked — allow pop-ups to print envelopes.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Envelope</title><style>
    @page{ size: 9.5in 4.125in; margin:0; }
    body{ margin:0; width:9.5in; height:4.125in; font-family:Arial,sans-serif; font-size:13px; position:relative; }
    .ret{ position:absolute; top:0.4in; left:0.5in; max-width:3.5in; line-height:1.4; }
    .to{ position:absolute; top:1.9in; left:4.6in; max-width:4in; font-size:14px; line-height:1.5; }
  </style></head><body>
    <div class="ret">${esc(printState.fromName)}<br>${nl2br(printState.fromAddress)}</div>
    <div class="to">${esc(printState.toName)}<br>${nl2br(printState.toAddress)}</div>
    <script>window.onload=function(){window.print();};<\/script>
  </body></html>`);
  w.document.close();
  await logStampUse('Envelope to ' + printState.toName);
}

async function printLetter(){
  if(!printState.toName){ alertMsg('Choose a "To" recipient first.'); return; }
  const w = window.open('', '_blank');
  if(!w){ alertMsg('Pop-up blocked — allow pop-ups to print.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Letter</title><style>
    body{ font-family:Arial,sans-serif; font-size:14px; line-height:1.6; max-width:6.5in; margin:0.75in auto; color:#222; }
    .letterhead{ margin-bottom:0.5in; }
    .date{ margin-bottom:0.3in; }
    .to-block{ margin-bottom:0.3in; }
    .subject{ font-weight:600; margin-bottom:0.25in; }
    .sig{ margin-top:0.5in; }
  </style></head><body>
    <div class="letterhead"><strong>${esc(printState.fromName)}</strong><br>${nl2br(printState.fromAddress)}</div>
    <div class="date">${fmtDate(todayISO())}</div>
    <div class="to-block">${esc(printState.toName)}<br>${nl2br(printState.toAddress)}</div>
    ${printState.letterSubject? `<div class="subject">Re: ${esc(printState.letterSubject)}</div>` : ''}
    <div class="body">${nl2br(printState.letterBody)}</div>
    <div class="sig">Sincerely,<br><br><br>${esc(printState.fromName)}</div>
    <script>window.onload=function(){window.print();};<\/script>
  </body></html>`);
  w.document.close();
  await logStampUse('Letter to ' + printState.toName + (printState.letterSubject? ' — '+printState.letterSubject:''));
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
  ${draft.role==='admin'? `<div class="field"><label>Default hourly rate (optional)</label><input type="number" step="0.01" value="${draft.hourlyRate==null?'':draft.hourlyRate}" oninput="updateDraft('hourlyRate',this.value)" placeholder="Used to prefill Timecards entries"></div>` : ''}
  <div class="field"><label>${draft.id?'New password (leave blank to keep current)':'Password'}</label><input type="password" oninput="updateDraft('password',this.value)"></div>`;
}
/* =========================================================
   TIMECARDS (admin only) — hours by activity, tied to a building/unit,
   plus a labor-cost-vs-rent-collected profitability snapshot
   ========================================================= */
function activityLabel(a){
  return {admin:'Administrative', leasing:'Leasing', turnover:'Turnover', repairs:'Repairs', maintenance:'Maintenance', other:'Other'}[a] || a;
}
function renderTimecards(){
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${timecardFilters.building===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const activityOptions = ['admin','leasing','turnover','repairs','maintenance','other']
    .map(a=>`<option value="${a}" ${timecardFilters.activity===a?'selected':''}>${activityLabel(a)}</option>`).join('');

  let list = DATA.timeEntries.slice();
  if(timecardFilters.building) list = list.filter(t=>t.buildingId===timecardFilters.building);
  if(timecardFilters.activity) list = list.filter(t=>t.activity===timecardFilters.activity);
  list.sort((a,b)=> b.date<a.date?-1:1);

  const rows = list.map(t=>`<tr>
    <td>${fmtDate(t.date)}</td>
    <td>${esc(getBuilding(t.buildingId)?.name||'—')}${t.unitId? ' · '+esc(getUnit(t.unitId)?.number||'') : ''}</td>
    <td>${activityLabel(t.activity)}</td>
    <td>${esc(t.description||'—')}</td>
    <td class="num">${Number(t.hours).toFixed(2)}</td>
    <td class="num">${money(t.rate)}</td>
    <td class="num">${money(Number(t.hours)*Number(t.rate))}</td>
    <td class="row" style="justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="openModal('timeEntry','edit','${t.id}')">Edit</button>
      <button class="btn-danger btn btn-sm" onclick="askDelete('Delete this time entry?','deleteTimeEntry','${t.id}')">Delete</button>
    </td>
  </tr>`).join('');

  const totalHours = list.reduce((s,t)=>s+Number(t.hours),0);
  const totalCost = list.reduce((s,t)=>s+Number(t.hours)*Number(t.rate),0);

  return `
  <div class="page-head">
    <div><h1 class="page-title">Timecards</h1><div class="page-sub">Hours by activity, tied to a building or unit</div></div>
    <button class="btn" onclick="openModal('timeEntry','add')">+ Log Time</button>
  </div>
  <div class="filter-bar">
    <select onchange="timecardFilters.building=this.value;render();"><option value="">All buildings</option>${buildingOptions}</select>
    <select onchange="timecardFilters.activity=this.value;render();"><option value="">All activities</option>${activityOptions}</select>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Hours (filtered)</div><div class="kpi-value">${totalHours.toFixed(2)}</div></div>
    <div class="kpi"><div class="kpi-label">Labor cost (filtered)</div><div class="kpi-value">${money(totalCost)}</div></div>
  </div>
  <div class="panel">
    ${list.length? `<table><thead><tr><th>Date</th><th>Location</th><th>Activity</th><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Cost</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No time entries logged yet.</div>`}
  </div>
  ${renderProfitabilityReport()}
  `;
}

function renderProfitabilityReport(){
  const buildingOptions = DATA.buildings.map(b=>`<option value="${b.id}" ${timecardReportState.building===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  let content = '<div class="empty">Choose a building and a date range.</div>';
  if(timecardReportState.building && timecardReportState.start && timecardReportState.end){
    const b = getBuilding(timecardReportState.building);
    const unitIds = unitsForBuilding(b.id).map(u=>u.id);
    const leaseIds = DATA.leases.filter(l=>unitIds.includes(l.unitId)).map(l=>l.id);
    const rentCollected = DATA.ledger.filter(e=>e.type==='payment' && leaseIds.includes(e.leaseId) && isDateInRange(e.date, timecardReportState.start, timecardReportState.end))
      .reduce((s,e)=>s+Number(e.amount),0);
    const entries = DATA.timeEntries.filter(t=>t.buildingId===b.id && isDateInRange(t.date, timecardReportState.start, timecardReportState.end));
    const byActivity = {};
    entries.forEach(t=>{
      byActivity[t.activity] = byActivity[t.activity] || {hours:0, cost:0};
      byActivity[t.activity].hours += Number(t.hours);
      byActivity[t.activity].cost += Number(t.hours)*Number(t.rate);
    });
    const laborCost = entries.reduce((s,t)=>s+Number(t.hours)*Number(t.rate),0);
    const laborHours = entries.reduce((s,t)=>s+Number(t.hours),0);
    const net = rentCollected - laborCost;
    const activityRows = Object.keys(byActivity).sort().map(a=>`<tr><td>${activityLabel(a)}</td><td class="num">${byActivity[a].hours.toFixed(2)}</td><td class="num">${money(byActivity[a].cost)}</td></tr>`).join('');
    content = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Rent collected</div><div class="kpi-value">${money(rentCollected)}</div></div>
      <div class="kpi"><div class="kpi-label">Labor hours</div><div class="kpi-value">${laborHours.toFixed(2)}</div></div>
      <div class="kpi"><div class="kpi-label">Labor cost</div><div class="kpi-value">${money(laborCost)}</div></div>
      <div class="kpi"><div class="kpi-label">Net (rent − labor)</div><div class="kpi-value ${net<0?'bad':'good'}">${money(net)}</div></div>
    </div>
    ${activityRows? `<table><thead><tr><th>Activity</th><th class="num">Hours</th><th class="num">Cost</th></tr></thead><tbody>${activityRows}</tbody></table>` : '<div class="empty">No time logged against this building in this range.</div>'}`;
  }
  return `
  <div class="panel">
    <h3>Profitability snapshot</h3>
    <div class="row" style="align-items:flex-end;margin-bottom:14px;">
      <div class="field" style="min-width:200px;"><label>Building</label><select onchange="timecardReportState.building=this.value;render();"><option value="">— choose —</option>${buildingOptions}</select></div>
      <div class="field" style="min-width:150px;"><label>Start</label><input type="date" value="${timecardReportState.start}" oninput="timecardReportState.start=this.value;"></div>
      <div class="field" style="min-width:150px;"><label>End</label><input type="date" value="${timecardReportState.end}" oninput="timecardReportState.end=this.value;"></div>
      <button class="btn btn-ghost" onclick="render()">Run</button>
    </div>
    ${content}
  </div>`;
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
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getBuilding(id))) : {id:null, name:'', address:'', feeType:'percent', feeValue:8, owners:[], roofLastServiced:'', roofNotes:'', electricalLoad:'', exteriorPaintColor:'', profileNotes:'', reserveAmount:0, maintenanceApprovalThreshold:''};
      break;
    case 'unit':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getUnit(id))) : {id:null, buildingId: extra||'', number:'', beds:1, baths:1, sqft:'', notes:'', wallColor:'', faceplateColor:''};
      break;
    case 'appliance':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.appliances.find(a=>a.id===id))) : {id:null, unitId: extra||'', type:'Stove', make:'', model:'', serialNumber:'', installDate:'', notes:''};
      break;
    case 'timeEntry':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.timeEntries.find(t=>t.id===id))) : {id:null, buildingId: extra||'', unitId:'', userId: CURRENT_USER.id!=null?String(CURRENT_USER.id):'', date: todayISO(), activity:'admin', hours:1, rate: CURRENT_USER.hourlyRate||0, description:'', notes:''};
      break;
    case 'room':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.rooms.find(r=>r.id===id))) : {id:null, unitId: extra||'', name:'', lengthIn:'', widthIn:'', paintColor:'', notes:''};
      break;
    case 'roomOpening':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.roomOpenings.find(o=>o.id===id))) : {id:null, roomId: extra||'', type:'window', label:'', widthIn:'', heightIn:'', notes:''};
      break;
    case 'owner':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getOwner(id))) : {id:null, name:'', email:'', phone:'', mailingAddress:''};
      break;
    case 'tenant':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getTenant(id))) : {id:null, name:'', email:'', phone:''};
      break;
    case 'vendor':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getVendor(id))) : {id:null, name:'', trade:'', email:'', phone:'', address:'', notes:''};
      break;
    case 'stampLog':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.stampLog.find(l=>l.id===id))) : {id:null, date: todayISO(), buildingId: extra||'', ownerId:'', quantity:1, purpose:'', billed:false};
      break;
    case 'lease':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getLease(id))) : {id:null, unitId:'', tenantId:'', startDate: todayISO(), endDate:'', rentAmount:0, depositAmount:0, billingDay:1, status:'active'};
      break;
    case 'maintenance':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(getMaintenance(id))) : {id:null, buildingId:'', unitId:'', title:'', description:'', priority:'medium', status:'open', dateReported: todayISO(), dateCompleted:'', cost:0, notes:'', vendorId:'', invoiceNumber:'', invoiceDate:''};
      break;
    case 'ledgerCharge':
      draft = {id:null, leaseId: extra, date: todayISO(), type:'charge', category:'rent', amount:0, memo:''};
      break;
    case 'ledgerPayment':
      draft = {id:null, leaseId: extra, date: todayISO(), type:'payment', category:'rent', amount:0, memo:'', paymentMethod:'', chargeId:''};
      break;
    case 'communication':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.communications.find(c=>c.id===id))) : {id:null, ownerId: extra||'', buildingId:'', date: todayISO(), method:'call', subject:'', notes:'', followUpDate:''};
      break;
    case 'tenantComm':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(DATA.tenantCommunications.find(c=>c.id===id))) : {id:null, tenantId: extra||'', leaseId:'', date: todayISO(), method:'call', subject:'', notes:'', followUpDate:''};
      break;
    case 'user':
      draft = mode==='edit' ? JSON.parse(JSON.stringify(USERS_LIST.find(u=>u.id===id))) : {id:null, username:'', role:'owner', ownerId:'', displayName:'', email:'', hourlyRate:'', password:''};
      if(mode==='edit') draft.password = '';
      break;
    case 'changePassword':
      draft = {current:'', new:'', confirm:''};
      break;
  }
  render();
}
function closeModal(){ if(forcedPasswordChange && modal && modal.type==='changePassword') return; modal=null; draft=null; render(); }
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
  if(t==='depositTx'){ return saveDepositTx(); }
  if(t==='trustAdjustment'){ return saveTrustAdjustment(); }
  if(t==='ownerTransfer'){ return saveOwnerTransfer(); }
  if(t==='changePassword'){
    if(draft.new !== draft.confirm){ alertMsg('New password and confirmation don\'t match.'); return; }
    try{
      const result = await apiCall('changePassword', {current: draft.current, new: draft.new});
      if(result.ok){
        const wasForced = forcedPasswordChange;
        forcedPasswordChange = false;
        CURRENT_USER.mustChangePassword = false;
        closeModal();
        alertMsg(wasForced ? 'Password updated — you\'re all set.' : (result.message||'Password updated.'));
      }
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
    case 'vendor': title = modal.mode==='add'?'Add Vendor':'Edit Vendor'; body = vendorForm(); break;
    case 'lease': title = modal.mode==='add'?'Add Lease':'Edit Lease'; body = leaseForm(); break;
    case 'maintenance': title = modal.mode==='add'?'Add Maintenance Request':'Edit Maintenance Request'; body = maintenanceForm(); break;
    case 'ledgerCharge': title = 'Add Charge'; body = ledgerEntryForm(); break;
    case 'ledgerPayment': title = 'Record Payment'; body = ledgerEntryForm(); break;
    case 'communication': title = modal.mode==='add'?'Log Communication':'Edit Communication'; body = communicationForm(); break;
    case 'tenantComm': title = modal.mode==='add'?'Log Communication':'Edit Communication'; body = tenantCommForm(); break;
    case 'appliance': title = modal.mode==='add'?'Add Appliance':'Edit Appliance'; body = applianceForm(); break;
    case 'room': title = modal.mode==='add'?'Add Room':'Edit Room'; body = roomForm(); break;
    case 'roomOpening': title = modal.mode==='add'?(draft.type==='door'?'Add Door':'Add Window'):'Edit Door/Window'; body = roomOpeningForm(); break;
    case 'timeEntry': title = modal.mode==='add'?'Log Time':'Edit Time Entry'; body = timeEntryForm(); break;
    case 'stampLog': title = modal.mode==='add'?'Log Stamp Usage':'Edit Stamp Usage'; body = stampLogForm(); break;
    case 'user': title = modal.mode==='add'?'Add User':'Edit User'; body = userForm(); break;
    case 'changePassword': title = 'Change Password'; body = changePasswordForm(); break;
    case 'depositTx': title = 'Refund / Deduct Security Deposit'; body = depositTxForm(); break;
    case 'trustAdjustment': title = 'Manual Trust Entry'; body = trustAdjustmentForm(); break;
    case 'ownerTransfer': title = 'Transfer Ownership'; body = ownerTransferForm(); break;
  }
  const forced = forcedPasswordChange && modal.type==='changePassword';
  return `<div class="modal-overlay" ${forced?'':'onclick="if(event.target===this)closeModal()"'}>
    <div class="modal-box">
      ${forced?'':'<span class="close-x" onclick="closeModal()">&times;</span>'}
      <h3>${title}</h3>
      ${forced?'<div class="subtle" style="margin-bottom:14px;">Set a new password before continuing — this account is still using its initial one-time password.</div>':''}
      ${body}
      <div class="modal-actions">
        ${forced?'':'<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'}
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
  <div class="field-row">
    <div class="field"><label>Reserve (min. trust balance held back)</label><input type="number" step="0.01" value="${draft.reserveAmount||0}" oninput="updateDraftNum('reserveAmount',this.value)"></div>
    <div class="field"><label>Repair approval threshold (optional)</label><input type="number" step="0.01" placeholder="blank = no owner approval required" value="${draft.maintenanceApprovalThreshold==null?'':draft.maintenanceApprovalThreshold}" oninput="updateDraft('maintenanceApprovalThreshold',this.value===''?'':Number(this.value))"></div>
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
  </div>
  <div class="section-divider">Building profile</div>
  <div class="field-row">
    <div class="field"><label>Roof last serviced</label><input type="date" value="${draft.roofLastServiced||''}" oninput="updateDraft('roofLastServiced',this.value)"></div>
    <div class="field"><label>Electrical load</label><input value="${esc(draft.electricalLoad||'')}" oninput="updateDraft('electricalLoad',this.value)" placeholder="e.g. 200A 3-phase"></div>
  </div>
  <div class="field"><label>Exterior paint color</label><input value="${esc(draft.exteriorPaintColor||'')}" oninput="updateDraft('exteriorPaintColor',this.value)" placeholder="Brand + code, e.g. SW 7006 Extra White"></div>
  <div class="field"><label>Roof notes</label><textarea oninput="updateDraft('roofNotes',this.value)" placeholder="Material, warranty, contractor">${esc(draft.roofNotes||'')}</textarea></div>
  <div class="field"><label>Other profile notes</label><textarea oninput="updateDraft('profileNotes',this.value)">${esc(draft.profileNotes||'')}</textarea></div>`;
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
  <div class="field-row">
    <div class="field"><label>Wall color</label><input value="${esc(draft.wallColor||'')}" oninput="updateDraft('wallColor',this.value)" placeholder="Brand + code"></div>
    <div class="field"><label>Faceplate color</label><input value="${esc(draft.faceplateColor||'')}" oninput="updateDraft('faceplateColor',this.value)"></div>
  </div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function applianceForm(){
  const commonTypes = ['Stove','Refrigerator','Dishwasher','Microwave','Washer','Dryer','Water Heater','HVAC','Other'];
  return `
  <div class="field"><label>Type</label>
    <select onchange="updateDraft('type',this.value)">
      ${commonTypes.map(t=>`<option value="${t}" ${draft.type===t?'selected':''}>${t}</option>`).join('')}
    </select>
  </div>
  <div class="field-row">
    <div class="field"><label>Make</label><input value="${esc(draft.make||'')}" oninput="updateDraft('make',this.value)"></div>
    <div class="field"><label>Model</label><input value="${esc(draft.model||'')}" oninput="updateDraft('model',this.value)"></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Serial number</label><input value="${esc(draft.serialNumber||'')}" oninput="updateDraft('serialNumber',this.value)"></div>
    <div class="field"><label>Install date</label><input type="date" value="${draft.installDate||''}" oninput="updateDraft('installDate',this.value)"></div>
  </div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function roomForm(){
  return `
  <div class="field"><label>Room name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)" placeholder="e.g. Living Room, Bedroom 1, Kitchen"></div>
  <div class="field-row">
    <div class="field"><label>Length (in)</label><input type="number" step="0.25" value="${draft.lengthIn}" oninput="updateDraftNum('lengthIn',this.value)"></div>
    <div class="field"><label>Width (in)</label><input type="number" step="0.25" value="${draft.widthIn}" oninput="updateDraftNum('widthIn',this.value)"></div>
  </div>
  <div class="field"><label>Paint color</label><input value="${esc(draft.paintColor||'')}" oninput="updateDraft('paintColor',this.value)" placeholder="Brand + code — leave blank to use the unit's wall color"></div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function roomOpeningForm(){
  return `
  <div class="field"><label>Type</label>
    <select onchange="updateDraft('type',this.value)">
      <option value="window" ${draft.type==='window'?'selected':''}>Window</option>
      <option value="door" ${draft.type==='door'?'selected':''}>Door</option>
    </select>
  </div>
  <div class="field"><label>Label</label><input value="${esc(draft.label||'')}" oninput="updateDraft('label',this.value)" placeholder="e.g. North window, Closet door"></div>
  <div class="field-row">
    <div class="field"><label>Width (in)</label><input type="number" step="0.125" value="${draft.widthIn}" oninput="updateDraftNum('widthIn',this.value)"></div>
    <div class="field"><label>Height (in)</label><input type="number" step="0.125" value="${draft.heightIn}" oninput="updateDraftNum('heightIn',this.value)"></div>
  </div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function ownerForm(){
  return `
  <div class="field"><label>Name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)"></div>
  <div class="field"><label>Email</label><input value="${esc(draft.email)}" oninput="updateDraft('email',this.value)"></div>
  <div class="field"><label>Phone</label><input value="${esc(draft.phone)}" oninput="updateDraft('phone',this.value)"></div>
  <div class="field"><label>Mailing address</label><textarea oninput="updateDraft('mailingAddress',this.value)" placeholder="Used as the address on printed mail, e.g. envelopes and owner statements">${esc(draft.mailingAddress||'')}</textarea></div>`;
}
function tenantForm(){
  return `
  <div class="field"><label>Name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)"></div>
  <div class="field"><label>Email</label><input value="${esc(draft.email)}" oninput="updateDraft('email',this.value)"></div>
  <div class="field"><label>Phone</label><input value="${esc(draft.phone)}" oninput="updateDraft('phone',this.value)"></div>`;
}

function vendorForm(){
  return `
  <div class="field"><label>Name</label><input value="${esc(draft.name)}" oninput="updateDraft('name',this.value)"></div>
  <div class="field"><label>Trade / specialty</label><input value="${esc(draft.trade||'')}" oninput="updateDraft('trade',this.value)" placeholder="e.g. Plumbing, Electrical, Landscaping"></div>
  <div class="field-row">
    <div class="field"><label>Email</label><input value="${esc(draft.email||'')}" oninput="updateDraft('email',this.value)"></div>
    <div class="field"><label>Phone</label><input value="${esc(draft.phone||'')}" oninput="updateDraft('phone',this.value)"></div>
  </div>
  <div class="field"><label>Mailing address</label><input value="${esc(draft.address||'')}" oninput="updateDraft('address',this.value)" placeholder="Used on printed envelopes and letters"></div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}

function stampLogForm(){
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const oOpts = DATA.owners.map(o=>`<option value="${o.id}" ${draft.ownerId===o.id?'selected':''}>${esc(o.name)}</option>`).join('');
  return `
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field" style="max-width:120px;"><label>Quantity</label><input type="number" min="1" value="${draft.quantity}" oninput="updateDraftNum('quantity',this.value)"></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Building (optional)</label><select onchange="updateDraft('buildingId',this.value)"><option value="">— none —</option>${bOpts}</select></div>
    <div class="field"><label>Bill to owner (optional)</label><select onchange="updateDraft('ownerId',this.value)"><option value="">— none —</option>${oOpts}</select></div>
  </div>
  <div class="field"><label>Purpose</label><input value="${esc(draft.purpose||'')}" oninput="updateDraft('purpose',this.value)" placeholder="e.g. Mailed lease renewal to tenant"></div>`;
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
  <div class="section-divider">Vendor &amp; invoice</div>
  <div class="field-row">
    <div class="field"><label>Vendor</label><select onchange="updateDraft('vendorId',this.value)"><option value="">— none —</option>${DATA.vendors.map(v=>`<option value="${v.id}" ${draft.vendorId===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Invoice #</label><input value="${esc(draft.invoiceNumber||'')}" oninput="updateDraft('invoiceNumber',this.value)"></div>
    <div class="field"><label>Invoice date</label><input type="date" value="${draft.invoiceDate||''}" oninput="updateDraft('invoiceDate',this.value)"></div>
  </div>
  ${draft.buildingId && getBuilding(draft.buildingId)?.maintenanceApprovalThreshold!=null ? `<div class="subtle">This building requires owner approval above ${money(getBuilding(draft.buildingId).maintenanceApprovalThreshold)}. ${draft.approvalStatus?'Current status: '+approvalStatusLabel(draft.approvalStatus)+'.':''}</div>` : ''}
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
}
function reRenderModalBody(){ render(); }
function approvalStatusLabel(s){
  return {auto_approved:'Auto-approved', pending:'Pending owner approval', approved:'Approved', denied:'Denied'}[s]||s;
}
function approvalStatusTag(s){
  const map = {auto_approved:'tag-good', pending:'tag-warn', approved:'tag-good', denied:'tag-bad'};
  return `<span class="tag ${map[s]||'tag-neutral'}">${esc(approvalStatusLabel(s))}</span>`;
}
async function decideMaintenanceApproval(id, decision){
  try{
    const result = await apiCall('approveMaintenance', {id, decision});
    if(result.ok){ await refreshData(); }
    alertMsg(result.message || 'Done.');
  }catch(e){ alertMsg('Could not record decision: '+e.message); }
}

function ledgerEntryForm(){
  const lease = getLease(draft.leaseId);
  const isCharge = draft.type==='charge';
  const openCharges = !isCharge ? leaseLedgerEntries(draft.leaseId).filter(e=>e.type==='charge') : [];
  return `
  <div class="modal-sub">${esc(getTenant(lease?.tenantId)?.name||'')} — ${esc(unitLabel(lease?.unitId))}</div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" value="${draft.amount}" oninput="updateDraftNum('amount',this.value)"></div>
  </div>
  <div class="field"><label>Category</label>
    <select onchange="updateDraft('category',this.value)">
      ${(isCharge? ['rent','late_fee','utility','other'] : ['rent','late_fee','utility','deposit','other']).map(c=>`<option value="${c}" ${draft.category===c?'selected':''}>${c}</option>`).join('')}
    </select>
  </div>
  ${!isCharge? `
  <div class="field-row">
    <div class="field"><label>Payment method</label>
      <select onchange="updateDraft('paymentMethod',this.value)">
        <option value="">— unspecified —</option>
        ${['cash','check','ach','card','online','other'].map(m=>`<option value="${m}" ${draft.paymentMethod===m?'selected':''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Applies to charge (optional)</label>
      <select onchange="updateDraft('chargeId',this.value)">
        <option value="">— none —</option>
        ${openCharges.map(c=>`<option value="${c.id}" ${draft.chargeId===c.id?'selected':''}>${fmtDate(c.date)} — ${c.category} — ${money(c.amount)}</option>`).join('')}
      </select>
    </div>
  </div>
  ${draft.category==='deposit'? '<div class="subtle">Recorded to the segregated security-deposit ledger, not the operating trust balance.</div>' : ''}` : ''}
  <div class="field"><label>Memo</label><input value="${esc(draft.memo)}" oninput="updateDraft('memo',this.value)" placeholder="Optional note"></div>`;
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

function timeEntryForm(){
  const bOpts = DATA.buildings.map(b=>`<option value="${b.id}" ${draft.buildingId===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const units = draft.buildingId ? unitsForBuilding(draft.buildingId) : [];
  const uOpts = units.map(u=>`<option value="${u.id}" ${draft.unitId===u.id?'selected':''}>${esc(u.number)}</option>`).join('');
  const activities = [
    ['admin','Administrative'], ['leasing','Leasing / finding tenants'], ['turnover','Unit turnover'],
    ['repairs','Repairs'], ['maintenance','Maintenance'], ['other','Other'],
  ];
  return `
  <div class="field-row">
    <div class="field"><label>Building</label><select onchange="updateDraft('buildingId',this.value);updateDraft('unitId','');reRenderModalBody()"><option value="">— select —</option>${bOpts}</select></div>
    <div class="field"><label>Unit (optional)</label><select onchange="updateDraft('unitId',this.value)"><option value="">— whole building —</option>${uOpts}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Date</label><input type="date" value="${draft.date}" oninput="updateDraft('date',this.value)"></div>
    <div class="field"><label>Activity</label>
      <select onchange="updateDraft('activity',this.value)">
        ${activities.map(([v,l])=>`<option value="${v}" ${draft.activity===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="field-row">
    <div class="field"><label>Hours</label><input type="number" step="0.25" value="${draft.hours}" oninput="updateDraftNum('hours',this.value)"></div>
    <div class="field"><label>Rate ($/hr)</label><input type="number" step="0.01" value="${draft.rate}" oninput="updateDraftNum('rate',this.value)"></div>
  </div>
  <div class="field"><label>Description</label><input value="${esc(draft.description||'')}" oninput="updateDraft('description',this.value)" placeholder="e.g. Showed unit 2B to prospective tenant"></div>
  <div class="field"><label>Notes</label><textarea oninput="updateDraft('notes',this.value)">${esc(draft.notes||'')}</textarea></div>`;
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
  deleteBuilding:'building', deleteUnit:'unit', deleteOwner:'owner', deleteTenant:'tenant', deleteVendor:'vendor',
  deleteLease:'lease', deleteLedgerEntry:'ledgerEntry', deleteMaintenance:'maintenance',
  deleteTrustTransaction:'trustTransaction', deleteOwnerStatement:'ownerStatement',
  deleteCommunication:'communication', deleteTenantComm:'tenantComm',
  deleteAppliance:'appliance', deleteTimeEntry:'timeEntry',
  deleteRoom:'room', deleteRoomOpening:'roomOpening', deleteStampLog:'stampLog'
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

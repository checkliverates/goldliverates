const http = require("http");
const io = require("socket.io-client");

const PORT = process.env.PORT || 10000;
const WF_SERVER = "https://quote.wfgroup.com.hk:8083";
const TOKEN = process.env.WFBULLION_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Used only to print shareable client-link URLs on the /admin page.
// Set FRONTEND_URL in Render Environment Variables if your static site
// ever moves to a different domain.
const FRONTEND_URL = process.env.FRONTEND_URL || "https://gold-live-rates.onrender.com";

// Optional persistent storage for MARKUPS (a Google Apps Script Web App URL
// backed by a Google Sheet). If these are not set, the app behaves exactly
// as before: MARKUPS only lives in memory and resets to the hardcoded
// defaults below on every restart. Once set, MARKUPS is loaded from here on
// startup and pushed here on every successful /admin/save, so markup
// changes survive Render restarts/spin-downs.
// .trim() matters here: a stray trailing space or newline pasted into the
// Render env var box (very easy to do with copy/paste) would make this
// secret NOT match the SECRET hardcoded in Apps Script, and Apps Script
// would correctly reject every request as "Unauthorized" - even though the
// URL, code, and everything else look identical.
const MARKUP_STORE_URL = (process.env.MARKUP_STORE_URL || "").trim();
const MARKUP_STORE_SECRET = (process.env.MARKUP_STORE_SECRET || "").trim();

// ============================================================
// PRODUCT ROWS  x  CLIENT LINKS  x  MARKUPS
// ------------------------------------------------------------
// PRODUCTS: the rows of the table. unitMultiplier converts the
//   per-gram rate into whatever unit that row displays:
//     1       -> per gram (e.g. "75 - 199 Grams")
//     37.429  -> per tael (e.g. "1 Tael")
//   New rows (e.g. a future "gram size" row) just need a label
//   and a unitMultiplier — no other code changes needed.
//
// LINKS: your client categories. Each link is shared as:
//   FRONTEND_URL + "/?link=" + link.id
//   There is always an implicit "main" link (id reserved, not
//   listed here) that always uses 0.00 markup on every row:
//   FRONTEND_URL + "/"  (no ?link param, or an unrecognized one)
//
// MARKUPS: MARKUPS[productId][linkId] = markup added (in USD,
//   per gram) before dividing by 31.1035. Never sent to the browser.
//
// All three of these can also be edited live from /admin — this is
// just the starting/default data.
// ============================================================
const MAIN_LINK_ID = "main";

const PRODUCTS = [
  { id: "tael",      label: "1 Tael",           unitMultiplier: 37.429 },
  { id: "p75-199",   label: "75 - 199 Grams",   unitMultiplier: 1 },
  { id: "p200-399",  label: "200 - 399 Grams",  unitMultiplier: 1 }
];

const LINKS = [
  { id: "DH1", label: "DH1" },
  { id: "2CT", label: "2CT" },
  { id: "G3R", label: "G3R" },
  { id: "C4F", label: "C4F" },
  { id: "LM5", label: "LM5" }
];

const MARKUPS = {
  "tael":     { DH1: 13.00, "2CT": 13.00, G3R: 13.00},
  "p75-199":  { DH1: 13.00, "2CT": 10.00, G3R:  9.00},
  "p200-399": { DH1: 11.00, "2CT":  7.00, G3R:  6.00},
  "p400-999": { DH1:  9.00, "2CT":  5.00, G3R:  3.00},
  "p1000":    { DH1:  7.00, "2CT":  3.00, G3R:  0.00}
};

let latest = {
  bid: null,
  gramSourceAsk: null,
  hkdSell: null,
  updatedAt: null,
  connected: false,
  marketDirection: "same"
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function truncate2(n) {
  return Math.trunc((n + Number.EPSILON) * 100) / 100;
}

// Loads saved markups from the Google Sheet (via Apps Script) at startup.
// Only overwrites markups for product/link ids that still exist in this
// file - if MARKUP_STORE_URL/SECRET aren't set, or the sheet is empty, or
// it can't be reached, this silently does nothing and the hardcoded
// MARKUPS above stay as-is (same behavior as before this feature existed).
async function loadMarkupsFromStore() {
  if (!MARKUP_STORE_URL) return;
  // Diagnostic only - never prints the secret itself, just its length, so
  // you can compare it against what you typed into Apps Script (SECRET =
  // "Iamthebo$$1355kdfiuerpljdktu" is 28 characters). If this number looks
  // wrong, the Render env var has extra/missing characters (commonly a
  // trailing space or newline from a copy/paste).
  console.log("[MARKUPS] Store URL configured. Secret length: " + MARKUP_STORE_SECRET.length);
  try {
    const res = await fetch(MARKUP_STORE_URL + "?secret=" + encodeURIComponent(MARKUP_STORE_SECRET));
    const data = await res.json();
    if (!data || !data.ok) {
      console.log("[MARKUPS] Store load was not ok: " + (data && data.message) + " - using defaults from server.js.");
      return;
    }
    if (!data.markups || typeof data.markups !== "object") {
      console.log("[MARKUPS] Store returned no saved data yet - using defaults from server.js.");
      return;
    }
    let applied = 0;
    for (const p of PRODUCTS) {
      const savedForProduct = data.markups[p.id];
      if (!savedForProduct || typeof savedForProduct !== "object") continue;
      for (const l of LINKS) {
        if (savedForProduct[l.id] === undefined) continue;
        const v = Number(savedForProduct[l.id]);
        if (!Number.isFinite(v)) continue;
        if (!MARKUPS[p.id]) MARKUPS[p.id] = {};
        MARKUPS[p.id][l.id] = v;
        applied++;
      }
    }
    console.log("[MARKUPS] Loaded " + applied + " saved markup value(s) from persistent store.");
  } catch (e) {
    console.log("[MARKUPS] Could not reach persistent store, using defaults from server.js: " + e.message);
  }
}

// Fire-and-forget push of the full MARKUPS object to the store after a
// successful /admin/save. Never blocks or fails the admin response - if
// the store is unreachable, the change still applies live in memory, it
// just won't survive the next restart.
//
// Uses GET (not POST) on purpose: Apps Script web apps respond with an
// internal redirect, and most HTTP clients (including Node's fetch)
// silently downgrade a POST to a GET and drop its body when following a
// redirect - so a POST save can look like it "worked" but actually arrives
// with no data and gets rejected. GET requests aren't affected by this, so
// the markup data is sent as a URL parameter instead of a POST body.
function saveMarkupsToStore() {
  if (!MARKUP_STORE_URL) return;
  const url = MARKUP_STORE_URL
    + "?secret=" + encodeURIComponent(MARKUP_STORE_SECRET)
    + "&action=save"
    + "&data=" + encodeURIComponent(JSON.stringify(MARKUPS));
  fetch(url).then(res => res.json()).then(data => {
    if (!data || !data.ok) {
      console.log("[MARKUPS] Persistent store rejected save: " + (data && data.message) + " (secret length sent: " + MARKUP_STORE_SECRET.length + ")");
    } else {
      console.log("[MARKUPS] Saved to persistent store OK.");
    }
  }).catch(e => {
    console.log("[MARKUPS] Could not save to persistent store: " + e.message);
  });
}

// TRUNCATE((LLG selling price + row markup) / 31.1035, 2) for the base
// per-gram USD rate, same base rate used for the HKD side. Rows with
// unitMultiplier 1 (every gram-bracket row) stop there, truncated exactly
// once - identical to the original per-row formula. Rows with a different
// unitMultiplier (e.g. 37.429 for "1 Tael") multiply that already-truncated
// base rate and truncate a second time, matching the confirmed Tael formula
// exactly. The "main" link always uses markup 0.
function calculateRows(linkId) {
  if (latest.bid === null) return [];
  const isMain = linkId === MAIN_LINK_ID;
  return PRODUCTS.map(p => {
    const markup = isMain ? 0 : Number((MARKUPS[p.id] && MARKUPS[p.id][linkId]) || 0);
    const multiplier = Number(p.unitMultiplier) || 1;
    const baseRate = truncate2((latest.bid + markup) / 31.1035);
    const baseHkd = latest.hkdSell !== null ? truncate2(baseRate * latest.hkdSell) : null;
    // Only re-truncate when there's an actual conversion to do — re-running
    // truncate2 on a value that's already truncated can shave a cent off
    // due to floating-point rounding, so multiplier===1 rows skip it.
    const rate = multiplier === 1 ? baseRate : truncate2(baseRate * multiplier);
    const hkdRate = baseHkd === null ? null : (multiplier === 1 ? baseHkd : truncate2(baseHkd * multiplier));
    return { id: p.id, label: p.label, rate, hkdRate };
  });
}

// Returns MAIN_LINK_ID only when explicitly requested (?link=main), a real
// configured link id when it matches one in LINKS, or null for anything else
// (no ?link= param at all, or an unrecognized/mistyped value). null means
// "refuse to serve rates" - the bare URL and wrong links must NOT silently
// fall back to the 0-markup main link, or a client sharing a screenshot of
// a wrong link would show 0 markup instead of an error.
function resolveLinkId(raw) {
  if (!raw) return null;
  if (raw === MAIN_LINK_ID) return MAIN_LINK_ID;
  return LINKS.some(l => l.id === raw) ? raw : null;
}

function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markup Settings</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px 16px 60px;color:#1a2b3c}
.wrap{max-width:480px;margin:auto}
h1{margin:0 0 4px;font-size:22px}
.sub{color:#5c6b7a;margin:0 0 18px;font-size:13px;line-height:1.5}
.panel{background:#fff;border:1px solid #e3d8b8;border-radius:16px;padding:18px;box-shadow:0 10px 28px rgba(0,0,0,.06);margin-bottom:16px}
label.fieldlabel{display:block;font-size:13px;font-weight:600;color:#5c6b7a;margin-bottom:6px}
select,input[type=password]{width:100%;padding:14px;font-size:16px;border:1px solid #ccc;border-radius:10px;background:#fff;-webkit-appearance:none;appearance:none}
.linkurl{font-size:12px;color:#5c6b7a;word-break:break-all;margin-top:8px}
.row{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid #eef1f4}
.row:last-child{border-bottom:0}
.row .rlabel{flex:1;min-width:0;font-size:13.5px;font-weight:600;line-height:1.25}
.valctrl{display:flex;align-items:center;gap:6px;flex:none}
.stepbtn{width:36px;height:36px;flex:none;font-size:19px;font-weight:700;line-height:1;border:1px solid #ccc;border-radius:9px;background:#f5f5f5;color:#1a2b3c;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;user-select:none}
.stepbtn:active{background:#e2e2e2}
.row input[type=number]{width:58px;flex:none;padding:8px 2px;font-size:15px;border:1px solid #ccc;border-radius:9px;text-align:center;box-sizing:border-box}
.savebtn{width:100%;padding:16px;font-size:17px;font-weight:700;background:#c59a22;color:#fff;border:0;border-radius:12px;cursor:pointer;margin-top:6px}
.savebtn:disabled{opacity:.6;cursor:default}
.msg{margin-top:14px;font-weight:700;font-size:14px}
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px;border:1px solid #eef1f4}
table.overview{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px}
table.overview th,table.overview td{padding:7px 3px;text-align:center;border-bottom:1px solid #eef1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.overview tr:last-child td{border-bottom:0}
table.overview th{background:#0b69bf;color:#fff;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
table.overview td:first-child,table.overview th:first-child{width:72px;text-align:left;font-weight:600;color:#164f8e;background:#f8fbfe;padding-left:8px;white-space:normal;overflow-wrap:break-word}
table.overview th:first-child{background:#0b69bf;color:#fff}
</style></head><body><div class="wrap">
<h1>Markup Settings</h1>
<p class="sub">Enter the password to manage markups. Changes are live immediately. Markups never appear on any client-facing page.</p>

<div class="panel" id="gatePanel">
<label class="fieldlabel" for="pwInput">Password</label>
<input type="password" id="pwInput" placeholder="Enter admin password" autocomplete="current-password" autofocus onkeydown="if(event.key==='Enter'){unlock()}">
<button class="savebtn" id="unlockBtn" onclick="unlock()" type="button" style="margin-top:12px">Unlock</button>
<div id="pwErr" class="msg" style="color:#c23246"></div>
</div>

<div id="appPanel" style="display:none">
<div class="panel">
<label class="fieldlabel">All Links Overview</label>
<div class="tablewrap"><table class="overview" id="overviewTable"></table></div>
</div>
<div class="panel">
<label class="fieldlabel" for="linkSelect">Client link</label>
<select id="linkSelect" onchange="onLinkChange()"></select>
<div class="linkurl" id="linkUrl"></div>
</div>
<div class="panel">
<div id="rowsWrap">Loading&hellip;</div>
<button class="savebtn" onclick="save()" type="button">Save Changes</button>
<div id="msg" class="msg"></div>
</div>
</div>

</div>
<script>
var STATE={products:[],links:[],markups:{},frontendUrl:""};
var ADMIN_KEY_VAL = "";
var currentLinkId = null;

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

// Truncates (not rounds) to 2 decimals - mirrors the server-side truncate2()
// used for the real price calculation, so this display-only preview matches
// the same math style.
function truncate2(n){ return Math.trunc((n + Number.EPSILON) * 100) / 100; }

// Display formatting only: 13.00 -> "13", 5.50 -> "5.5", 0.41 -> "0.41".
// Never changes the underlying stored value, just how it's shown here.
function fmtNum(n){
  var s = Number(n).toFixed(2);
  return s.replace(/\.?0+$/, "");
}

// Overview-table-only preview: shows "<markup> | <markup / 31.1035>" so you
// can see at a glance what each markup value converts to per-gram, without
// this touching the real /admin/save payload, the live price calculation,
// or anything client-facing. This is purely a display helper for this table.
function fmtOverviewCell(markup){
  var divided = truncate2(Number(markup) / 31.1035);
  return fmtNum(markup) + " | " + fmtNum(divided);
}

function renderLinkSelect(){
  var sel = document.getElementById("linkSelect");
  sel.innerHTML = STATE.links.map(function(l){return "<option value='"+esc(l.id)+"'>"+esc(l.label)+"</option>";}).join("");
  if(!currentLinkId || !STATE.links.some(function(l){return l.id===currentLinkId;})){
    currentLinkId = STATE.links.length ? STATE.links[0].id : null;
  }
  sel.value = currentLinkId;
}

function renderRows(){
  var link = STATE.links.find(function(l){return l.id===currentLinkId;});
  document.getElementById("linkUrl").textContent = link ? (STATE.frontendUrl+"/?link="+link.id) : "";
  var wrap = document.getElementById("rowsWrap");
  wrap.innerHTML = "";
  STATE.products.forEach(function(p){
    var v = (STATE.markups[p.id] && STATE.markups[p.id][currentLinkId] !== undefined) ? STATE.markups[p.id][currentLinkId] : 0;
    var row = document.createElement("div");
    row.className = "row";
    var label = document.createElement("div");
    label.className = "rlabel";
    label.textContent = p.label;
    var ctrl = document.createElement("div");
    ctrl.className = "valctrl";
    var minus = document.createElement("button");
    minus.type = "button";
    minus.className = "stepbtn";
    minus.textContent = "−";
    minus.addEventListener("click", function(){ stepValue(p.id, -1); });
    var input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.setAttribute("inputmode", "decimal");
    input.id = "m_" + p.id;
    input.value = v;
    var plus = document.createElement("button");
    plus.type = "button";
    plus.className = "stepbtn";
    plus.textContent = "+";
    plus.addEventListener("click", function(){ stepValue(p.id, 1); });
    ctrl.appendChild(minus);
    ctrl.appendChild(input);
    ctrl.appendChild(plus);
    row.appendChild(label);
    row.appendChild(ctrl);
    wrap.appendChild(row);
  });
  document.getElementById("msg").textContent = "";
}

function stepValue(id, delta){
  var el = document.getElementById("m_"+id);
  if(!el) return;
  var v = Number(el.value);
  if(!Number.isFinite(v)) v = 0;
  v = Math.round((v+delta)*100)/100;
  el.value = v;
}

function renderOverview(){
  var t = document.getElementById("overviewTable");
  if(!t) return;
  var head = "<tr><th>Product</th>" + STATE.links.map(function(l){return "<th>"+esc(l.label)+"</th>";}).join("") + "</tr>";
  var body = STATE.products.map(function(p){
    var cells = STATE.links.map(function(l){
      var v = (STATE.markups[p.id] && STATE.markups[p.id][l.id] !== undefined) ? STATE.markups[p.id][l.id] : 0;
      return "<td>"+esc(fmtOverviewCell(v))+"</td>";
    }).join("");
    return "<tr><td>"+esc(p.label)+"</td>"+cells+"</tr>";
  }).join("");
  t.innerHTML = head + body;
}

function onLinkChange(){
  currentLinkId = document.getElementById("linkSelect").value;
  renderRows();
}

function unlock(){
  var input = document.getElementById("pwInput");
  var key = input.value;
  var err = document.getElementById("pwErr");
  var btn = document.getElementById("unlockBtn");
  err.textContent = "";
  if(!key){ err.textContent = "Please enter the password."; return; }
  btn.disabled = true; btn.textContent = "Checking…";
  fetch("/admin/data", { headers: {"x-admin-key":key} }).then(function(r){
    if(r.status===401){
      err.textContent = "Incorrect password. Please try again.";
      btn.disabled = false; btn.textContent = "Unlock";
      input.value = ""; input.focus();
      return null;
    }
    return r.json();
  }).then(function(d){
    if(!d) return;
    if(!d.ok){ err.textContent = "Failed to load. Please try again."; btn.disabled=false; btn.textContent="Unlock"; return; }
    ADMIN_KEY_VAL = key;
    STATE.products = d.products;
    STATE.links = d.links;
    STATE.markups = d.markups;
    STATE.frontendUrl = d.frontendUrl;
    document.getElementById("gatePanel").style.display = "none";
    document.getElementById("appPanel").style.display = "block";
    renderLinkSelect();
    renderRows();
    renderOverview();
  }).catch(function(){
    err.textContent = "Network error. Please try again.";
    btn.disabled = false; btn.textContent = "Unlock";
  });
}

async function save(){
  if(!ADMIN_KEY_VAL) return;
  var markups = {};
  STATE.products.forEach(function(p){
    var el = document.getElementById("m_"+p.id);
    if(el) markups[p.id] = Number(el.value)||0;
  });
  var r = await fetch("/admin/save", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-admin-key":ADMIN_KEY_VAL},
    body: JSON.stringify({linkId: currentLinkId, markups: markups})
  });
  var d = await r.json();
  var msg = document.getElementById("msg");
  msg.textContent = d.message || (d.ok?"Saved.":"Failed.");
  msg.style.color = d.ok ? "#0d8a56" : "#c23246";
  if(d.ok){
    STATE.products.forEach(function(p){
      if(!STATE.markups[p.id]) STATE.markups[p.id]={};
      if(markups[p.id]!==undefined) STATE.markups[p.id][currentLinkId]=markups[p.id];
    });
    renderOverview();
  }
}
</script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/health") {
    return sendJson(res, { ok:true, upstreamConnected:latest.connected, tokenPresent:Boolean(TOKEN), bidAvailable:latest.bid !== null, linksConfigured:LINKS.length });
  }

  if (url.pathname === "/api/price") {
    if (latest.bid === null || latest.gramSourceAsk === null) {
      return sendJson(res, { ok:false, connected:latest.connected });
    }

    const linkId = resolveLinkId(url.searchParams.get("link"));
    if (linkId === null) {
      // No ?link= param, or an unrecognized/mistyped one. Never fall back to
      // 0-markup "main" here - show a clear error instead so a wrong link
      // never silently displays rates.
      return sendJson(res, {
        ok:false,
        invalidLink:true,
        message:"This link is invalid or incomplete. Please check the link and try again, or ask your provider for the correct link."
      });
    }
    const rows = calculateRows(linkId);
    return sendJson(res, {
      ok:true,
      connected:latest.connected,
      link:linkId,
      rows,
      marketDirection:latest.marketDirection,
      updatedAt:latest.updatedAt
    });
  }

  if (url.pathname === "/admin") {
    if (!ADMIN_KEY) {
      res.writeHead(503, {"Content-Type":"text/plain; charset=utf-8"});
      return res.end("Admin is disabled. Set ADMIN_KEY in Render Environment Variables.");
    }
    // No key in the URL anymore - the page itself only shows a password box.
    // The password is checked against /admin/data (x-admin-key header) once
    // typed in, so a leaked /admin link on its own grants no access.
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(adminPage());
  }

  if (url.pathname === "/admin/data") {
    // Requires the same x-admin-key header as /admin/save. Without this
    // check, anyone who finds this URL could read every link's markup
    // without ever knowing ADMIN_KEY.
    if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res,{ok:false,message:"Unauthorized"},401);
    return sendJson(res,{ ok:true, products:PRODUCTS, links:LINKS, markups:MARKUPS, frontendUrl:FRONTEND_URL });
  }

  if (url.pathname === "/admin/save" && req.method === "POST") {
    if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res,{ok:false,message:"Unauthorized"},401);
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        // /admin can only change markup VALUES for rows/links that already
        // exist in PRODUCTS/LINKS (defined in this file). It can never add,
        // rename or delete a row or link - that's a code change, done here
        // in server.js and deployed, on purpose.
        const linkId = String(parsed.linkId || "").trim();
        const link = LINKS.find(l => l.id === linkId);
        if (!link) throw new Error("Unknown link id: " + linkId);
        if (!parsed.markups || typeof parsed.markups !== "object") throw new Error("Invalid markups");

        const updates = [];
        for (const p of PRODUCTS) {
          if (!(p.id in parsed.markups)) continue;
          const markup = Number(parsed.markups[p.id]);
          if (!Number.isFinite(markup) || markup < -100000 || markup > 100000) {
            throw new Error("Invalid markup for " + p.label);
          }
          updates.push([p.id, markup]);
        }
        if (updates.length === 0) throw new Error("Nothing to update");

        updates.forEach(([pid, markup]) => {
          if (!MARKUPS[pid]) MARKUPS[pid] = {};
          MARKUPS[pid][linkId] = markup;
        });
        saveMarkupsToStore();

        const persistNote = MARKUP_STORE_URL
          ? "Live now, and saved so it survives restarts."
          : "Live now. Note: Render restarts reset this (persistent storage isn't configured yet).";
        return sendJson(res, { ok:true, message: "Saved " + updates.length + " row(s) for " + link.label + ". " + persistNote });
      } catch (e) { return sendJson(res, { ok:false, message:e.message }, 400); }
    });
    return;
  }

  if (url.pathname === "/") {
    return sendJson(res, { ok:true, service:"price-api" });
  }

  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("Not found");
});

function startUpstream(){
  if(!TOKEN){console.log("[RELAY] WFBULLION_TOKEN is missing.");return;}
  console.log("[RELAY] Starting WFBullion connection...");
  console.log("[RELAY] Token present: YES");
  const socket=io(WF_SERVER+"/bquote",{transports:["polling","websocket"],query:{token:TOKEN},reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:15000,rejectUnauthorized:false,extraHeaders:{Origin:"https://www.wfbullion.com",Referer:"https://www.wfbullion.com/en-us"}});
  socket.on("connect",()=>{latest.connected=true;console.log("[RELAY] WFBullion CONNECTED");console.log("[RELAY] Socket ID: "+socket.id)});
  socket.on("quote.realtime",data=>{const products=data&&data.products;if(!products)return;const xau=products["XAU="];let gramProduct=null;for(const [key,p] of Object.entries(products)){const vals=[key,p&&p.id,p&&p.mf_id,p&&p.prod_code,p&&p.name&&p.name.enUS];if(vals.some(v=>v!=null&&String(v).toLowerCase().replace(/[^a-z0-9]/g,"")==="p1kkgg")){gramProduct=p;break}}if(xau){const bid=parseFloat(xau.sell);if(Number.isFinite(bid)){if(latest.bid!==null){if(bid>latest.bid)latest.marketDirection="up";else if(bid<latest.bid)latest.marketDirection="down";else latest.marketDirection="same"}latest.bid=bid}}if(gramProduct){const ask=parseFloat(gramProduct.sell);if(Number.isFinite(ask))latest.gramSourceAsk=ask}const hkdProduct=products["HKD="];if(hkdProduct){const hkdSell=parseFloat(hkdProduct.sell);if(Number.isFinite(hkdSell))latest.hkdSell=hkdSell}if(latest.bid!==null)latest.updatedAt=new Date().toISOString()});
  socket.on("disconnect",reason=>{latest.connected=false;console.log("[RELAY] WFBullion DISCONNECTED: "+reason)});
  socket.on("connect_error",e=>{latest.connected=false;console.log("[RELAY] WFBullion CONNECT_ERROR: "+e.message)});
}
// Load any saved markups before accepting traffic, so the very first
// requests already reflect your last-saved values instead of a brief
// moment of the server.js defaults.
loadMarkupsFromStore().finally(() => {
  server.listen(PORT,"0.0.0.0",()=>{console.log("[RELAY] Server listening on port "+PORT);startUpstream()});
});

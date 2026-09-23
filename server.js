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
  { id: "p200-399",  label: "200 - 399 Grams",  unitMultiplier: 1 },
  { id: "p400-999",  label: "400 - 999 Grams",  unitMultiplier: 1 },
  { id: "p1000",     label: "1000 Grams",       unitMultiplier: 1 }
];

const LINKS = [
  { id: "link1", label: "D1" },
  { id: "link2", label: "T2" },
  { id: "link3", label: "M3" },
  { id: "link4", label: "C4" }
];

const MARKUPS = {
  "tael":     { link1: 20.00, link2: 21.00, link3: 19.00, link4: 22.00},
  "p75-199":  { link1: 17.00, link2: 18.00, link3: 16.00, link4: 19.00},
  "p200-399": { link1: 12.00, link2: 13.00, link3: 11.00, link4: 14.00},
  "p400-999": { link1:  9.00, link2: 10.00, link3:  8.00, link4: 11.00},
  "p1000":    { link1:  5.00, link2:  6.00, link3:  4.00, link4:  7.00}
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

function resolveLinkId(raw) {
  if (!raw) return MAIN_LINK_ID;
  return LINKS.some(l => l.id === raw) ? raw : MAIN_LINK_ID;
}

function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markup Settings</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px 14px 60px;color:#1a2b3c}
.wrap{max-width:1200px;margin:auto}
h1{margin:0 0 4px}
.sub{color:#5c6b7a;margin:0 0 22px;font-size:14px}
.panel{background:#fff;border:1px solid #e3d8b8;border-radius:16px;padding:20px;box-shadow:0 10px 28px rgba(0,0,0,.06);margin-bottom:20px;overflow-x:auto}
.mainlink{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px}
.mainlink code{background:#f0f4f8;padding:6px 10px;border-radius:8px;font-size:13px}
table{border-collapse:collapse;width:100%;min-width:760px}
th,td{border:1px solid #e2e8ee;padding:8px;text-align:left;vertical-align:top}
th{background:#0b69bf;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
input[type=text],input[type=number]{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box}
.rowlabelcell{min-width:190px}
.linkcell{min-width:170px}
.linkurl{font-size:11px;color:#5c6b7a;word-break:break-all;margin-top:6px}
.del{background:#e05260;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;margin-top:8px}
.addbtn{background:#0b69bf;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;margin:6px 10px 0 0}
.savebtn{background:#c59a22;color:#fff;border:0;border-radius:9px;padding:12px 22px;font-weight:700;font-size:16px;cursor:pointer;margin-top:16px}
.msg{margin-top:14px;font-weight:700}
.hint{font-size:11px;color:#8a97a6;margin-top:6px}
</style></head><body><div class="wrap">
<h1>Markup Settings</h1>
<p class="sub">Edit product rows, client links and each link's markup below, then Save All Changes. Markups never appear on any client-facing page.</p>
<div class="panel">
<div class="mainlink"><b>Main link (always 0.00 markup, not editable here):</b> <code id="mainUrl">-</code></div>
</div>
<div class="panel">
<div id="tableWrap">Loading&hellip;</div>
<button class="addbtn" onclick="addRow()" type="button">+ Add Product Row</button>
<button class="addbtn" onclick="addLink()" type="button">+ Add Client Link</button>
<br><button class="savebtn" onclick="save()" type="button">Save All Changes</button>
<div id="msg" class="msg"></div>
</div>
</div>
<script>
var STATE={products:[],links:[],markups:{},frontendUrl:""};
var URL_KEY = new URLSearchParams(location.search).get("key") || "";

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function slugify(s){var v=String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");return v||"item";}
function uniqueId(base,taken){var id=slugify(base),n=1;while(taken.indexOf(id)>=0){n++;id=slugify(base)+"-"+n;}return id;}

function render(){
  document.getElementById("mainUrl").textContent = STATE.frontendUrl + "/";
  var html = "<table><thead><tr><th>Product Row</th><th>Unit &times; (1 = gram, 37.429 = tael)</th>";
  STATE.links.forEach(function(l,li){
    html += "<th class='linkcell'>" +
      "<input type='text' value='"+esc(l.label)+"' onchange='setLinkLabel("+li+",this.value)'>" +
      "<div class='linkurl'>"+esc(STATE.frontendUrl)+"/?link="+esc(l.id)+"</div>" +
      "<input type='text' value='"+esc(l.id)+"' class='hint' style='margin-top:6px' onchange='setLinkId("+li+",this.value)'>" +
      "<button class='del' type='button' onclick='removeLink("+li+")'>Delete Link</button>" +
      "</th>";
  });
  html += "</tr></thead><tbody>";
  STATE.products.forEach(function(p,pi){
    html += "<tr><td class='rowlabelcell'>" +
      "<input type='text' value='"+esc(p.label)+"' onchange='setProductLabel("+pi+",this.value)'>" +
      "<button class='del' type='button' onclick='removeRow("+pi+")'>Delete Row</button>" +
      "</td><td><input type='number' step='0.001' value='"+p.unitMultiplier+"' onchange='setProductMultiplier("+pi+",this.value)'></td>";
    STATE.links.forEach(function(l){
      var v = (STATE.markups[p.id] && STATE.markups[p.id][l.id] !== undefined) ? STATE.markups[p.id][l.id] : 0;
      html += "<td><input type='number' step='0.01' value='"+v+"' onchange='setMarkup(\\""+p.id+"\\",\\""+l.id+"\\",this.value)'></td>";
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  document.getElementById("tableWrap").innerHTML = html;
}

function setProductLabel(i,v){STATE.products[i].label=v;}
function setProductMultiplier(i,v){STATE.products[i].unitMultiplier=Number(v)||1;}
function setLinkLabel(i,v){STATE.links[i].label=v;render();}
function setLinkId(i,v){
  var taken = STATE.links.filter(function(_,idx){return idx!==i;}).map(function(l){return l.id;}).concat(["main"]);
  var oldId = STATE.links[i].id;
  var newId = uniqueId(v, taken);
  STATE.links[i].id = newId;
  Object.keys(STATE.markups).forEach(function(pid){
    if(STATE.markups[pid] && Object.prototype.hasOwnProperty.call(STATE.markups[pid], oldId)){
      STATE.markups[pid][newId] = STATE.markups[pid][oldId];
      if(newId!==oldId) delete STATE.markups[pid][oldId];
    }
  });
  render();
}
function setMarkup(pid,lid,v){
  if(!STATE.markups[pid]) STATE.markups[pid]={};
  STATE.markups[pid][lid]=Number(v)||0;
}

function addRow(){
  var label = prompt("New row label (e.g. 2000 Grams):");
  if(label===null || !label.trim()) return;
  var existingIds = STATE.products.map(function(p){return p.id;});
  var id = uniqueId(label, existingIds);
  STATE.products.push({id:id,label:label.trim(),unitMultiplier:1});
  STATE.markups[id]={};
  STATE.links.forEach(function(l){STATE.markups[id][l.id]=0;});
  render();
}
function removeRow(i){
  if(!confirm("Delete this row?")) return;
  var id = STATE.products[i].id;
  STATE.products.splice(i,1);
  delete STATE.markups[id];
  render();
}
function addLink(){
  var label = prompt("New client link name (e.g. LINK_6):");
  if(label===null || !label.trim()) return;
  var existingIds = STATE.links.map(function(l){return l.id;}).concat(["main"]);
  var id = uniqueId(label, existingIds);
  STATE.links.push({id:id,label:label.trim()});
  STATE.products.forEach(function(p){
    if(!STATE.markups[p.id]) STATE.markups[p.id]={};
    STATE.markups[p.id][id]=0;
  });
  render();
}
function removeLink(i){
  if(!confirm("Delete this link? Its shared URL will stop giving marked-up rates.")) return;
  var id = STATE.links[i].id;
  STATE.links.splice(i,1);
  Object.keys(STATE.markups).forEach(function(pid){ if(STATE.markups[pid]) delete STATE.markups[pid][id]; });
  render();
}

async function load(){
  var r = await fetch("/admin/data", { headers: URL_KEY ? {"x-admin-key":URL_KEY} : {} });
  if(r.status===401){ document.getElementById("tableWrap").innerHTML="Unauthorized. Open this page as <code>/admin?key=YOUR_ADMIN_KEY</code>."; return; }
  var d = await r.json();
  if(!d.ok){ document.getElementById("tableWrap").textContent="Failed to load."; return; }
  STATE.products = d.products;
  STATE.links = d.links;
  STATE.markups = d.markups;
  STATE.frontendUrl = d.frontendUrl;
  render();
}

async function save(){
  var key = URL_KEY || prompt("Enter ADMIN_KEY");
  if(key===null || key==="") return;
  var r = await fetch("/admin/save", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-admin-key":key},
    body: JSON.stringify({products:STATE.products, links:STATE.links, markups:STATE.markups})
  });
  var d = await r.json();
  var msg = document.getElementById("msg");
  msg.textContent = d.message || (d.ok?"Saved.":"Failed.");
  msg.style.color = d.ok ? "#0d8a56" : "#c23246";
  if(d.ok) load();
}

load();
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
    if (url.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(401, {"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
      return res.end("Unauthorized. Open this page as /admin?key=YOUR_ADMIN_KEY");
    }
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
    req.on("data", chunk => { body += chunk; if (body.length > 300000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed.products) || parsed.products.length < 1 || parsed.products.length > 40) {
          throw new Error("Invalid products (need 1-40 rows)");
        }
        if (!Array.isArray(parsed.links) || parsed.links.length > 40) {
          throw new Error("Invalid links (max 40)");
        }

        const seenProductIds = new Set();
        const newProducts = parsed.products.map((p, i) => {
          const id = String(p.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
          const label = String(p.label || "").trim().slice(0, 80);
          const unitMultiplier = Number(p.unitMultiplier);
          if (!id) throw new Error("Row " + (i + 1) + " is missing an id");
          if (seenProductIds.has(id)) throw new Error("Duplicate row id: " + id);
          seenProductIds.add(id);
          if (!label) throw new Error("Row " + (i + 1) + " is missing a label");
          if (!Number.isFinite(unitMultiplier) || unitMultiplier <= 0 || unitMultiplier > 100000) {
            throw new Error("Row " + (i + 1) + " has an invalid unit multiplier");
          }
          return { id, label, unitMultiplier };
        });

        const seenLinkIds = new Set(["main"]);
        const newLinks = parsed.links.map((l, i) => {
          const id = String(l.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
          const label = String(l.label || "").trim().slice(0, 60);
          if (!id) throw new Error("Link " + (i + 1) + " is missing an id");
          if (id === "main") throw new Error("'main' is reserved and cannot be used as a link id");
          if (seenLinkIds.has(id)) throw new Error("Duplicate link id: " + id);
          seenLinkIds.add(id);
          if (!label) throw new Error("Link " + (i + 1) + " is missing a label");
          return { id, label };
        });

        const newMarkups = {};
        newProducts.forEach(p => {
          newMarkups[p.id] = {};
          newLinks.forEach(l => {
            const raw = (parsed.markups && parsed.markups[p.id] && parsed.markups[p.id][l.id] !== undefined)
              ? parsed.markups[p.id][l.id] : 0;
            const markup = Number(raw);
            if (!Number.isFinite(markup) || markup < -100000 || markup > 100000) {
              throw new Error("Invalid markup for " + p.id + " / " + l.id);
            }
            newMarkups[p.id][l.id] = markup;
          });
        });

        PRODUCTS.length = 0; PRODUCTS.push(...newProducts);
        LINKS.length = 0; LINKS.push(...newLinks);
        Object.keys(MARKUPS).forEach(k => delete MARKUPS[k]);
        Object.assign(MARKUPS, newMarkups);

        return sendJson(res, { ok:true, message: "Saved. " + newLinks.length + " link(s) and " + newProducts.length + " row(s) active now. Note: Render restarts reset in-memory changes." });
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
server.listen(PORT,"0.0.0.0",()=>{console.log("[RELAY] Server listening on port "+PORT);startUpstream()});

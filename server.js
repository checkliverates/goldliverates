const http = require("http");
const io = require("socket.io-client");

const PORT = process.env.PORT || 10000;
const WF_SERVER = "https://quote.wfgroup.com.hk:8083";
const TOKEN = process.env.WFBULLION_TOKEN || "";

// ============================================================
// PRODUCT / MARKUP SETTINGS
// Change these values when you want to change daily markups.
// Markup is NEVER sent to the browser.
// ============================================================
const PRODUCTS = [
  { label: "75 - 199 Grams",  markup: 17.00 },
  { label: "200 - 399 Grams", markup: 12.00 },
  { label: "400 - 999 Grams", markup:  9.00 },
  { label: "1000 Grams",      markup:  5.00 },
  { label: "",                markup:  0.00 }
];

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ADMIN_STATE = PRODUCTS.map(p => ({ label: p.label, markup: p.markup }));

let latest = {
  bid: null,
  gramSourceAsk: null,
  updatedAt: null,
  connected: false
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

function calculateRows() {
  if (latest.bid === null) return [];
  return ADMIN_STATE.map((p, i) => {
    if (!p.label) return { index: i, label: "", rate: null };
    const rate = truncate2((latest.bid + Number(p.markup)) / 31.1035);
    return { index: i, label: p.label, rate };
  });
}

function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markup Settings</title>
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}</style></head><body><div class="box"><h1>Daily Markup Settings</h1><p>These values stay on the server and are not displayed on the client price page.</p><div id="rows"></div><button onclick="save()">Save Markup</button><div id="msg" class="msg"></div></div>
<script>async function load(){const r=await fetch('/admin/data');const d=await r.json();document.getElementById('rows').innerHTML=d.products.map((p,i)=>'<div class="row"><input id="l'+i+'" value="'+String(p.label).replaceAll('"','&quot;')+'"><input id="m'+i+'" type="number" step="0.01" value="'+p.markup+'"></div>').join('')}async function save(){const products=Array.from({length:5},(_,i)=>({label:document.getElementById('l'+i).value,markup:Number(document.getElementById('m'+i).value)}));const key=prompt('Enter ADMIN_KEY');if(key===null)return;const r=await fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({products})});const d=await r.json();document.getElementById('msg').textContent=d.message||'Saved';}load();</script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/health") {
    return sendJson(res, { ok:true, upstreamConnected:latest.connected, tokenPresent:Boolean(TOKEN), bidAvailable:latest.bid !== null });
  }

  if (url.pathname === "/api/price") {
    if (latest.bid === null || latest.gramSourceAsk === null) {
      return sendJson(res, { ok:false, connected:latest.connected });
    }

    const rows = calculateRows();
    return sendJson(res, {
      ok:true,
      connected:latest.connected,
      bid:latest.bid,
      rows,
      updatedAt:latest.updatedAt
    });
  }

  if (url.pathname === "/admin") {
    if (!ADMIN_KEY) {
      res.writeHead(503, {"Content-Type":"text/plain; charset=utf-8"});
      return res.end("Admin is disabled. Set ADMIN_KEY in Render Environment Variables.");
    }
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(adminPage());
  }

  if (url.pathname === "/admin/data") {
    if (!ADMIN_KEY) return sendJson(res,{ok:false},503);
    return sendJson(res,{ok:true,products:ADMIN_STATE});
  }

  if (url.pathname === "/admin/save" && req.method === "POST") {
    if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res,{ok:false,message:"Unauthorized"},401);
    let body="";
    req.on("data", chunk => { body += chunk; if(body.length > 100000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed=JSON.parse(body);
        if(!Array.isArray(parsed.products) || parsed.products.length !== 5) throw new Error("Invalid products");
        parsed.products.forEach((p,i)=>{
          const label=String(p.label || "").trim().slice(0,60);
          const markup=Number(p.markup);
          if(!Number.isFinite(markup) || markup < -10000 || markup > 10000) throw new Error("Invalid markup at row "+(i+1));
          ADMIN_STATE[i].label=label;
          ADMIN_STATE[i].markup=markup;
        });
        return sendJson(res,{ok:true,message:"Saved. Markups are active now. Note: Render restarts reset in-memory changes; for permanent daily settings update PRODUCTS in server.js or Render Environment Variables."});
      } catch(e) { return sendJson(res,{ok:false,message:e.message},400); }
    });
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(page());
  }

  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("Not found");
});

function page() {
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live Gold Rates</title>
<style>
:root{--gold:#c59a22;--black:#050505;--text:#171717;--card:#fff}*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:radial-gradient(circle at top,#fffdf5 0,#f7f7f7 45%,#eeeeee 100%);font-family:Arial,Helvetica,sans-serif;color:var(--text);padding:28px 16px 34px}.dashboard{width:min(900px,100%);margin:auto}.date-card{background:var(--card);border:1px solid var(--gold);border-radius:18px;padding:22px 24px;text-align:center;box-shadow:0 10px 28px rgba(0,0,0,.08)}.date{font-size:clamp(32px,6vw,58px);line-height:1;font-weight:800}.live-row{display:flex;align-items:center;justify-content:center;gap:10px;margin:18px 0 22px;font-size:clamp(18px,3vw,27px);font-weight:700}.hk-flag{font-family:"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif;font-size:1.05em;line-height:1}.quote-card{overflow:hidden;border-radius:17px;background:var(--black);box-shadow:0 12px 30px rgba(0,0,0,.18)}.quote-head,.quote-row{display:grid;grid-template-columns:1fr 1.35fr;align-items:center}.quote-head{background:linear-gradient(135deg,var(--gold),#b18b1c);color:#fff;font-weight:800;font-size:clamp(19px,3vw,28px);padding:18px 22px}.quote-row{color:#ffff00;padding:19px 22px;min-height:74px;border-top:1px solid rgba(255,255,255,.24)}.product{font-size:clamp(18px,3vw,27px);font-weight:800}.prices{text-align:right;font-size:clamp(22px,4vw,34px);font-weight:800;white-space:nowrap}.quote-row.updated .prices{animation:flash .35s ease}@keyframes flash{0%{opacity:.35;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}.notes-section{margin-top:34px}.notes-title-row{display:flex;align-items:center;gap:14px;margin-bottom:14px}.notes-line{height:2px;background:linear-gradient(90deg,transparent,var(--gold));flex:1}.notes-line.right{background:linear-gradient(90deg,var(--gold),transparent)}.notes-title{background:linear-gradient(135deg,var(--gold),#b18b1c);color:#fff;border-radius:999px;padding:11px 22px;font-size:21px;font-weight:800;white-space:nowrap}.notes-card{background:rgba(255,255,255,.92);border:1px solid var(--gold);border-radius:17px;padding:8px 24px;box-shadow:0 8px 22px rgba(0,0,0,.06)}.note{display:flex;gap:14px;padding:18px 0;font-size:18px;line-height:1.45}.note+.note{border-top:1px dashed var(--gold)}.note-dot{width:11px;height:11px;margin-top:7px;flex:0 0 11px;border-radius:50%;background:var(--gold)}.footer{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:25px;color:#555;font-size:15px}.footer-icon{width:32px;height:32px;border:3px solid var(--gold);border-radius:50%;position:relative}.footer-icon:before{content:"";position:absolute;width:2px;height:9px;background:var(--gold);left:13px;top:5px}.footer-icon:after{content:"";position:absolute;width:8px;height:2px;background:var(--gold);left:13px;top:14px;transform:rotate(25deg);transform-origin:left center}@media(max-width:620px){body{padding:16px 10px 24px}.date-card{padding:18px 12px;border-radius:14px}.live-row{gap:8px;margin:14px 0 17px}.quote-head{padding:15px 13px}.quote-row{padding:17px 13px;min-height:70px}.prices{font-size:clamp(18px,5vw,27px)}.product{font-size:clamp(16px,4.4vw,23px)}.notes-card{padding:5px 16px}.note{font-size:16px;padding:15px 0}}@media(max-width:420px){.quote-head,.quote-row{grid-template-columns:1fr 1.5fr}.quote-head{font-size:18px}.prices{font-size:19px}}
</style></head><body><main class="dashboard"><section class="date-card"><div id="date" class="date">--</div></section><div class="live-row"><span class="hk-flag">🇭🇰</span><span id="time">--:--:-- -- HKT</span></div><section class="quote-card"><div class="quote-head"><div>Product (999.9)</div><div style="text-align:right">USD Rate / Gram</div></div><div id="rows"></div></section><section class="notes-section"><div class="notes-title-row"><div class="notes-line"></div><div class="notes-title">📝 Booking Rule:</div><div class="notes-line right"></div></div><div class="notes-card"><div class="note"><span class="note-dot"></span><span>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</span></div><div class="note"><span class="note-dot"></span><span>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</span></div><div class="note"><span class="note-dot"></span><span>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</span></div><div class="note"><span class="note-dot"></span><span>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</span></div></div></section><div class="footer"><span class="footer-icon"></span><span>Prices update in real-time</span></div></main>
<script>(()=>{let last="";function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];date.textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);time.textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>x.label?'<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(x.rate===null?"---":Number(x.rate).toFixed(2))+'</div></div>':"").join("");const cur=JSON.stringify(rows);if(cur!==last){document.querySelectorAll(".quote-row").forEach(e=>{e.classList.remove("updated");void e.offsetWidth;e.classList.add("updated")});last=cur}}catch(e){}}function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
}

function startUpstream(){
  if(!TOKEN){console.log("[RELAY] WFBULLION_TOKEN is missing.");return;}
  console.log("[RELAY] Starting WFBullion connection...");
  console.log("[RELAY] Token present: YES");
  const socket=io(WF_SERVER+"/bquote",{transports:["polling","websocket"],query:{token:TOKEN},reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:15000,rejectUnauthorized:false,extraHeaders:{Origin:"https://www.wfbullion.com",Referer:"https://www.wfbullion.com/en-us"}});
  socket.on("connect",()=>{latest.connected=true;console.log("[RELAY] WFBullion CONNECTED");console.log("[RELAY] Socket ID: "+socket.id)});
  socket.on("quote.realtime",data=>{const products=data&&data.products;if(!products)return;const xau=products["XAU="];let gramProduct=null;for(const [key,p] of Object.entries(products)){const vals=[key,p&&p.id,p&&p.mf_id,p&&p.prod_code,p&&p.name&&p.name.enUS];if(vals.some(v=>v!=null&&String(v).toLowerCase().replace(/[^a-z0-9]/g,"")==="p1kkgg")){gramProduct=p;break}}if(xau){const bid=parseFloat(xau.buy);if(Number.isFinite(bid))latest.bid=bid}if(gramProduct){const ask=parseFloat(gramProduct.sell);if(Number.isFinite(ask))latest.gramSourceAsk=ask}if(latest.bid!==null)latest.updatedAt=new Date().toISOString()});
  socket.on("disconnect",reason=>{latest.connected=false;console.log("[RELAY] WFBullion DISCONNECTED: "+reason)});
  socket.on("connect_error",e=>{latest.connected=false;console.log("[RELAY] WFBullion CONNECT_ERROR: "+e.message)});
}
server.listen(PORT,"0.0.0.0",()=>{console.log("[RELAY] Server listening on port "+PORT);startUpstream()});

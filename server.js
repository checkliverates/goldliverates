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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0b0c"><title>Live Gold Rates</title>
<style>
:root{--gold:#c99a22;--gold2:#e0b83f;--gold3:#f4d77d;--black:#080808;--ink:#171717;--muted:#6f6f73;--paper:#f5f3ee;--white:#fff;--line:#dedbd2}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:radial-gradient(circle at 50% -10%,#fff 0,#f8f6f1 34%,#ebe8e0 100%);font-family:Arial,Helvetica,sans-serif;color:var(--ink);padding:22px 14px 36px}.dashboard{width:min(980px,100%);margin:auto}
/* ===== HERO ===== */
.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#0a0a0b,#17130a 55%,#080808);color:#fff;border:1px solid #9e7614;border-radius:28px;padding:24px 28px 22px;box-shadow:0 18px 45px rgba(0,0,0,.20)}
.hero:before{content:"";position:absolute;width:260px;height:260px;border-radius:50%;right:-120px;top:-145px;background:radial-gradient(circle,rgba(224,184,63,.26),transparent 68%)}
.hero:after{content:"";position:absolute;left:-120px;bottom:-150px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(201,154,34,.15),transparent 68%)}
.hero-inner{position:relative;z-index:1;display:grid;grid-template-columns:1fr auto;gap:22px;align-items:center}.brand{display:flex;align-items:center;gap:14px}.brand-mark{width:48px;height:48px;border-radius:15px;background:linear-gradient(145deg,var(--gold2),#9b6f0b);display:grid;place-items:center;font-size:24px;box-shadow:0 8px 20px rgba(201,154,34,.25)}.eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#d9d9d9;font-weight:700}.hero-title{font-size:clamp(22px,4vw,32px);font-weight:900;margin-top:3px}.hero-right{text-align:right}.date{font-size:clamp(22px,4vw,34px);font-weight:900;letter-spacing:-.5px}.time-row{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:7px;font-size:clamp(15px,2.4vw,19px);font-weight:800;color:#f0f0f0}.hk-flag{width:23px;height:16px;display:inline-flex;flex:0 0 auto}.hk-flag svg{width:23px;height:16px;display:block}.live-badge{display:inline-flex;align-items:center;gap:7px;margin-top:13px;padding:7px 12px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.07);font-size:12px;font-weight:800;letter-spacing:.8px}.live-dot{width:7px;height:7px;border-radius:50%;background:#58d27c;box-shadow:0 0 0 4px rgba(88,210,124,.12)}
/* ===== RATE CARD ===== */
.rate-card{margin-top:20px;border-radius:25px;overflow:hidden;background:var(--black);box-shadow:0 18px 42px rgba(0,0,0,.18);border:1px solid #171717}.rate-head{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(190px,.8fr);background:linear-gradient(135deg,var(--gold2),var(--gold));color:#fff;padding:18px 23px;font-size:clamp(17px,2.7vw,24px);font-weight:900}.rate-head .right{text-align:right}.rate-body{background:linear-gradient(180deg,#090909,#030303)}.quote-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(190px,.8fr);align-items:center;min-height:78px;padding:16px 23px;color:#fff}.quote-row+.quote-row{border-top:1px solid #303030}.product{font-size:clamp(17px,2.7vw,23px);font-weight:800;line-height:1.25}.prices{text-align:right;font-size:clamp(25px,4vw,36px);font-weight:900;white-space:nowrap;letter-spacing:-.7px;color:#fff600}.quote-row.updated .prices{animation:pricePulse .42s ease}@keyframes pricePulse{0%{opacity:.3;transform:translateY(2px) scale(.98)}100%{opacity:1;transform:none}}
/* ===== INFO STRIP ===== */
.info-strip{margin-top:15px;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 15px;border:1px solid #d9c07a;background:#fffaf0;border-radius:14px;color:#5e522f;font-size:13px}.info-left{display:flex;align-items:center;gap:8px;font-weight:700}.gold-dot{width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(201,154,34,.12)}.refresh{font-size:12px;color:#81775d}
/* ===== NOTES ===== */
.notes{margin-top:25px}.section-title{display:flex;align-items:center;gap:13px;margin-bottom:13px}.section-line{height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--gold))}.section-line.r{background:linear-gradient(90deg,var(--gold),transparent)}.section-pill{display:flex;align-items:center;gap:8px;background:var(--black);color:#fff;border:1px solid var(--gold);border-radius:999px;padding:9px 17px;font-size:16px;font-weight:900;white-space:nowrap}.section-pill span{font-size:15px}.notes-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.note-card{position:relative;background:rgba(255,255,255,.92);border:1px solid #d8d5ce;border-radius:17px;padding:17px 17px 17px 49px;box-shadow:0 7px 20px rgba(0,0,0,.06);min-height:108px}.note-num{position:absolute;left:15px;top:16px;width:25px;height:25px;border-radius:8px;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900}.note-card p{margin:0;font-size:14px;line-height:1.55;color:#303033}.note-card b{color:#111}.footer{margin-top:22px;display:flex;justify-content:center;align-items:center;gap:9px;color:#777;font-size:13px}.clock-icon{width:25px;height:25px;border:2px solid var(--gold);border-radius:50%;position:relative}.clock-icon:before{content:"";position:absolute;width:2px;height:7px;left:10px;top:4px;background:var(--gold)}.clock-icon:after{content:"";position:absolute;width:7px;height:2px;left:10px;top:11px;background:var(--gold);transform:rotate(28deg);transform-origin:left center}
@media(max-width:700px){body{padding:12px 9px 25px}.hero{border-radius:21px;padding:19px 17px}.hero-inner{grid-template-columns:1fr;gap:14px}.brand-mark{width:42px;height:42px;border-radius:13px;font-size:21px}.hero-right{text-align:left}.time-row{justify-content:flex-start}.live-badge{margin-top:10px}.rate-card{margin-top:14px;border-radius:19px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(145px,.9fr)}.rate-head{padding:14px 15px;font-size:17px}.quote-row{min-height:70px;padding:15px}.product{font-size:16px}.prices{font-size:24px}.info-strip{margin-top:11px}.notes-grid{grid-template-columns:1fr}.notes{margin-top:21px}.note-card{min-height:auto;padding:15px 15px 15px 48px}}
@media(max-width:400px){.hero-title{font-size:21px}.date{font-size:25px}.time-row{font-size:15px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(120px,.9fr)}.rate-head{font-size:15px;padding:13px 12px}.quote-row{padding:14px 12px}.product{font-size:14px}.prices{font-size:21px}.info-strip{font-size:12px}.refresh{display:none}.section-pill{font-size:15px}.note-card p{font-size:13px}}
</style></head><body><main class="dashboard">
<section class="hero"><div class="hero-inner"><div><div class="brand"><div class="brand-mark">◈</div><div><div class="eyebrow">Live Market</div><div class="hero-title">999.9 Gold Rate</div></div></div><div class="live-badge"><i class="live-dot"></i>LIVE MARKET</div></div><div class="hero-right"><div id="date" class="date">--</div><div class="time-row"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg" role="img"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15l1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55l.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05l.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="rate-card"><div class="rate-head"><div>Product (999.9)</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></section>
<div class="info-strip"><div class="info-left"><span class="gold-dot"></span><span>Rates are calculated from the live market bid.</span></div><div class="refresh">Updates automatically</div></div>
<section class="notes"><div class="section-title"><div class="section-line"></div><div class="section-pill"><span>📝</span> Booking Rules</div><div class="section-line r"></div></div><div class="notes-grid">
<div class="note-card"><span class="note-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="note-card"><span class="note-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="note-card"><span class="note-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="note-card"><span class="note-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section>
<div class="footer"><span class="clock-icon"></span><span>Prices update in real-time</span></div>
</main>
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

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
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}.lightning,.bolt,.zap,.lightning-symbol{display:none!important}

@media(max-width:600px){.header.header-datetime-only{margin:8px 5px 10px!important;padding:0 12px!important;height:82px!important;min-height:82px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;border-radius:11px!important}.header.header-datetime-only .datetime{width:auto!important;min-width:0!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}.header.header-datetime-only .date{font-size:27px!important;line-height:1!important;font-weight:800!important;color:#fff!important}.header.header-datetime-only .time{font-size:12px!important;line-height:1!important;margin-top:6px!important;color:#fff!important}.header.header-datetime-only .hkflag{width:19px!important;height:13px!important;margin-right:5px!important}.main{margin:0 5px!important;gap:9px!important}.cardbar{height:52px!important}.small-gold{width:44px!important;height:42px!important}.gold-mark{width:39px!important;height:32px!important}.gold-mark:before{left:4px!important;top:6px!important;width:30px!important;height:18px!important}.gold-mark:after{left:19px!important;top:15px!important;font-size:5.5px!important}.gold-heading{font-size:17px!important;gap:8px!important}.product-icon{width:42px!important;height:42px!important}.product-icon:after{font-size:6.5px!important}.product-wrap{gap:9px!important}.product{font-size:13px!important}.prices{font-size:19px!important}.rate-arrow{font-size:15px!important}.thead,.quote-row{grid-template-columns:1fr 112px!important}}
@media(max-width:390px){.header.header-datetime-only{height:76px!important;min-height:76px!important}.header.header-datetime-only .date{font-size:25px!important}.header.header-datetime-only .time{font-size:11px!important}.product-icon{width:39px!important;height:39px!important}.product{font-size:12px!important}.prices{font-size:18px!important}.thead,.quote-row{grid-template-columns:1fr 105px!important}}
</style></head><body><div class="box"><h1>Daily Markup Settings</h1><p>These values stay on the server and are not displayed on the client price page.</p><div id="rows"></div><button onclick="save()">Save Markup</button><div id="msg" class="msg"></div></div>
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111f"><title>Live Gold Rates</title><link rel="icon" href="data:,"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef6ff;--panel:#ffffff;--panel2:#f7fbff;--line:#d9e9f8;--muted:#6480a0;--text:#0b3f7a;--gold:#d99b1f;--gold2:#f0bd4b;--green:#19a974;--red:#e05260;--blue:#0757a6;--blue2:#1684df;--shadow:0 24px 65px rgba(22,91,153,.14)}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:linear-gradient(145deg,#eaf5ff 0%,#f7fbff 48%,#e3f1ff 100%);color:var(--text);font-family:"DM Sans",Arial,sans-serif}body{padding:24px 14px 40px;overflow-x:hidden}.page{width:min(1120px,100%);margin:auto}.shell{position:relative;overflow:hidden;border:1px solid #cfe4f7;border-radius:28px;background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(242,249,255,.99));box-shadow:var(--shadow)}.shell:before{content:"";position:absolute;width:480px;height:480px;right:-220px;top:-240px;border-radius:50%;background:radial-gradient(circle,rgba(24,132,223,.12),transparent 67%);pointer-events:none}.shell:after{content:"";position:absolute;width:400px;height:400px;left:-230px;bottom:-250px;border-radius:50%;background:radial-gradient(circle,rgba(80,174,240,.12),transparent 68%);pointer-events:none}
.header{position:relative;margin:18px;min-height:150px;padding:28px 30px;border:1px solid #c7e1f7;border-radius:22px;background:linear-gradient(135deg,#0752a0 0%,#0b69bf 52%,#1a8ce2 100%);display:flex;align-items:center;justify-content:space-between;gap:24px;overflow:hidden;box-shadow:0 14px 34px rgba(10,92,166,.18)}.header:after{content:"999.9";position:absolute;right:-12px;bottom:-44px;font-family:"Space Grotesk";font-size:150px;font-weight:700;letter-spacing:-8px;color:rgba(255,255,255,.075);pointer-events:none}.datetime{position:relative;z-index:1}.date{font-family:"Space Grotesk";font-size:40px;line-height:1;font-weight:700;letter-spacing:-1.5px;color:#fff}.time{margin-top:10px;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:rgba(255,255,255,.86);letter-spacing:.3px}.hkflag{width:22px;height:15px;flex:none;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.24)}
.market-status{position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid rgba(255,255,255,.28);border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:12px;font-weight:700;backdrop-filter:blur(8px)}.status-dot{width:8px;height:8px;border-radius:50%;background:#42e69d;box-shadow:0 0 0 5px rgba(66,230,157,.12),0 0 14px rgba(66,230,157,.55)}
.main{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(310px,.75fr);gap:18px;margin:0 18px}.card{border:1px solid #cfe4f7;border-radius:22px;background:linear-gradient(145deg,#ffffff 0%,#f8fcff 100%);box-shadow:0 15px 40px rgba(25,102,168,.11);overflow:hidden}.cardbar{height:76px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:linear-gradient(90deg,#f1f8ff,transparent)}.gold-heading{display:flex;align-items:center;gap:13px;font-family:"Space Grotesk";font-size:20px;font-weight:700;color:#0a4688}.small-gold{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;border:1px solid rgba(217,155,31,.32);background:linear-gradient(145deg,#fff7dc,#f8df9b);box-shadow:inset 0 1px rgba(255,255,255,.9),0 5px 14px rgba(180,125,22,.12)}.gold-mark{position:relative;width:36px;height:31px}.gold-mark:before{content:"";position:absolute;left:2px;top:4px;width:31px;height:20px;border-radius:5px 5px 9px 9px;transform:skewX(-18deg);background:linear-gradient(160deg,#fff1b2 0%,#e7b95e 35%,#a66c18 100%);box-shadow:inset 0 1px 1px rgba(255,255,255,.75),0 4px 8px rgba(166,108,24,.22)}.gold-mark:after{content:"999.9";position:absolute;left:12px;top:11px;color:#6d460b;font:700 6px Arial;transform:rotate(-8deg)}.trend{width:34px;height:34px;border:1px solid #cce2f7;border-radius:10px;display:grid;place-items:center;color:var(--blue2);font-size:20px;background:#f1f8ff}
.rates-inner{padding:0 12px 12px}.thead{display:grid;grid-template-columns:1fr 175px;gap:12px;padding:16px 12px 11px;color:#6c87a5;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.1px}.thead div:last-child{text-align:right}.quote-row{display:grid;grid-template-columns:1fr 175px;align-items:center;min-height:76px;padding:9px 12px;margin:7px 0;border:1px solid #e0edf8;border-radius:15px;background:#f8fbfe;transition:.2s ease}.quote-row:hover{border-color:#acd2f1;background:#f0f8ff;transform:translateY(-1px);box-shadow:0 7px 18px rgba(24,132,223,.08)}.product-wrap{display:flex;align-items:center;gap:12px;min-width:0}.product-icon{width:46px;height:46px;flex:none;display:grid;place-items:center;border-radius:13px;background:linear-gradient(145deg,#fff8e3,#f8e2a7);border:1px solid rgba(217,155,31,.24);box-shadow:0 5px 12px rgba(180,125,22,.08)}.product-icon .gold-mark{transform:scale(.9)}.product{min-width:0;color:#164f8e;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prices{display:flex;align-items:center;justify-content:flex-end;gap:8px;font-family:"Space Grotesk";font-size:24px;font-weight:700;letter-spacing:-.6px;color:#083f7d;font-variant-numeric:tabular-nums}.rate-arrow{font-family:Arial;font-size:13px;font-weight:800}.rate-arrow.up{color:var(--green)}.rate-arrow.down{color:var(--red)}.same{color:#7d98b5}
.rules-title{height:76px;padding:0 22px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);font-family:"Space Grotesk";font-size:20px;font-weight:700;color:#0a4688}.info{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;border:1px solid #b9daf4;background:#edf7ff;color:#0d70c7;font:700 19px Georgia}.rules-body{padding:8px 20px 12px}.rule{display:grid;grid-template-columns:40px 1fr;gap:12px;padding:17px 0;border-bottom:1px solid var(--line)}.rule:last-child{border-bottom:0}.rule-num{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:#edf7ff;border:1px solid #c6e2f7;color:#0b69b8;font-size:11px;font-weight:800}.rule p{margin:1px 0 0;color:#5f7897;font-size:12px;line-height:1.62}.rule b{color:#164f8e;font-weight:700}.bottom-art{height:100px;position:relative;overflow:hidden}.bottom-art:before{content:"";position:absolute;left:5%;right:5%;top:55px;height:1px;background:linear-gradient(90deg,transparent,#b8d8f2,transparent)}
@media(max-width:850px){body{padding:12px 8px 28px}.header{min-height:125px;padding:23px}.date{font-size:33px}.main{grid-template-columns:1fr}.market-status{position:absolute;right:18px;bottom:18px}.header:after{font-size:115px}.bottom-art{height:55px}}
@media(max-width:600px){body{padding:7px 5px 18px}.shell{border-radius:19px}.header{margin:8px;min-height:108px;padding:18px 17px;border-radius:16px}.date{font-size:27px;letter-spacing:-1px}.time{font-size:10px;margin-top:7px}.hkflag{width:19px;height:13px}.market-status{right:14px;bottom:14px;padding:7px 10px;font-size:10px}.status-dot{width:6px;height:6px}.main{margin:0 8px;gap:10px}.card{border-radius:16px}.cardbar{height:62px;padding:0 13px}.gold-heading{font-size:17px;gap:9px}.small-gold{width:39px;height:39px;border-radius:11px}.trend{width:30px;height:30px}.rates-inner{padding:0 7px 7px}.thead{grid-template-columns:1fr 128px;padding:13px 8px 9px;font-size:9px}.quote-row{grid-template-columns:1fr 128px;min-height:64px;padding:7px 8px;margin:5px 0;border-radius:12px}.product-wrap{gap:8px}.product-icon{width:38px;height:38px;border-radius:10px}.product-icon .gold-mark{transform:scale(.78)}.product{font-size:12px}.prices{font-size:19px;gap:6px}.rate-arrow{font-size:11px}.rules-title{height:62px;padding:0 14px;font-size:17px;gap:9px}.info{width:31px;height:31px;font-size:17px}.rules-body{padding:3px 13px 8px}.rule{grid-template-columns:34px 1fr;gap:9px;padding:12px 0}.rule-num{width:32px;height:32px;font-size:10px}.rule p{font-size:10.5px;line-height:1.55}.bottom-art{height:35px}}
@media(max-width:390px){.date{font-size:24px}.market-status{font-size:9px}.thead,.quote-row{grid-template-columns:1fr 116px}.product{font-size:11px}.prices{font-size:18px}.rules-title{font-size:16px}}
</style></head><body><div class="page"><div class="shell">
<header class="header"><div class="datetime"><div id="date" class="date">--</div><div class="time"><svg class="hkflag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 4.7c-1.9-1-3.7.5-3 2.2.45 1.1 1.7 1.5 2.8.8-1.15.15-1.85-.7-1.55-1.45.28-.67 1.08-.94 1.75-.86Z" fill="#fff"/><circle cx="9.2" cy="5.5" r=".6" fill="#fff"/><circle cx="7.4" cy="4.2" r=".6" fill="#fff"/><circle cx="6.2" cy="6.7" r=".6" fill="#fff"/><circle cx="8.8" cy="7.8" r=".6" fill="#fff"/></svg><span id="time">--:--:-- -- HKT</span></div></div><div class="market-status"><span class="status-dot"></span><span>LIVE MARKET</span></div></header>
<main class="main"><section class="card"><div class="cardbar"><div class="gold-heading"><div class="small-gold"><div class="gold-mark" aria-hidden="true"></div></div><span>Gold <span style="color:var(--gold)">(999.9)</span></span></div><div class="trend">⌁</div></div><div class="rates-inner"><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></div></section>
<section class="card"><div class="rules-title"><span class="info">i</span><span>Booking Rules / Notes</span></div><div class="rules-body"><div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div><div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div><div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div><div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></main>
<div class="bottom-art"></div></div></div><script>(()=>{let previousBid=null;function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];const currentBid=Number(d.bid);let marketArrow="";let marketCls="same";if(Number.isFinite(currentBid)&&previousBid!==null&&Number.isFinite(previousBid)){if(currentBid>previousBid){marketArrow="▲";marketCls="up"}else if(currentBid<previousBid){marketArrow="▼";marketCls="down"}}document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const arrow=marketArrow;const cls=marketCls;return '<div class="quote-row"><div class="product-wrap"><div class="product-icon"><div class="gold-mark" aria-hidden="true"></div></div><div class="product">'+escapeHtml(x.label)+'</div></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");if(Number.isFinite(currentBid))previousBid=currentBid}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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


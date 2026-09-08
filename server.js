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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eef6ff"><title>Live Gold Rates</title>
<style>:root{--blue:#0f67c8;--blue2:#2f94e4;--deep:#0b3b70;--ice:#eaf5ff;--line:#cfe2f2;--gold:#d4a72c;--up:#159d66;--down:#df4242}*{box-sizing:border-box}html,body{margin:0}body{min-height:100vh;padding:18px 12px 28px;background:#f1f7fc;color:#143d66;font-family:"Aptos","Segoe UI",Arial,sans-serif}.shell{width:min(1000px,100%);margin:auto}.hero{background:linear-gradient(120deg,#0e65c7,#3c9fe9);border-radius:18px;padding:18px 20px;color:#fff;box-shadow:0 14px 30px rgba(20,91,150,.18);position:relative;overflow:hidden}.hero:before{content:"";position:absolute;right:-50px;bottom:-100px;width:280px;height:280px;border-radius:50%;border:50px solid rgba(255,255,255,.10)}.hero:after{content:"";position:absolute;left:48%;top:-130px;width:230px;height:230px;border-radius:50%;border:1px solid rgba(255,255,255,.22)}.hero-row{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:14px}.bars{width:66px;height:62px;position:relative}.bars span{position:absolute;width:45px;height:15px;border-radius:4px;background:linear-gradient(#ffe8a0,#d2a22a);box-shadow:0 4px 7px rgba(0,0,0,.13);transform:skewY(-8deg)}.bars span:nth-child(1){left:0;top:35px}.bars span:nth-child(2){left:10px;top:23px}.bars span:nth-child(3){left:21px;top:11px}.eyebrow{font-size:10px;letter-spacing:2px;font-weight:900;opacity:.85}.title{font-family:Georgia,serif;font-size:38px;font-weight:700;line-height:1.05;margin:3px 0}.subtitle{font-size:13px;opacity:.86}.stamp{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);border-radius:14px;padding:11px 14px;min-width:205px}.date{font-size:18px;font-weight:900}.clockline{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;margin-top:6px}.flag{width:22px;height:15px}.flag svg{width:22px;height:15px;display:block}.layout{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.box{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 22px rgba(39,86,126,.09);overflow:hidden}.box-title{padding:12px 15px;border-bottom:1px solid #d7e8f5;color:#0c4f91;font-size:17px;font-weight:900;background:linear-gradient(90deg,#edf7ff,#fff);display:flex;align-items:center;gap:9px}.titleicon{width:30px;height:30px;border-radius:9px;background:#dff0ff;color:#0c72d5;display:grid;place-items:center;font-size:16px}.table{padding:12px}.thead,.row{display:grid;grid-template-columns:1.15fr .85fr}.thead{background:#0f67c8;color:#fff;border-radius:9px 9px 0 0;padding:10px 12px;font-size:11px;font-weight:900}.thead div:last-child{text-align:right}.body{border:1px solid #dbe9f4;border-top:0;border-radius:0 0 9px 9px;overflow:hidden}.row{min-height:65px;align-items:center;padding:9px 12px}.row:nth-child(even){background:#f8fbfe}.row+.row{border-top:1px solid #e4edf5}.product{font-size:15px;font-weight:800;color:#204e78}.prices{display:flex;justify-content:flex-end;align-items:center;gap:7px;color:#126fd0;font-size:24px;font-weight:900}.rate-arrow{font-size:14px}.up{color:var(--up)}.down{color:var(--down)}.rules{padding:8px 13px 11px}.rule{display:flex;gap:10px;padding:11px 2px;border-bottom:1px dashed #d9e7f2}.rule:last-child{border-bottom:0}.num{flex:0 0 31px;height:31px;border-radius:50%;display:grid;place-items:center;background:#edf7ff;color:#0d70d1;font-size:10px;font-weight:900;border:1px solid #d2e9f8}.rule p{margin:0;font-size:12px;line-height:1.52;color:#526f8a}.rule b{color:#143f69}.footer{margin-top:12px;text-align:center;color:#7990a6;font-size:11px}@media(max-width:720px){body{padding:9px 6px 18px}.hero{padding:15px;border-radius:15px}.hero-row{flex-direction:column;align-items:stretch}.brand{justify-content:center}.stamp{text-align:center}.clockline{justify-content:center}.layout{grid-template-columns:1fr;gap:10px;margin-top:10px}.title{font-size:31px}.box-title{font-size:15px}.row{min-height:59px}.prices{font-size:21px}}@media(max-width:420px){.bars{transform:scale(.78);transform-origin:left center;width:52px}.title{font-size:27px}.subtitle{font-size:11px}.thead,.row{grid-template-columns:1fr 1fr}.product{font-size:13px}.prices{font-size:19px}.rule p{font-size:11.5px}}</style></head><body><main class="shell"><header class="hero"><div class="hero-row"><div class="brand"><div class="bars"><span></span><span></span><span></span></div><div><div class="eyebrow">MARKET BOARD</div><div class="title">Live Gold Rates</div><div class="subtitle">Hong Kong live pricing</div></div></div><div class="stamp"><div id="date" class="date">--</div><div class="clockline"><span class="flag"><svg viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.2 5.1c-1.8-1.2-4 .1-3.3 2.2.4 1.4 2.2 2.1 3.3 1-1.4.4-2.5-.8-2.2-1.9.3-.8 1.4-1.2 2.2-1.3Z" fill="#fff"/><circle cx="8.4" cy="6.9" r=".75" fill="#DE2910"/><path d="m10.4 4.1.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15 1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></header><section class="layout"><section class="box"><div class="box-title"><span class="titleicon">✦</span>Gold (999.9)</div><div class="table"><div class="thead"><div>Product</div><div>Rate / Gram</div></div><div id="rows" class="body"></div></div></section><section class="box"><div class="box-title"><span class="titleicon">✓</span>Booking Rules</div><div class="rules"><div class="rule"><span class="num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></section><div class="footer">Live market • HKT</div></main><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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

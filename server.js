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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#edf7ff"><title>Live Gold Rates</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(135deg,#f7fbff,#eaf5ff);font-family:"Segoe UI",Arial,sans-serif;color:#113d6d;padding:22px}.wrap{width:min(1060px,100%);margin:auto}.hero{display:grid;grid-template-columns:1fr auto;align-items:center;background:linear-gradient(125deg,#fff,#f3faff);border:1px solid #cde5f7;border-radius:28px;padding:18px 22px;box-shadow:0 18px 38px rgba(36,105,157,.12);position:relative;overflow:hidden}.hero:before{content:"";position:absolute;width:330px;height:330px;border-radius:50%;right:20%;top:-250px;background:#dff2ff}.brand{display:flex;align-items:center;gap:17px;position:relative;z-index:1}.gold-icon{font-size:49px;width:82px;height:72px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#fff8dc,#e8b82f);box-shadow:0 8px 18px rgba(196,152,27,.2)}.title{font-size:clamp(30px,4vw,44px);font-weight:900;letter-spacing:-1.7px;color:#0b477f}.sub{color:#6985a1;font-size:14px;margin-top:2px}.clock{position:relative;z-index:1;padding:11px 16px;background:#fff;border:1px solid #cfe6f8;border-radius:17px;box-shadow:0 7px 18px rgba(28,99,149,.08)}.date{font-size:18px;font-weight:900}.time{margin-top:6px;font-size:13px;font-weight:800;color:#22527f}.hk-flag{width:20px;height:14px;vertical-align:-2px}.body{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;margin-top:17px}.rates-card{background:#fff;border:1px solid #d3e7f7;border-radius:23px;padding:12px;box-shadow:0 14px 30px rgba(33,93,139,.1)}.section-title{display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:17px;background:linear-gradient(100deg,#1674d9,#55b6f2);color:#fff;font-size:20px;font-weight:900}.section-title .gold{width:37px;height:37px;border-radius:50%;display:grid;place-items:center;background:#fff1b4;color:#b17a00}.thead,.quote-row{display:grid;grid-template-columns:1fr 165px}.thead{margin-top:12px;padding:11px 15px;background:#edf7ff;border-radius:10px;color:#1c4c78;font-size:13px;font-weight:900}.thead div:last-child{text-align:right}.quote-row{min-height:72px;align-items:center;padding:9px 15px;border-bottom:1px solid #e3eef7}.quote-row:last-child{border-bottom:0}.product{font-size:15px;font-weight:800;color:#153f6e}.prices{display:flex;justify-content:flex-end;align-items:center;gap:8px;font-size:27px;font-weight:900;color:#0878df}.rate-arrow{font-size:16px}.up{color:#0eaa6d}.down{color:#e74747}.rules{background:linear-gradient(180deg,#fff,#f8fcff);border:1px solid #d3e7f7;border-radius:23px;box-shadow:0 14px 30px rgba(33,93,139,.1);overflow:hidden}.rules-head{padding:14px 16px;background:#eaf6ff;color:#123f70;font-size:19px;font-weight:900;display:flex;align-items:center;gap:10px}.info{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#54b4f4,#126fd4);color:#fff;font-size:22px}.rules-body{padding:7px 16px}.rule{display:grid;grid-template-columns:42px 1fr;gap:12px;padding:13px 0;border-bottom:1px solid #e1edf7}.rule:last-child{border-bottom:0}.rule-num{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#1679dc;color:#fff;font-weight:900;font-size:13px}.rule p{margin:0;font-size:12.2px;line-height:1.55;color:#4b6b8a}.rule b{color:#143f6d}.foot{text-align:center;margin-top:12px;font-size:11px;color:#708aa3}@media(max-width:780px){body{padding:10px}.body{grid-template-columns:1fr}.hero{grid-template-columns:1fr;gap:12px}.clock{text-align:center}.brand{justify-content:center}}@media(max-width:520px){.thead,.quote-row{grid-template-columns:1fr 140px}.product{font-size:13px}.prices{font-size:22px}.section-title{font-size:17px}.rules-head{font-size:16px}.rule p{font-size:12px}}
</style>
</head><body><div class="wrap"><header class="hero"><div class="brand"><div class="gold-icon">🪙</div><div><div class="title">Live Gold Rates</div><div class="sub">Market Rates&nbsp;&nbsp;•&nbsp;&nbsp; Your Trusted Source</div></div></div><div class="clock"><div id="date" class="date">--</div><div class="time"><svg class="hk-flag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/></svg> <span id="time">--:--:-- -- HKT</span></div></div></header><main class="body"><section class="rates-card"><div class="section-title"><span class="gold">🪙</span><span>Gold (999.9)</span></div><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></section><section class="rules"><div class="rules-head"><span class="info">i</span><span>Booking Rules / Notes</span></div><div class="rules-body">
<div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></main><div class="foot">Live market • HKT</div></div><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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

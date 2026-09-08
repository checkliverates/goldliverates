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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eaf5ff"><title>Live Gold Rates</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100vh;
  font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;
  color:#123f76;
  background:
    radial-gradient(circle at 12% 12%,rgba(255,255,255,.95),transparent 28%),
    linear-gradient(180deg,#f7fbff 0%,#edf7ff 55%,#e5f3ff 100%);
  padding:18px 14px 22px;
}
.wrap{width:min(1120px,100%);margin:auto}

/* HEADER */
.top{
  position:relative;
  overflow:hidden;
  min-height:118px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:24px;
  padding:20px 22px;
  border:1px solid #cfe6fa;
  border-radius:22px;
  background:linear-gradient(105deg,#ffffff 0%,#f8fcff 42%,#e7f5ff 100%);
  box-shadow:0 10px 28px rgba(28,104,164,.12);
}
.top:after{
  content:"";
  position:absolute;
  width:58%;
  height:190px;
  right:-6%;
  top:-78px;
  border-radius:50%;
  border:2px solid rgba(87,169,231,.22);
  transform:rotate(-12deg);
  box-shadow:0 0 0 28px rgba(105,186,239,.10),0 0 0 58px rgba(105,186,239,.07);
  pointer-events:none;
}
.brand{display:flex;align-items:center;gap:18px;position:relative;z-index:1}
.gold-mark{
  width:96px;height:78px;position:relative;flex:0 0 96px;
  filter:drop-shadow(0 8px 8px rgba(190,129,15,.20));
}
.bar{position:absolute;display:block;border-radius:5px 5px 3px 3px;
  background:linear-gradient(145deg,#ffe887 0%,#f4b71d 48%,#c77c08 100%);
  border:1px solid rgba(171,105,0,.35);
}
.bar:after{content:"";position:absolute;left:8%;top:8%;width:84%;height:25%;
  background:linear-gradient(90deg,rgba(255,255,255,.55),transparent);border-radius:4px}
.b1{width:40px;height:25px;left:8px;bottom:9px;transform:skewY(-10deg)}
.b2{width:42px;height:27px;left:29px;bottom:10px;transform:skewY(-8deg)}
.b3{width:39px;height:24px;left:51px;bottom:9px;transform:skewY(7deg)}
.b4{width:37px;height:24px;left:23px;bottom:30px;transform:skewY(-7deg)}
.b5{width:36px;height:24px;left:45px;bottom:31px;transform:skewY(7deg)}
.b6{width:34px;height:23px;left:36px;bottom:51px;transform:skewY(1deg)}
.title{
  margin:0;
  font-family:"Georgia","Times New Roman",serif;
  font-size:clamp(30px,4.1vw,47px);
  line-height:1;
  letter-spacing:-1.2px;
  font-weight:900;
  color:#0b3f7d;
}
.sub{margin-top:9px;font-size:14px;font-weight:700;color:#5a80a7;letter-spacing:.2px}
.clock{
  position:relative;z-index:2;
  min-width:220px;
  padding:12px 16px;
  border:1px solid #cde5f8;
  border-radius:17px;
  background:rgba(255,255,255,.80);
  box-shadow:0 7px 18px rgba(34,107,161,.09);
  text-align:left;
}
.clock-line{display:flex;align-items:center;gap:10px}
.date{font-size:17px;font-weight:900;color:#173f72}
.time{margin-top:8px;font-size:13px;font-weight:900;color:#214f82}
.hk-flag{width:25px;height:18px;flex:0 0 auto}

/* MAIN */
.layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(310px,.95fr);gap:16px;margin-top:16px}
.card{
  background:rgba(255,255,255,.90);
  border:1px solid #cfe6f7;
  border-radius:20px;
  box-shadow:0 12px 28px rgba(27,91,137,.11);
  overflow:hidden;
}
.rates-head{
  height:68px;
  display:flex;align-items:center;justify-content:space-between;
  padding:0 20px;
  color:#fff;
  background:linear-gradient(100deg,#0874db 0%,#218fe8 52%,#65bff1 100%);
}
.rates-title{display:flex;align-items:center;gap:13px;font-size:21px;font-weight:900}
.gold-mini{
  width:46px;height:40px;border-radius:13px;
  display:grid;place-items:center;
  background:linear-gradient(145deg,#fff7d0,#efbd36);
  box-shadow:0 5px 12px rgba(0,65,130,.20);
  font-size:24px;
}
.trend{font-size:33px;font-weight:300;opacity:.9;letter-spacing:-7px;transform:translateY(-2px)}
.rate-inner{padding:14px 14px 12px}
.thead{
  display:grid;grid-template-columns:minmax(0,1fr) 160px;
  align-items:center;
  padding:12px 16px;
  border-radius:11px;
  background:linear-gradient(90deg,#e9f5ff,#f3faff);
  color:#17497c;font-size:13px;font-weight:900;
}
.thead div:last-child{text-align:right}
.quote-row{
  display:grid;grid-template-columns:minmax(0,1fr) 160px;
  align-items:center;
  min-height:76px;
  padding:9px 16px;
  border-bottom:1px solid #e2eef8;
}
.quote-row:last-child{border-bottom:0}
.product-wrap{display:flex;align-items:center;gap:13px;min-width:0}
.product-icon{
  width:49px;height:46px;flex:0 0 49px;
  border-radius:12px;
  display:grid;place-items:center;
  background:linear-gradient(145deg,#fffdf2,#fff1d6);
  border:1px solid #f1dfbd;
  box-shadow:0 4px 10px rgba(173,117,25,.08);
  position:relative;
}
.product-icon .mini{transform:scale(.55);transform-origin:center}
.product{font-size:16px;font-weight:900;color:#123e75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prices{display:flex;justify-content:flex-end;align-items:center;gap:10px;color:#0879df;font-size:26px;font-weight:900;letter-spacing:.2px}
.rate-arrow{font-size:18px;line-height:1}
.up{color:#12ad70}.down{color:#ef3e45}

/* RULES */
.rules-head{
  min-height:68px;
  display:flex;align-items:center;gap:11px;
  padding:0 17px;
  background:linear-gradient(90deg,#edf8ff,#f5fbff);
  color:#103f75;
  font-size:19px;font-weight:900;
}
.info{
  width:39px;height:39px;flex:0 0 39px;
  display:grid;place-items:center;
  border-radius:50%;
  background:linear-gradient(145deg,#2da1f2,#086fd5);
  color:#fff;font-size:23px;font-family:Georgia,serif;
  box-shadow:0 5px 12px rgba(9,111,213,.20);
}
.rules-body{padding:5px 17px 10px}
.rule{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #dfedf8}
.rule:last-child{border-bottom:0}
.rule-num{
  width:38px;height:38px;flex:0 0 38px;
  display:grid;place-items:center;
  border-radius:50%;
  background:linear-gradient(145deg,#2e9df0,#0871d8);
  color:#fff;font-size:13px;font-weight:900;
  box-shadow:0 4px 10px rgba(13,117,216,.16);
}
.rule p{margin:0;color:#466b91;font-size:12px;line-height:1.52}
.rule b{color:#173f6f}

/* FOOTER DECOR */
.footer-art{
  position:relative;
  height:72px;
  margin-top:10px;
  overflow:hidden;
  border-radius:0 0 18px 18px;
}
.footer-art:before{
  content:"";position:absolute;left:-5%;right:-5%;bottom:-34px;height:82px;
  background:#ccecff;
  border-radius:50% 50% 0 0/65% 65% 0 0;
}
.footer-art:after{
  content:"";position:absolute;left:-8%;right:-8%;bottom:-46px;height:82px;
  border-top:2px solid rgba(72,162,225,.25);
  border-radius:50%;
}
.city{
  position:absolute;z-index:2;bottom:0;left:50%;transform:translateX(-50%);
  width:min(390px,60%);height:43px;opacity:.30;
}
.city span{position:absolute;bottom:0;background:#68b5e9;border-radius:2px 2px 0 0}
.city .s1{left:3%;width:7%;height:20px}.city .s2{left:12%;width:8%;height:29px}
.city .s3{left:23%;width:7%;height:17px}.city .s4{left:31%;width:10%;height:35px}
.city .s5{left:43%;width:7%;height:24px}.city .s6{left:51%;width:10%;height:42px}
.city .s7{left:63%;width:7%;height:27px}.city .s8{left:72%;width:9%;height:33px}
.city .s9{left:84%;width:7%;height:21px}.city .s10{left:92%;width:6%;height:29px}
.city .tower{left:48%;width:3%;height:54px}.city .tower:before{
  content:"";position:absolute;top:-15px;left:35%;width:30%;height:17px;background:#68b5e9;border-radius:50% 50% 0 0}

/* MOBILE */
@media(max-width:820px){
  body{padding:12px 9px 16px}
  .top{min-height:105px;padding:16px;border-radius:18px}
  .layout{grid-template-columns:1fr}
  .clock{min-width:205px}
}
@media(max-width:560px){
  .top{flex-direction:column;align-items:stretch;gap:13px}
  .brand{justify-content:center}
  .gold-mark{width:76px;height:64px;flex-basis:76px;transform:scale(.85)}
  .title{font-size:31px}
  .sub{font-size:12px;margin-top:6px}
  .clock{width:100%;text-align:center}
  .clock-line{justify-content:center}
  .rates-head{height:62px;padding:0 14px}
  .rates-title{font-size:18px;gap:9px}
  .gold-mini{width:42px;height:36px}
  .trend{font-size:28px}
  .rate-inner{padding:10px}
  .thead{grid-template-columns:minmax(0,1fr) 135px;padding:11px 12px}
  .quote-row{grid-template-columns:minmax(0,1fr) 135px;min-height:70px;padding:8px 12px}
  .product-icon{width:43px;height:41px;flex-basis:43px}
  .product{font-size:14px}
  .product-wrap{gap:10px}
  .prices{font-size:23px;gap:7px}
  .rate-arrow{font-size:16px}
  .rules-head{min-height:60px;font-size:17px}
  .rule{gap:10px;padding:12px 0}
}
@media(max-width:390px){
  .title{font-size:28px}
  .sub{font-size:11px}
  .thead,.quote-row{grid-template-columns:minmax(0,1fr) 118px}
  .product{font-size:13px}
  .prices{font-size:20px}
}
</style></head><body>
<div class="wrap">

<header class="top">
  <div class="brand">
    <div class="gold-mark" aria-hidden="true">
      <span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span>
      <span class="bar b4"></span><span class="bar b5"></span><span class="bar b6"></span>
    </div>
    <div>
      <div class="title">Live Gold Rates</div>
      <div class="sub">Market Rates&nbsp;&nbsp;•&nbsp;&nbsp; Your Trusted Source</div>
    </div>
  </div>
  <div class="clock">
    <div class="clock-line">
      <svg class="hk-flag" viewBox="0 0 24 17" aria-label="Hong Kong flag"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/></svg>
      <div><div id="date" class="date">--</div><div id="time" class="time">--:--:-- -- HKT</div></div>
    </div>
  </div>
</header>

<main class="layout">
<section class="card">
  <div class="rates-head">
    <div class="rates-title"><span class="gold-mini">🪙</span><span>Gold (999.9)</span></div>
    <div class="trend">⌁⌁</div>
  </div>
  <div class="rate-inner">
    <div class="thead"><div>Product</div><div>USD Rate / Gram</div></div>
    <div id="rows"></div>
  </div>
</section>

<section class="card">
  <div class="rules-head"><span class="info">i</span><span>Booking Rules / Notes</span></div>
  <div class="rules-body">
    <div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
    <div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
    <div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
    <div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
  </div>
</section>
</main>

<div class="footer-art" aria-hidden="true">
  <div class="city">
    <span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span><span class="s5"></span>
    <span class="tower"></span><span class="s6"></span><span class="s7"></span><span class="s8"></span><span class="s9"></span><span class="s10"></span>
  </div>
</div>

<script>
(()=>{let previousRates=[];
function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}
function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}
async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product-wrap"><div class="product-icon"><span class="mini"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="bar b4"></span><span class="bar b5"></span><span class="bar b6"></span></span></div><div class="product">'+escapeHtml(x.label)+'</div></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
clock();price();setInterval(clock,1000);setInterval(price,1000)})();
</script></body></html>`;
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

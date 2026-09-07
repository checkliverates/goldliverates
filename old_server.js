const http = require("http");
const io = require("socket.io-client");

const PORT = process.env.PORT || 10000;
const WF_SERVER = "https://quote.wfgroup.com.hk:8083";
const TOKEN = process.env.WFBULLION_TOKEN || "";

// URL code -> markup for 999.9 USD PER GRAM ASK only.
// LLG BID/ASK never receive markup.
// ?3d = +0.50
// ?4d = +1.00
// ?5d = +1.50
// ?6d = +2.00
// ?7d = +2.50
//
// To rename a code later, change the key here.
// Example: change "7d" to "75d".
const CLIENTS = {
  "3d": 0.50,
  "4d": 1.00,
  "5d": 1.50,
  "6d": 2.00,
  "7d": 2.50
};

let latest = {
  bid: null,
  ask: null,
  gramSourceAsk: null,
  updatedAt: null,
  connected: false
};

function getClient(reqUrl) {
  const url = new URL(reqUrl, "http://localhost");
  const keys = [...url.searchParams.keys()];
  const code = (keys[0] || "main").toLowerCase();

  return {
    code,
    markup: Object.prototype.hasOwnProperty.call(CLIENTS, code)
      ? CLIENTS[code]
      : 0
  };
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Gold Prices</title>
<style>
:root{
  --gold:#c59a22;
  --black:#050505;
  --text:#171717;
  --card:#fff;
  --line:#e4d39a;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100vh;
  background:radial-gradient(circle at top,#fffdf5 0,#f7f7f7 45%,#eeeeee 100%);
  font-family:Arial,Helvetica,sans-serif;
  color:var(--text);
  padding:28px 16px 34px;
}
.dashboard{width:min(900px,100%);margin:auto}
.date-card{
  background:var(--card);
  border:1px solid var(--gold);
  border-radius:18px;
  padding:22px 24px;
  text-align:center;
  box-shadow:0 10px 28px rgba(0,0,0,.08);
}
.date{
  font-size:clamp(32px,6vw,58px);
  line-height:1;
  font-weight:800;
}
.hk-flag{
  font-family:"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif;
  font-size:1.05em;
  line-height:1;
  display:inline-block;
}
.live-row{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:12px;
  margin:18px 0 22px;
  font-size:clamp(18px,3vw,27px);
  font-weight:700;
}
.quote-card{
  overflow:hidden;
  border-radius:17px;
  background:var(--black);
  box-shadow:0 12px 30px rgba(0,0,0,.18);
}
.quote-head,.quote-row{
  display:grid;
  grid-template-columns:1fr 1.35fr;
  align-items:center;
}
.quote-head{
  background:linear-gradient(135deg,var(--gold),#b18b1c);
  color:#fff;
  font-weight:800;
  font-size:clamp(19px,3vw,28px);
  padding:18px 22px;
}
.quote-row{
  color:#ffff00;
  padding:24px 22px;
  min-height:86px;
  border-top:1px solid rgba(255,255,255,.24);
}
.product{
  font-size:clamp(20px,3vw,28px);
  font-weight:800;
}
.product-small{
  font-size:clamp(17px,2.7vw,24px);
  font-weight:700;
}
.prices{
  text-align:right;
  font-size:clamp(23px,4vw,34px);
  font-weight:800;
  white-space:nowrap;
}
.quote-row.updated .prices{animation:flash .35s ease}
@keyframes flash{0%{opacity:.35;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}
.notes-section{margin-top:34px}
.notes-title-row{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.notes-line{height:2px;background:linear-gradient(90deg,transparent,var(--gold));flex:1}
.notes-line.right{background:linear-gradient(90deg,var(--gold),transparent)}
.notes-title{
  background:linear-gradient(135deg,var(--gold),#b18b1c);
  color:#fff;border-radius:999px;padding:11px 22px;
  font-size:21px;font-weight:800;white-space:nowrap
}
.notes-card{
  background:rgba(255,255,255,.92);
  border:1px solid var(--gold);
  border-radius:17px;
  padding:8px 24px;
  box-shadow:0 8px 22px rgba(0,0,0,.06)
}
.note{display:flex;gap:14px;padding:18px 0;font-size:18px;line-height:1.45}
.note+.note{border-top:1px dashed var(--gold)}
.note-dot{width:11px;height:11px;margin-top:7px;flex:0 0 11px;border-radius:50%;background:var(--gold)}
.footer{
  display:flex;align-items:center;justify-content:center;gap:12px;
  margin-top:25px;color:#555;font-size:15px
}
.footer-icon{
  width:32px;height:32px;border:3px solid var(--gold);
  border-radius:50%;position:relative
}
.footer-icon:before{
  content:"";position:absolute;width:2px;height:9px;background:var(--gold);
  left:13px;top:5px
}
.footer-icon:after{
  content:"";position:absolute;width:8px;height:2px;background:var(--gold);
  left:13px;top:14px;transform:rotate(25deg);transform-origin:left center
}
@media(max-width:620px){
  body{padding:16px 10px 24px}
  .date-card{padding:18px 12px;border-radius:14px}
  .live-row{gap:9px;margin:14px 0 17px}
  .quote-head{padding:15px 13px}
  .quote-row{padding:19px 13px;min-height:75px}
  .prices{font-size:clamp(18px,5vw,27px)}
  .product{font-size:clamp(18px,4.8vw,25px)}
  .product-small{font-size:clamp(14px,4vw,20px)}
  .notes-card{padding:5px 16px}
  .note{font-size:16px;padding:15px 0}
}
@media(max-width:420px){
  .quote-head,.quote-row{grid-template-columns:.9fr 1.5fr}
  .quote-head{font-size:18px}
  .prices{font-size:19px}
}
</style>
</head>
<body>
<main class="dashboard">
  <section class="date-card"><div id="date" class="date">--</div></section>

  <div class="live-row">
    <span class="hk-flag" aria-label="Hong Kong">🇭🇰</span>
    <span id="time">--:--:-- -- HKT</span>
  </div>

  <section class="quote-card">
    <div class="quote-head">
      <div>Product</div>
      <div style="text-align:right">Bid / Ask</div>
    </div>
    <div id="llgRow" class="quote-row">
      <div class="product">LLG</div>
      <div id="llgPrices" class="prices">--- | ---</div>
    </div>
    <div id="gramRow" class="quote-row">
      <div class="product-small">999.9 USD PER GRAM</div>
      <div id="gramPrices" class="prices">--- | ---</div>
    </div>
  </section>

  <section class="notes-section">
    <div class="notes-title-row">
      <div class="notes-line"></div>
      <div class="notes-title">📝 Note:</div>
      <div class="notes-line right"></div>
    </div>
    <div class="notes-card">
      <div class="note"><span class="note-dot"></span><span>Note 1 sample</span></div>
      <div class="note"><span class="note-dot"></span><span>Note 2 sample</span></div>
      <div class="note"><span class="note-dot"></span><span>Note 3 sample</span></div>
    </div>
  </section>

  <div class="footer">
    <span class="footer-icon"></span>
    <span>Prices update in real-time</span>
  </div>
</main>

<script>
(() => {
  let lastDisplayed = "";

  function hongKongNow(){
    const parts = new Intl.DateTimeFormat("en-US",{
      timeZone:"Asia/Hong_Kong",
      year:"numeric",month:"numeric",day:"numeric",
      hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true
    }).formatToParts(new Date());

    const get = type => parts.find(p => p.type === type)?.value || "";
    return {
      year:Number(get("year")),
      month:Number(get("month")),
      day:Number(get("day")),
      hour:get("hour"),minute:get("minute"),second:get("second"),
      dayPeriod:get("dayPeriod")
    };
  }

  function updateClock(){
    const hk = hongKongNow();
    const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    document.getElementById("date").textContent =
      hk.day+"-"+months[hk.month-1]+"-"+String(hk.year).slice(-2);

    document.getElementById("time").textContent =
      hk.hour+":"+hk.minute+":"+hk.second+" "+hk.dayPeriod+" HKT";
  }

  async function updatePrice(){
    try{
      const query = window.location.search
        ? window.location.search.slice(1)
        : "";

      const response = await fetch(
        "/api/price?" + query + (query ? "&" : "") + "_=" + Date.now(),
        {cache:"no-store"}
      );

      const data = await response.json();
      if(!data.ok || data.bid === null || data.ask === null) return;

      const bid=Number(data.bid), ask=Number(data.ask);
      const gramAsk=Number(data.gramAsk);

      const llgText=bid.toFixed(2)+" | "+ask.toFixed(2);
      // 999.9 USD PER GRAM shows ASK only.
      const gramText=gramAsk.toFixed(2);

      document.getElementById("llgPrices").textContent=llgText;
      document.getElementById("gramPrices").textContent=gramText;

      const current=llgText+"|"+gramText;
      if(current!==lastDisplayed){
        const a=document.getElementById("llgRow");
        const b=document.getElementById("gramRow");
        a.classList.remove("updated");
        b.classList.remove("updated");
        void a.offsetWidth;
        a.classList.add("updated");
        b.classList.add("updated");
        lastDisplayed=current;
      }
    }catch(e){}
  }

  updateClock();
  updatePrice();
  setInterval(updateClock,1000);
  setInterval(updatePrice,1000);
})();
</script>
</body>
</html>`;
}

const server = http.createServer((req,res) => {
  const url = new URL(req.url,"http://localhost");

  if(url.pathname === "/health"){
    return sendJson(res,{
      ok:true,
      upstreamConnected:latest.connected,
      tokenPresent:Boolean(TOKEN),
      bidAvailable:latest.bid !== null,
      askAvailable:latest.ask !== null
    });
  }

  if(url.pathname === "/api/price"){
    const client=getClient(req.url);
    const hasPrice=latest.bid !== null && latest.ask !== null;

    if(!hasPrice){
      return sendJson(res,{ok:false,connected:latest.connected});
    }

    // LLG BID/ASK are displayed exactly as received from WFBullion.
    // No client markup is applied to LLG.
    const bid = latest.bid;
    const ask = latest.ask;

    // 999.9 USD PER GRAM uses the P1kKGG ASK feed:
    // 1) Remove the last digit.
    // 2) Divide by 100.
    // 3) Add the client markup.
    // Example: 142516 -> 14251 -> 142.51 -> + 0.30 = 142.81.
    // BID intentionally remains blank.
    const gramAsk = latest.gramSourceAsk === null
      ? null
      : (Math.floor(latest.gramSourceAsk / 10) / 100) + client.markup;

    return sendJson(res,{
      ok:true,
      connected:latest.connected,
      bid,
      ask,
      gramBid:null,
      gramAsk,
      updatedAt:latest.updatedAt
    });
  }

  if(url.pathname === "/"){
    res.writeHead(200,{
      "Content-Type":"text/html; charset=utf-8",
      "Cache-Control":"no-store, no-cache, must-revalidate"
    });
    return res.end(page());
  }

  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("Not found");
});

function startUpstream(){
  if(!TOKEN){
    console.log("[RELAY] WFBULLION_TOKEN is missing.");
    return;
  }

  console.log("[RELAY] Starting WFBullion connection...");
  console.log("[RELAY] Token present: YES");

  const socket=io(WF_SERVER+"/bquote",{
    transports:["polling","websocket"],
    query:{token:TOKEN},
    reconnection:true,
    reconnectionAttempts:Infinity,
    reconnectionDelay:1000,
    reconnectionDelayMax:5000,
    timeout:15000,
    rejectUnauthorized:false,
    extraHeaders:{
      Origin:"https://www.wfbullion.com",
      Referer:"https://www.wfbullion.com/en-us"
    }
  });

  socket.on("connect",()=>{
    latest.connected=true;
    console.log("[RELAY] WFBullion CONNECTED");
    console.log("[RELAY] Socket ID: "+socket.id);
  });

  socket.on("quote.realtime",(data)=>{
    const products = data && data.products;
    if(!products) return;

    const xau = products["XAU="];

    // P1kKGG is the source for 999.9 USD PER GRAM.
    // Match the product robustly by key/id/code/name so minor feed
    // naming differences do not break the calculation.
    const normalizedTarget = "p1kkgg";
    let gramProduct = null;

    for(const [key, product] of Object.entries(products)){
      const values = [
        key,
        product && product.id,
        product && product.mf_id,
        product && product.prod_code,
        product && product.name && product.name.enUS,
        product && product.name && product.name.enUS && String(product.name.enUS)
      ];

      if(values.some(v => v != null && String(v).toLowerCase().replace(/[^a-z0-9]/g,"") === normalizedTarget)){
        gramProduct = product;
        break;
      }
    }

    if(xau){
      const bid=parseFloat(xau.buy);
      const ask=parseFloat(xau.sell);

      if(Number.isFinite(bid) && Number.isFinite(ask)){
        latest.bid=bid;
        latest.ask=ask;
      }
    }

    if(gramProduct){
      const sourceAsk = parseFloat(gramProduct.sell);
      if(Number.isFinite(sourceAsk)){
        latest.gramSourceAsk=sourceAsk;
      }
    }

    if(latest.bid !== null && latest.ask !== null){
      latest.updatedAt=new Date().toISOString();
    }
  });

  socket.on("disconnect",(reason)=>{
    latest.connected=false;
    console.log("[RELAY] WFBullion DISCONNECTED: "+reason);
  });

  socket.on("connect_error",(error)=>{
    latest.connected=false;
    console.log("[RELAY] WFBullion CONNECT_ERROR: "+error.message);
  });
}

server.listen(PORT,"0.0.0.0",()=>{
  console.log("[RELAY] Server listening on port "+PORT);
  startUpstream();
});

CheckLiveRates - 999.9 USD Rate / Gram

FILES
- server.js
- package.json
- public/index.html (not required; page is served by server.js)

RENDER
Build Command: npm install
Start Command: npm start

ENVIRONMENT VARIABLES
WFBULLION_TOKEN = existing WFBullion token
ADMIN_KEY = private key for temporary /admin markup editor

LIVE PAGE
https://YOUR-SERVICE.onrender.com/

ADMIN PAGE
https://YOUR-SERVICE.onrender.com/admin

IMPORTANT
- LLG source is BID only.
- Ask is not displayed anywhere.
- Every row uses: TRUNCATE((LLG BID + markup) / 31.1035, 2)
- Markup is calculated server-side and is not returned by /api/price.
- Default markups are in PRODUCTS near the top of server.js.
- The /admin page changes markups in memory. Render restarts can reset them. For permanent settings, update PRODUCTS in server.js and deploy, or use a persistent external database later.
- P1kKGG is used only as the source ASK feed as requested in the earlier 999.9 calculation design; the current 5-row rate table itself is calculated from LLG BID.

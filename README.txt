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
ADMIN_KEY       = private key for the /admin markup editor
FRONTEND_URL    = (optional) your static site's URL, e.g. https://gold-live-rates.onrender.com
                  Only used to print shareable client-link URLs on the /admin page.
                  Defaults to https://gold-live-rates.onrender.com if not set.

CALCULATION
Every row: TRUNCATE((LLG selling price + row markup) / 31.1035, 2) = base USD rate/gram.
That base rate is then multiplied by the row's "unit multiplier" for both the USD and
HKD columns (1 = stays per gram, 37.429 = becomes per tael, etc).
Markup is calculated server-side and is NEVER returned by /api/price.

CLIENT LINKS (multiple markups from one deployment)
- The site now supports one "main" link (always 0.00 markup on every row) plus any number
  of named client links, each with its own markup per row.
- Main link (raw, no markup):
    https://gold-live-rates.onrender.com/
- Each client link (replace <id> with the link's id, set in /admin):
    https://gold-live-rates.onrender.com/?link=<id>
  Example defaults: ?link=link1 ... ?link=link5
- Sharing a link just means sharing that URL. No redeploy is needed to add, rename or
  remove a link - it's all done from /admin.

ADMIN PAGE
https://YOUR-SERVICE.onrender.com/admin
- Shows a table: product rows (1 Tael, 75-199 Grams, ...) down the side, client links
  across the top, and each cell is that row's markup for that link.
- "+ Add Product Row" - add a new row (e.g. a new gram-size bracket). Set its label and
  its unit multiplier (1 = per gram, 37.429 = per tael, or any custom conversion).
- "+ Add Client Link" - add a new link/column. Set its label and its URL id (the id used
  in ?link=<id>).
- Each link column shows its full shareable URL for convenience.
- "Save All Changes" applies everything at once (prompts for ADMIN_KEY).
- The /admin page changes rows/links/markups in memory. Render restarts reset them back
  to the defaults hardcoded in server.js (PRODUCTS / LINKS / MARKUPS near the top of the
  file). To make a change permanent across restarts, also update those in server.js and
  redeploy, or move this state to a persistent external database later.

NOTES
- LLG source is the selling price only ("BID" in earlier notes); ask is not displayed.
- P1kKGG is used only as a source ASK feed the code tracks but does not currently use in
  any calculation.

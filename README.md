# ✉ Letter to Santa

A festive mobile-friendly Christmas letter builder. Paste a gift URL, retrieve its product title and image when the retailer permits, and automatically add a real scannable QR code to a beautifully styled Santa letter.

**Live app:** https://www.jaredvogler.com/letter-to-santa  
**Side Quest:** https://www.jaredvogler.com/side-quests/letter-to-santa

## Features

- Child's first name, optional age, and custom note for Santa
- Paste HTTPS gift links; best-effort automatic product **title** retrieval (description is not required)
- Amazon a.co share links resolve to product ASINs, then try an indexed title lookup when Amazon blocks its catalog page; indexed titles must link to the exact same ASIN
- Previously saved Amazon gifts can be rechecked with **Retry Amazon titles** without losing their original links
- Manual title editing is available when neither the retailer nor indexed listings expose a recognizable name; never show an opaque short-code as the product name
- Edit a gift's name, size/color note and top-wish priority; reorder or remove entries
- One real QR code per gift, encoding the actual product URL
- Live letter preview with gift descriptions and full, clickable HTTPS product URLs beneath each gift, alongside the QR codes
- Links retained as anchors in the browser print/PDF layout for phone-friendly access
- Generate a real downloadable PDF directly in the browser (no `window.print()`), with embedded QR PNGs and clickable PDF URL annotations
- Choose **Download PDF** (Android Chrome/Samsung Internet), **Open PDF** (iOS Safari viewer → Share → Save to Files / Print), or **Share PDF** (when the device supports file sharing)
- Both the Santa letter and parent shopping guide support letter-size multi-page PDF export for long wish lists
- Separate parent shopping PDF with direct product links and QR codes
- Email a prefilled wish list with descriptions and tappable product links, or copy the entire list into an email
- Copy all gift names, descriptions and links
- Browser-local saving, no user accounts or remote wish-list database

## Run

Requires Node.js 20 or newer.

~~~bash
npm install
npm run dev
npm run typecheck
npm run build
~~~

Open http://localhost:3000/letter-to-santa

## Architecture

Next.js App Router, TypeScript, React, Cheerio and qrcode.react.

- app/page.tsx: letter builder, gift management, browser persistence, letter/parent printing
- app/globals.css: responsive North Pole UI and printer-friendly letter-size styling
- app/api/metadata/route.ts: server-side best-effort metadata extraction
- next.config.ts: fixed /letter-to-santa basePath, supporting independent Vercel deployment and same-origin proxying

The parent website repository JaredVogler2/Jaredvoglercom has a Side Quest page, catalog entry, and rewrites of /letter-to-santa and nested routes to the standalone Vercel deployment. GitHub main pushes trigger Vercel production deployments.

## Privacy and limitations

Wish lists and child names are saved only in this browser's localStorage; no accounts or database. A pasted URL alone is submitted to the metadata endpoint, where the server briefly requests the retailer website. For Amazon links, when the retailer page is blocked, the server may search a public Yahoo/Bing listing using **only the ASIN**; neither the child's name nor the entire list is sent to the search provider. Retailers may log those requests. The endpoint validates HTTPS URLs, DNS addresses, redirects and response size/timeouts to reduce unsafe outbound requests. The product title and image are best effort: shops may block automated lookup or hotlinked images, so manual editing is essential. QR codes contain submitted URLs and are generated locally with no shortener. The PDF buttons use an in-browser PDF generator and provide real PDF links; no print dialog is required. If an in-app browser blocks the links, open the website in Safari, Samsung Internet, or Chrome. Browser storage doesn't synchronize between devices.

## Check before seasonal use

- Create an actual wishlist and ensure each gift QR and the clickable printed/PDF URL open the correct site.
- Test an Amazon a.co short URL that redirects to an Amazon ASIN; confirm a title is retrieved only from a result whose Amazon link contains the exact matching ASIN.
- If Amazon and indexed listings do not provide an actual product title, confirm a clear editing prompt instead of a fabricated product title.
- Edit, reorder, remove, refresh and check saved data.
- Generate and download both PDFs on iOS Safari and Android Chrome/Samsung Internet; verify their clickable links, QR codes, multi-page pagination, and native share options.
- Check small mobile screens, desktop screens and the main-site proxy URL.

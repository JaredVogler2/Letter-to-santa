# ✉ Letter to Santa

A festive mobile-friendly Christmas letter builder. Paste a gift URL, retrieve its product title and image when the retailer permits, and automatically add a real scannable QR code to a beautifully styled Santa letter.

**Live app:** https://www.jaredvogler.com/letter-to-santa  
**Side Quest:** https://www.jaredvogler.com/side-quests/letter-to-santa

## Features

- Child's first name, optional age, and custom note for Santa
- Paste HTTPS gift links; best-effort automatic product title, description and image extraction
- Fallback manual name and description editing for retailers that block metadata lookup (including Amazon short links); no misleading random URL tokens as names
- Edit a gift's name, size/color note and top-wish priority; reorder or remove entries
- One real QR code per gift, encoding the actual product URL
- Live letter preview with gift descriptions and full, clickable HTTPS product URLs beneath each gift, alongside the QR codes
- Links retained as anchors in the browser print/PDF layout for phone-friendly access
- Print the letter or select Save as PDF in the browser's print dialog
- Separate parent shopping sheet with direct product links and larger QR codes
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

Wish lists and child names are saved only in this browser's localStorage; no accounts or database. A pasted URL alone is submitted to the metadata endpoint, where the server briefly requests the retailer website. Retailers may log those requests. The endpoint validates HTTPS URLs, DNS addresses, redirects and response size/timeouts to reduce unsafe outbound requests. The product title and image are best effort: shops may block automated lookup or hotlinked images, so manual editing is essential. QR codes contain submitted URLs and are generated locally with no shortener. The PDF save button uses browser printing; choose Save as PDF. Browser storage doesn't synchronize between devices.

## Check before seasonal use

- Create an actual wishlist and ensure each gift QR and the clickable printed/PDF URL open the correct site.
- Test an Amazon a.co short URL that returns no product metadata; confirm a clear editing prompt instead of a fabricated product title.
- Edit, reorder, remove, refresh and check saved data.
- Save both printable formats as PDFs and scan the printed QR codes.
- Check small mobile screens, desktop screens and the main-site proxy URL.

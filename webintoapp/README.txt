WASSEL — Webintoapp packaging bundle
====================================

WHAT THIS IS
------------
A static launcher shell. `index.html` sits at the ROOT of this folder/ZIP, which
is what Webintoapp requires. On first run it connects to your hosted Wassel
server, remembers the address on the device, and opens the app.

WHY THE APP ITSELF IS NOT IN THIS ZIP
-------------------------------------
Wassel is a full-stack application. These parts can only run on a server and
cannot be exported to static HTML:

  * 16 backend API routes (auth, messages, media, status, settings, calls...)
  * PostgreSQL database (users, sessions, encrypted messages, stories)
  * Server-Sent Events stream for realtime delivery, typing and presence
  * File uploads written to server storage (photos, voice notes, documents)
  * httpOnly session cookies and Bearer token verification

Setting `output: "export"` in next.config.ts makes the build fail with:

  Error: export const dynamic = "force-static"/export const revalidate not
  configured on route "/api/auth/[action]" with "output: export".

A static-only bundle would contain no database, no realtime layer and no
authentication, so no user could sign in or exchange a message. The launcher
pattern in this ZIP is the supported way to ship a server-backed app through
Webintoapp.

HOW TO USE
----------
1. Deploy the Wassel server (the Next.js project) to any Node.js host and note
   its public HTTPS URL, e.g. https://wassel.example.com
2. Open index.html in a text editor and replace the value of DEFAULT_SERVER
   with that URL. (Skip this if you packaged with scripts/package-webintoapp.mjs,
   which injects it automatically.)
3. ZIP the CONTENTS of this folder so index.html is at the ZIP root — not
   inside a nested directory.
4. In Webintoapp choose "Upload HTML ZIP", upload the archive, set the app name
   to Wassel and the theme colour to #0b141a.

If the baked-in URL is missing or unreachable, the launcher shows a form so the
user can type the server address once; it is saved in localStorage.

RECOMMENDED ALTERNATIVE
-----------------------
Webintoapp's "Website URL" mode is simpler for this app: point it directly at
https://your-server/app. You then get the same native wrapper with no ZIP and
no launcher indirection.

FILES
-----
  index.html            launcher (must stay at ZIP root)
  manifest.webmanifest  PWA metadata
  icon.svg              app icon
  README.txt            this file

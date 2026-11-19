// SquishHub desktop app (Linux). Shows the same web app as Android in a
// locked-down window, served from a private loopback server.
//
// Security model:
// - web content has no Node.js access (sandbox, contextIsolation, no preload)
// - the page is served only on 127.0.0.1, with no directory listings and no
//   files outside the bundle
// - popups are allowed only for wallet sign-in (WAX Cloud Wallet, the
//   providers it signs in with, and Anchor's web wallet); every other link
//   opens in the system browser
// - esr: and anchor: links (Anchor signing requests) are handed to the OS,
//   which opens the Anchor desktop app
// - camera, microphone, location, notifications and similar are denied
const { app, BrowserWindow, shell, session, Menu } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const WEB = path.join(__dirname, 'web')
// Fixed ports so the wallet session and settings (stored per origin) persist between runs.
const PORTS = [36963, 36966, 36969, 39363, 39366]
const POPUP_HOSTS = [
  'mycloudwallet.com',
  'wax.io',
  'anchorwallet.io',
  'accounts.google.com',
  'appleid.apple.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'discord.com',
]
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const hostAllowed = (u) => {
  try {
    const { protocol, hostname } = new URL(u)
    return protocol === 'https:' && POPUP_HOSTS.some((d) => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}
const isWalletLink = (u) => /^(esr|anchor):/i.test(u)
const openOutside = (u) => {
  if (/^https?:/i.test(u) || isWalletLink(u)) shell.openExternal(u).catch(() => {})
}

function serve() {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      let rel = decodeURIComponent(u.pathname)
      if (rel.endsWith('/')) rel += 'index.html'
      const file = path.normalize(path.join(WEB, rel))
      if (!file.startsWith(WEB + path.sep)) {
        res.writeHead(403).end()
        return
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Cache-Control': 'no-cache',
        })
        res.end(data)
      })
    } catch {
      res.writeHead(400).end()
    }
  })
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= PORTS.length) return reject(new Error('No free local port for SquishHub'))
      server.once('error', () => tryPort(i + 1))
      server.listen(PORTS[i], '127.0.0.1', () => resolve(`http://127.0.0.1:${PORTS[i]}`))
    }
    tryPort(0)
  })
}

function harden(contents, origin) {
  contents.setWindowOpenHandler(({ url }) => {
    if (hostAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      }
    }
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${origin}/`) || hostAllowed(url)) return
    e.preventDefault()
    openOutside(url)
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win = null
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    // Only clipboard writes (copy buttons) and handing Anchor links to the OS are allowed.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => {
      if (perm === 'clipboard-sanitized-write') return cb(true)
      if (perm === 'openExternal') return cb(isWalletLink(details?.externalURL || ''))
      cb(false)
    })
    let origin
    try {
      origin = await serve()
    } catch (err) {
      require('electron').dialog.showErrorBox('SquishHub', String(err.message || err))
      app.quit()
      return
    }
    app.on('web-contents-created', (_e, contents) => harden(contents, origin))

    win = new BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 380,
      minHeight: 560,
      title: 'SquishHub',
      backgroundColor: '#000000',
      icon: path.join(__dirname, 'build', 'icon.png'),
      autoHideMenuBar: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    })
    win.once('ready-to-show', () => win.show())
    win.loadURL(`${origin}/index.html`)
  })

  app.on('window-all-closed', () => app.quit())
}

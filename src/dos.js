// The DOS shell around the hub: boot screen, clock, F-key navigation, colour
// themes and a working command prompt in the status line.
import * as wallet from './wallet.js'

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  sget: (k) => { try { return sessionStorage.getItem(k) } catch { return null } },
  sset: (k, v) => { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } },
}

// ---------------------------------------------------------------- themes

export const THEMES = ['green', 'amber', 'blue', 'grey']

export function setTheme(name) {
  const t = THEMES.includes(name) ? name : 'green'
  document.body.classList.remove(...THEMES.map((x) => `theme-${x}`))
  document.body.classList.add(`theme-${t}`)
  store.set('squishhub.theme', t)
  return t
}

setTheme(store.get('squishhub.theme') || 'green')
$('themeBtn').addEventListener('click', () => {
  const cur = THEMES.find((t) => document.body.classList.contains(`theme-${t}`)) || 'green'
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]
  say(`Colour scheme: ${setTheme(next).toUpperCase()}`)
})

// ------------------------------------------------------------------ boot

const BOOT = [
  'SquishBIOS (C) 1969-2026 Next Door Media (UK)',
  '',
  'Memory test: 640K OK',
  'Detecting WAX blockchain........ OK',
  'Loading SQUISH.SYS',
  'Loading SHARDZ.DRV',
  'Mounting C:\\SQUISH',
  '',
  'C:\\> CD SQUISH',
  'C:\\SQUISH> HUB.EXE',
]

function boot() {
  const el = $('boot')
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (store.sget('squishhub.booted') || reduce) return
  store.sset('squishhub.booted', '1')
  el.hidden = false
  let i = 0
  const text = $('bootText')
  const timer = setInterval(() => {
    text.textContent += `${BOOT[i]}\n`
    if (++i >= BOOT.length) clearInterval(timer)
  }, 140)
  const done = () => {
    clearInterval(timer)
    el.hidden = true
    window.removeEventListener('keydown', done)
  }
  el.addEventListener('click', done)
  window.addEventListener('keydown', done)
  setTimeout(done, 4500)
}
boot()

// ----------------------------------------------------------------- clock

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
tick()
setInterval(tick, 15000)

// ------------------------------------------------------------- navigation

const KEYS = { F1: 'hub', F2: 'drops', F3: 'farms', F4: 'vote', F5: 'inventory', F6: 'sk8' }

window.addEventListener('keydown', (e) => {
  const page = KEYS[e.key]
  if (!page) return
  e.preventDefault()
  location.hash = `#${page}`
})

/** Keeps the prompt in step with the page: C:\SQUISH\FARMS> */
export function setPrompt(page) {
  const names = { hub: 'HUB', drops: 'DROPS', farms: 'FARMS', vote: 'VOTE', inventory: 'BAG', sk8: 'SK8' }
  $('ps1').textContent = `C:\\SQUISH\\${names[page] || 'HUB'}>`
}

// --------------------------------------------------------- command prompt

function say(text) {
  $('cmdOut').textContent = text
}

const PAGES = { hub: 'hub', drops: 'drops', drop: 'drops', farms: 'farms', farm: 'farms', vote: 'vote', dao: 'vote', bag: 'inventory', inv: 'inventory', inventory: 'inventory', dir: 'inventory', sk8: 'sk8', skate: 'sk8', sk8coin: 'sk8', board: 'sk8' }

const COMMANDS = {
  help: () => say('HUB DROPS FARMS VOTE BAG SK8 · CONNECT · CLOUD · LOGOUT · THEME [GREEN|AMBER|BLUE|GREY] · VER · CLS'),
  ver: () => say(`SquishHub v${__VERSION__} · SquishEyez on WAX · (C) 2026 Next Door Media (UK)`),
  cls: () => { window.scrollTo({ top: 0 }); say('') },
  theme: (arg) => say(`Colour scheme: ${setTheme((arg || '').toLowerCase()).toUpperCase()}`),
  connect: () => { $('connectAnchor').click(); say('Connecting Anchor…') },
  cloud: () => { $('connectCloud').click(); say('Connecting WAX Cloud Wallet…') },
  logout: () => {
    if (!wallet.getSession()) return say('No wallet connected.')
    $('logoutWallet').click()
    say('Logged out.')
  },
  whoami: () => say(wallet.actor() ? `${wallet.actor()} (${wallet.walletName()})` : 'Not connected. Type CONNECT.'),
  mem: () => say('640K ought to be enough for anybody.'),
  exit: () => say('There is no exit. Only SQUISH.'),
  format: () => say('Nice try.'),
}

$('cmdForm').addEventListener('submit', (e) => {
  e.preventDefault()
  const raw = $('cmd').value.trim()
  $('cmd').value = ''
  if (!raw) return
  const [word, ...rest] = raw.split(/\s+/)
  let cmd = word.toLowerCase().replace(/\.(exe|com|bat)$/, '')
  // CD FARMS, CD \SQUISH\FARMS and CD.. all work like DOS.
  if (cmd === 'cd' || cmd === 'cd..') {
    const target = cmd === 'cd..' || rest[0] === '..' ? 'hub' : (rest[0] || '').toLowerCase().split(/[\\/]/).filter(Boolean).pop()
    if (!target) return say('C:\\SQUISH')
    cmd = target === 'squish' ? 'hub' : target
  }
  if (PAGES[cmd]) {
    location.hash = `#${PAGES[cmd]}`
    say('')
    return
  }
  if (COMMANDS[cmd]) return COMMANDS[cmd](rest.join(' '))
  say(`Bad command or file name: ${word}`)
})

export { say }

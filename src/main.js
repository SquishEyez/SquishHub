import './style.css'

import { BLENDS, COLLECTION } from './config.js'
import * as wallet from './wallet.js'
import * as blends from './blends.js'
import * as packs from './packs.js'
import * as nb from './neftyblends.js'
import { $, esc, txLink, show, busy, imgTag, fmtQty } from './ui.js'
import { refreshFarms } from './farmsPage.js'
import { refreshInventory } from './inventoryPage.js'
import { refreshDrops } from './dropsPage.js'
import { refreshVote } from './votePage.js'
import { setPrompt } from './dos.js'
import { squishStats } from './token.js'


// ==================== PAGES ====================

const loaders = { drops: refreshDrops, farms: refreshFarms, vote: refreshVote, inventory: refreshInventory }

const PAGES = ['hub', 'drops', 'farms', 'vote', 'inventory']
const stale = new Set(Object.keys(loaders))

function showPage() {
  const page = (location.hash.slice(1) || 'hub').split('/')[0]
  let name = PAGES.includes(page) ? page : 'hub'
  if (name !== page && location.hash) history.replaceState(null, '', `#${name}`)
  setPrompt(name)
  for (const el of document.querySelectorAll('.page')) el.hidden = el.id !== `page-${name}`
  for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('active', a.dataset.page === name)
  document.querySelector(`#tabs a[data-page="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (stale.has(name)) { stale.delete(name); loaders[name]() }
}
window.addEventListener('hashchange', showPage)

/** Wallet changed: reload the visible page now, the others when opened. */
function invalidatePages() {
  Object.keys(loaders).forEach((k) => stale.add(k))
  showPage()
}

// ==================== WALLET ====================

const anchorBtn = $('connectAnchor')
const cloudBtn = $('connectCloud')
const accountBtn = $('accountBtn')
const logoutBtn = $('logoutWallet')
const statusEl = $('wallet-status')

function renderWallet() {
  const who = wallet.actor()
  anchorBtn.hidden = cloudBtn.hidden = Boolean(who)
  accountBtn.hidden = true // the status line already shows the account
  logoutBtn.hidden = !who
  if (who) {
    statusEl.innerHTML = `✅ CONNECTED: <strong>${esc(who)}</strong> <small>(${esc(wallet.walletName())})</small>`
    statusEl.className = 'status ok'
    accountBtn.textContent = `✅ ${who}`
  } else {
    statusEl.textContent = 'Wallet not connected'
    statusEl.className = 'status'
  }
}


async function afterLogin() {
  renderWallet()
  invalidatePages()
  refreshPacks()
  renderFusion()
}

async function connect(which) {
  if (wallet.getSession()) return
  if (which === 'anchor' && !(await wallet.walletAppInstalled())) {
    statusEl.innerHTML = '❌ The Anchor app isn\'t installed. <a href="https://anchorwallet.io/download" target="_blank" rel="noopener">Get Anchor</a>, add your WAX account, then come back and connect. Or use WAX Cloud Wallet instead.'
    statusEl.className = 'status error'
    return
  }
  statusEl.textContent = which === 'cloudwallet'
    ? 'Connecting… log in to WAX Cloud Wallet in the window that opens.'
    : wallet.isNativeApp ? 'Connecting… Anchor will open: approve there, then return here.' : 'Connecting… approve in Anchor.'
  statusEl.className = 'status'
  try {
    await wallet.login(which)
    await afterLogin()
  } catch (err) {
    console.error(err)
    statusEl.innerHTML = `❌ ${esc(wallet.errorMessage(err))}`
    statusEl.className = 'status error'
  }
}

anchorBtn.addEventListener('click', () => connect('anchor'))
cloudBtn.addEventListener('click', () => connect('cloudwallet'))
accountBtn.addEventListener('click', () => { location.hash = '#inventory' })

logoutBtn.addEventListener('click', async () => {
  await wallet.logout().catch(console.error)
  renderWallet()
  invalidatePages()
  $('packSelect').innerHTML = '<option value="">Connect wallet to list your packs</option>'
  renderFusion()
})

// ==================== WRAP / UNWRAP (WaxDAO blends) ====================

const blendCache = new Map()

async function renderBlends() {
  const box = $('blends')
  box.innerHTML = BLENDS.map((b) => `
    <div class="blend" id="blend-${b.id}">
      <div class="recipe" id="recipe-${b.id}">Loading blend #${b.id}…</div>
      <button id="blendBtn-${b.id}" class="${b.key === 'unwrap' ? 'danger' : ''}">${esc(b.label)}</button>
      <div class="result" id="blendResult-${b.id}" hidden></div>
    </div>`).join('')

  for (const b of BLENDS) {
    $(`blendBtn-${b.id}`).addEventListener('click', (e) => runBlend(b, e.currentTarget))
    blends.loadBlend(b.id).then((blend) => {
      blendCache.set(b.id, blend)
      const thumbs = [...blend.ingredients, ...blend.results].filter((x) => x.image)
      $(`recipe-${b.id}`).innerHTML = `
        ${thumbs.length ? `<div class="thumbs">${blend.ingredients.filter((x) => x.image).map((x) => imgTag(x.image, x.label || '', 'thumb')).join('')}<span class="arrow">→</span>${blend.results.map((x) => x.image ? imgTag(x.image, x.text, 'thumb') : `<span class="token-chip">${esc(fmtQty(x.text))}</span>`).join('')}</div>` : ''}
        <div><strong>${esc(blend.title)}</strong> <small>(${esc(blend.status)}${blend.remaining !== null ? ` · ${blend.remaining.toLocaleString('en-GB')} left` : ''})</small></div>
        <div>You give: ${blend.ingredients.map((i) => esc(i.kind === 'token' ? fmtQty(i.quantity) : blends.describeIngredient(i))).join(' + ') || '—'}</div>
        <div>You get: ${blend.results.map((r) => esc(fmtQty(r.text))).join(' + ') || '—'}</div>`
    }).catch((err) => {
      $(`recipe-${b.id}`).textContent = `Couldn't load this recipe: ${wallet.errorMessage(err)}`
    })
  }
}

function runBlend(b, btn) {
  const out = $(`blendResult-${b.id}`)
  return busy(btn, out, async () => {
    const blend = blendCache.get(b.id) || (await blends.loadBlend(b.id))
    blendCache.set(b.id, blend)
    if (blend.status !== 'active') throw new Error(`This is ${blend.status} right now.`)
    show(out, 'Checking your wallet for everything this needs…')
    const picks = await blends.pickIngredients(blend)
    const nftList = [...picks.values()].flat()
    const summary = blend.ingredients.map((i) => blends.describeIngredient(i)).join(' + ')
    if (!confirm(`${b.key === 'unwrap' ? 'Unwrap' : 'Wrap'}?\n\nYou give: ${summary}${nftList.length ? `\n(NFT IDs ${nftList.join(', ')})` : ''}\nYou get: ${blend.results.map((r) => fmtQty(r.text)).join(' + ')}`)) {
      out.hidden = true
      return
    }
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(blends.buildBlendActions(blend, picks))
    show(out, `✅ Done! ${esc(blend.results.map((r) => fmtQty(r.text)).join(' + '))} is on its way to your wallet. ${txLink(tx)}`, 'ok')
    refreshPacks()
  })
}

// ==================== SEASON 2 FUSION (blend.nefty) ====================

let fusionBlends
let owned

async function renderFusion() {
  const list = $('fusionList')
  try {
    fusionBlends = fusionBlends || (await nb.loadNeftyBlends())
    owned = wallet.getSession() ? await nb.ownedByTemplate().catch(() => undefined) : undefined
    const rows = fusionBlends.map((b) => {
      const p = owned ? nb.pick(b, owned) : {}
      const ready = b.supported && b.status === 'active' && p.ids
      const tag = !b.supported ? 'can\'t be made in this app' : b.status !== 'active' ? b.status : !owned ? '' : ready ? 'READY' : 'missing pieces'
      return { b, ready, html: `
        <div class="fuse-row">
          ${imgTag(b.image, b.name, 'thumb')}
          <div class="what"><strong>${esc(b.name)}</strong><br>${esc(b.ingredientText)} → ${esc(b.resultText)}
            ${tag ? `<br><span class="tag ${ready ? 'ready' : ''}">${esc(tag)}</span>` : ''}</div>
          <button data-blend="${esc(b.id)}" ${ready || !owned ? '' : 'disabled'}>FUSE</button>
        </div>` }
    })
    rows.sort((x, y) => Number(y.ready) - Number(x.ready))
    list.innerHTML = rows.map((r) => r.html).join('') || 'No fusion recipes found.'
  } catch (err) {
    list.textContent = `Couldn't load the recipes: ${wallet.errorMessage(err)}`
  }
}

$('fusionList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-blend]')
  if (!btn) return
  const out = $('fusionResult')
  busy(btn, out, async () => {
    const blend = fusionBlends.find((b) => b.id === btn.dataset.blend)
    owned = await nb.ownedByTemplate()
    const p = nb.pick(blend, owned)
    if (!p.ids) throw new Error(`You don't have all the pieces for ${blend.name}.`)
    if (!confirm(`Fuse ${blend.name}?\n\nThese NFTs are burned: ${blend.ingredientText}\n(IDs ${p.ids.join(', ')})\n\nYou get: ${blend.resultText}`)) return
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(nb.buildFuse(blend, p.ids))
    show(out, `✅ Fused! Your ${esc(blend.resultText)} is on its way to your wallet. ${txLink(tx)}`, 'ok')
    renderFusion()
  })
})

// ==================== PACKS ====================

const packSelect = $('packSelect')

async function checkPackRam() {
  const bytes = await packs.collectionRam(COLLECTION).catch(() => undefined)
  const warn = $('packRamWarn')
  warn.hidden = !(bytes !== undefined && bytes < 1000)
  warn.innerHTML = '⚠ Pack opening is paused: the collection has run out of minting storage on NeftyBlocks, so every pack is refused for now. It will work again once the collection\'s storage is topped up.'
  return bytes
}

async function refreshPacks() {
  checkPackRam()
  if (!wallet.getSession()) return
  packSelect.innerHTML = '<option value="">Loading your packs…</option>'
  try {
    const owned = await packs.listOwnedPacks()
    packSelect.innerHTML = owned.length
      ? owned.map((p) => `<option value="${esc(p.asset_id)}">#${esc(p.asset_id)} — ${esc(p.name)}</option>`).join('')
      : '<option value="">No unopened packs in this wallet</option>'
  } catch (err) {
    packSelect.innerHTML = `<option value="">Could not list packs (${esc(wallet.errorMessage(err))})</option>`
  }
}

$('openPackBtn').addEventListener('click', (e) => {
  const out = $('packResult')
  return busy(e.currentTarget, out, async () => {
    const assetId = ($('packInput').value.trim() || packSelect.value).replace(/^#/, '')
    if (!/^\d+$/.test(assetId)) throw new Error('Choose a pack from the list, or enter its asset ID.')

    // Already sent earlier but never claimed? Then go straight to the claim.
    let claim = await packs.getClaim(assetId).catch(() => undefined)
    if (!claim) {
      if (!confirm(`Open pack #${assetId}?\n\nYou'll approve twice: once to open the pack, and once (about a minute later) to collect what's inside.`)) return
      show(out, 'Step 1 of 2: approve opening the pack in your wallet…')
      const tx1 = await wallet.transact(packs.buildUnbox(assetId))
      show(out, `Pack opened (${txLink(tx1)}). Rolling for your NFTs, usually under a minute…`)
      claim = await packs.waitForClaim(assetId, {
        onTick: (s) => show(out, `Pack opened (${txLink(tx1)}). Rolling for your NFTs, usually under a minute… ${s}s`),
      })
    }
    show(out, `Step 2 of 2: approve collecting ${claim.claims?.length || 1} NFT${(claim.claims?.length || 1) === 1 ? '' : 's'} in your wallet…`)
    const tx2 = await wallet.transact(packs.buildClaim(claim))
    show(out, `✅ Pack opened! ${claim.claims?.length || 1} NFT${(claim.claims?.length || 1) === 1 ? '' : 's'} sent to your wallet. ${txLink(tx2)}`, 'ok')
    $('packInput').value = ''
    refreshPacks()
  })
})

// ==================== $SQUISH ====================

const n = (x, d = 2) => Number(x).toLocaleString('en-GB', { maximumFractionDigits: d })

export async function renderSquish() {
  const box = $('squishStats')
  try {
    const t = await squishStats()
    box.innerHTML = `
      <div>Minted <strong>${n(t.supply)}</strong> of <strong>${n(t.cap, 0)}</strong> (${n(t.pct, 2)}%)</div>
      <div class="bar"><span style="width:${Math.min(100, t.pct).toFixed(2)}%"></span></div>
      <div class="row">
        <span>Left to mint: ${n(t.left)}</span>
        <span>In farm reward pools: ${n(t.inFarms)}</span>
        ${t.holders !== undefined ? `<span>Holders: ${n(t.holders, 0)}</span>` : ''}
      </div>`
  } catch (err) {
    box.textContent = `Couldn't read $SQUISH: ${wallet.errorMessage(err)}`
  }
}

// ==================== START ====================

renderWallet()
showPage()
renderSquish()
renderBlends()
renderFusion()
checkPackRam()
wallet.restore().then((s) => s && afterLogin()).catch((err) => console.warn('Session restore failed', err))

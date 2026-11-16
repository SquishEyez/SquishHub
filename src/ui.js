// Small helpers shared by every page.
import { EXPLORER_TX_URL } from './config.js'
import * as wallet from './wallet.js'
import { fmtQty, fmtDate, fmtDuration, schemaName } from './chain.js'

export { fmtQty, fmtDate, fmtDuration, schemaName }

export const $ = (id) => document.getElementById(id)

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const txLink = (id) =>
  id ? `<a href="${EXPLORER_TX_URL}${esc(id)}" target="_blank" rel="noopener">View transaction</a>` : ''


/** Writes a message into a result box. kind: info | ok | error */
export function show(el, html, kind = 'info') {
  el.innerHTML = html
  el.className = `result ${kind}`
  el.hidden = false
}

/** Disables a button while `fn` runs, and reports errors into `out`. */
export async function busy(btn, out, fn) {
  if (!wallet.getSession()) {
    show(out, 'Connect your wallet first (top of the page).', 'error')
    return
  }
  const label = btn.textContent
  btn.disabled = true
  btn.textContent = 'WORKING…'
  try {
    await fn()
  } catch (err) {
    console.error(err)
    show(out, `❌ ${esc(wallet.errorMessage(err))}`, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = label
  }
}

// Public IPFS gateways, tried in order: when an image fails to load, the
// next gateway is used (see the error handler at the bottom of this file).
// NFT media lives on IPFS. Checked from the app's network (Nov 2026):
//   resizer.atomichub.io  small WebP previews of any image, and a still
//                         frame of videos: fast and reliable -> used first
//   ipfs.io, dweb.link    full files, but rate-limited (HTTP 429) -> fallbacks
//   ipfs.neftyblocks.io   gone; atomichub-ipfs.com is a parked domain -> unused
const PREVIEW = (cid) => `https://resizer.atomichub.io/images/v1/preview?ipfs=${encodeURIComponent(cid)}&size=370`
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/']

/** The IPFS content ID (and any path) in a hash, ipfs:// URI or gateway URL. */
export function cidOf(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  const m = s.match(/\/ipfs\/(.+)$/) || s.match(/^ipfs:\/\/(.+)$/)
  if (m) return m[1]
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})/.test(s) ? s : ''
}

/** Preview image URL for an IPFS hash or URL ('' if there is none). */
export function previewUrl(v) {
  const cid = cidOf(v)
  if (cid) return PREVIEW(cid)
  return /^https?:\/\//.test(String(v || '')) ? String(v) : ''
}

/** Image <img> for an IPFS hash/URL, with gateway fallbacks on error. */
export function imgTag(v, alt = '', cls = '') {
  const src = previewUrl(v)
  const cid = cidOf(v)
  if (!src) return `<div class="noimg-box ${esc(cls)}" aria-hidden="true">?</div>`
  return `<img loading="lazy" decoding="async" class="${esc(cls)}" src="${esc(src)}" ${cid ? `data-cid="${esc(cid)}"` : ''} alt="${esc(alt)}">`
}

/** Preview of an AtomicAssets asset (image, or a still frame of its video). */
export function mediaHtml(asset) {
  const d = asset.data || { ...(asset.template?.immutable_data || {}), ...(asset.immutable_data || {}), ...(asset.mutable_data || {}) }
  return imgTag(d.img || d.image || d.video || '', d.name || '')
}

export const assetName = (a) => a.name || a.data?.name || a.template?.immutable_data?.name || `#${a.asset_id}`
export const mintOf = (a) => (a.template_mint && a.template_mint !== '0' ? `#${a.template_mint}` : '')

// A preview that fails to load falls back to the full file on the public
// gateways, then gives up quietly (the card still shows the name).
document.addEventListener('error', (e) => {
  const el = e.target
  if (!(el instanceof HTMLImageElement) || !el.dataset.cid) return
  const step = Number(el.dataset.step || 0)
  if (step < GATEWAYS.length) {
    el.dataset.step = String(step + 1)
    el.src = GATEWAYS[step] + el.dataset.cid
  } else {
    el.classList.add('noimg')
  }
}, true)

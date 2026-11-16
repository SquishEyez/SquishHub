// DROPS page: every SquishEyez drop on NeftyBlocks and NFTHive, with claiming,
// plus withdrawal of leftover deposits the drop contracts still hold.
import * as wallet from './wallet.js'
import * as drops from './drops.js'
import { $, esc, txLink, show, busy, imgTag, fmtQty, fmtDate, fmtDuration } from './ui.js'
import { templateData } from './chain.js'
import { COLLECTION } from './config.js'

let all = []
const accessCache = new Map()

const fmt = (t) => fmtDate(t)
const dur = (s) => fmtDuration(s)

/** Every SquishEyez drop on both platforms. */
export async function loadAllDrops() {
  const [n, h] = await Promise.all([drops.loadDrops('nefty'), drops.loadDrops('hive')])
  return [...n, ...h]
}

export async function refreshDrops() {
  const list = $('dropList')
  list.innerHTML = '<div class="item">Loading drops…</div>'
  try {
    all = await loadAllDrops()
    // Drops rarely carry their own picture: show the NFT they mint.
    await Promise.all(all.filter((d) => !d.image && d.templates[0]).map(async (d) => {
      d.image = (await templateData(COLLECTION, d.templates[0])).img || ''
    }))
    accessCache.clear()
    await render()
  } catch (err) {
    list.innerHTML = `<div class="item">Couldn't load the drops: ${esc(wallet.errorMessage(err))}</div>`
  }
  renderLeftovers()
}

async function render() {
  const platform = $('dropPlatform').value
  const which = $('dropStatus').value
  const shown = all.filter((d) => (!platform || d.platform === platform) &&
    (which === 'all' || (which === 'open' ? ['live', 'upcoming'].includes(d.status) : d.status === which)))
  $('dropSummary').textContent = `Showing ${shown.length} of ${all.length} drops · ${all.filter((d) => d.status === 'live').length} live now`
  const access = await Promise.all(shown.map(async (d) => {
    const key = `${d.platform}:${d.id}`
    if (!accessCache.has(key)) accessCache.set(key, drops.readAccess(d).catch(() => ({ kind: 'public' })))
    return accessCache.get(key)
  }))
  $('dropList').innerHTML = shown.map((d, i) => card(d, access[i])).join('') ||
    '<div class="item">No drops to show here. Choose "All drops" to see past ones.</div>'
}

function card(d, access) {
  const p = drops.PLATFORMS[d.platform]
  const live = d.status === 'live'
  return `
  <div class="farm drop" data-key="${esc(d.platform)}:${esc(d.id)}">
    <div class="drop-head">
      ${imgTag(d.image, d.name)}
      <div>
        <h3>${esc(d.name)}</h3>
        <span class="tag">${esc(p.name)} #${esc(d.id)}</span>
        <span class="tag ${live ? 'ready' : ''}">${esc(d.status.toUpperCase())}</span>
        ${d.hidden ? '<span class="tag">hidden</span>' : ''}
      </div>
    </div>
    <div class="meta">
      <strong>Price:</strong> ${d.free ? 'Free' : esc(fmtQty(d.price))}<br>
      <strong>Claimed:</strong> ${d.claimed.toLocaleString('en-GB')}${d.max ? ` of ${d.max.toLocaleString('en-GB')}` : ' (no supply limit)'}<br>
      <strong>Open:</strong> ${d.start ? `from ${esc(fmt(d.start))}` : 'from launch'} ${d.end ? `until ${esc(fmt(d.end))}` : '(no end date)'}<br>
      <strong>Per wallet:</strong> ${d.accountLimit ? `${d.accountLimit}${d.cooldown ? ` every ${dur(d.cooldown)}` : ' in total'}` : 'no limit'}<br>
      <strong>Who can claim:</strong> ${esc(drops.describeAccess(access))}
      ${d.description ? `<details><summary>Description</summary><p>${esc(d.description)}</p></details>` : ''}
    </div>
    ${live ? `
      <div class="row">
        <input type="number" class="qty" min="1" value="1" aria-label="Quantity">
        <button data-act="claim">${d.free ? 'CLAIM FREE' : `BUY FOR ${esc(fmtQty(d.price))}`}</button>
      </div>` : ''}
    <div class="result" hidden></div>
  </div>`
}

$('dropList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="claim"]')
  if (!btn) return
  const el = btn.closest('.drop')
  const [platform, id] = el.dataset.key.split(':')
  const out = el.querySelector('.result')
  busy(btn, out, async () => {
    const d = (await drops.reloadDrop({ platform, id })) || all.find((x) => x.platform === platform && x.id === id)
    if (d.status !== 'live') throw new Error(`This drop has ${d.status === 'upcoming' ? 'not started yet' : d.status === 'sold out' ? 'sold out' : 'ended'}.`)
    const amount = Math.max(1, Math.floor(Number(el.querySelector('.qty').value) || 1))
    if (d.remaining < amount) throw new Error(`Only ${d.remaining} left.`)
    const left = await drops.claimsLeft(d)
    if (left < amount) throw new Error(left === 0 ? 'You\'ve already claimed the most this drop allows per wallet.' : `You can claim ${left} more.`)
    const access = await drops.readAccess(d)
    let proofIds = []
    if (access.kind === 'proof') {
      const proof = await drops.resolveProof(access)
      if (proof.missing) throw new Error(`This drop is for holders only. You need ${drops.describeFilter(proof.missing)}.`)
      proofIds = proof.assetIds
    }
    // A drop can accept other prices too (e.g. another token).
    let price = d.price
    const alts = d.free ? [] : await drops.alternativePrices(d)
    if (alts.length) {
      const options = [d.price, ...alts]
      const pick = prompt(`How would you like to pay?\n${options.map((o, i) => `${i + 1}. ${fmtQty(o)}`).join('\n')}\n\nType the number of your choice:`, '1')
      if (pick === null) return
      price = options[Math.max(0, Math.min(options.length - 1, Number(pick) - 1))] || d.price
    }
    const total = d.free ? 'free' : fmtQty(`${Number(price.split(' ')[0]) * amount} ${price.split(' ')[1]}`)
    if (!confirm(`${d.name}\n\n${d.free ? `Claim ${amount} for free?` : `Buy ${amount} for ${total}?`}`)) return
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(await drops.buildClaim(d, { amount, price, access, proofIds }))
    show(out, `✅ Done! Your NFT${amount > 1 ? 's' : ''} will arrive in your wallet shortly. ${txLink(tx)}`, 'ok')
  })
})

$('dropPlatform').addEventListener('change', render)
$('dropStatus').addEventListener('change', render)
$('dropRefresh').addEventListener('click', refreshDrops)

// ---- leftover deposits held by the drop contracts ----

async function renderLeftovers() {
  const box = $('dropLeftovers')
  if (!wallet.getSession()) { box.hidden = true; return }
  const rows = []
  for (const key of ['nefty', 'hive']) {
    for (const q of await drops.leftoverBalances(key).catch(() => [])) rows.push({ key, q })
  }
  box.hidden = !rows.length
  box.innerHTML = rows.length ? `<p class="info">Money left over from earlier drop purchases, waiting for you to take back:</p>${rows.map((r) => `
    <div class="fuse-row"><div class="what">${esc(fmtQty(r.q))} on ${esc(drops.PLATFORMS[r.key].name)}</div>
    <button data-withdraw="${esc(r.key)}" data-q="${esc(r.q)}">WITHDRAW</button></div>`).join('')}<div class="result" hidden></div>` : ''
}

$('dropLeftovers').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-withdraw]')
  if (!btn) return
  const out = $('dropLeftovers').querySelector('.result')
  busy(btn, out, async () => {
    const tx = await wallet.transact(drops.buildWithdrawLeftover(btn.dataset.withdraw, btn.dataset.q))
    show(out, `✅ Sent back to your wallet. ${txLink(tx)}`, 'ok')
    setTimeout(renderLeftovers, 2500)
  })
})

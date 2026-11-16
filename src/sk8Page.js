// SK8 page: the SquishEyez × Sk8Coin collab. Collab parts, the live drops
// that sell them, the skateboard recipes, and the wallet's collab items.
import { SK8 } from './config.js'
import { templateData, getCurrencyBalance } from './chain.js'
import * as wallet from './wallet.js'
import * as drops from './drops.js'
import * as nb from './neftyblends.js'
import { dropCard, bindDropClaims } from './dropsPage.js'
import { $, esc, txLink, show, busy, imgTag, fmtQty } from './ui.js'

let boards = []
let owned

// Sk8Coin named both the deck and the wheels plain "SquishEyez"; use clear names.
const PART_NAMES = new Map(SK8.parts.map((p) => [p.template, p.label]))
const partName = (template, fallback) => PART_NAMES.get(Number(template)) || fallback

export async function refreshSk8() {
  owned = wallet.getSession() ? await nb.ownedByTemplate(SK8.collection).catch(() => undefined) : undefined
  await Promise.all([renderWallet(), renderParts(), renderDrops(), renderBoards()])
}

// ----------------------------------------------------------------- wallet

async function renderWallet() {
  const box = $('sk8Wallet')
  const who = wallet.actor()
  if (!who) { box.textContent = 'Connect your wallet to see your SKATE and parts.'; return }
  const [skate, wax] = await Promise.all([
    getCurrencyBalance(SK8.token.contract, who, SK8.token.symbol).catch(() => []),
    getCurrencyBalance('eosio.token', who, 'WAX').catch(() => []),
  ])
  const count = (g) => SK8.parts.filter((p) => p.group === g).reduce((n, p) => n + ((owned?.get(p.template) || []).length), 0)
  box.innerHTML = `
    <div class="balances"><span>${esc(fmtQty(skate[0] || '0 SKATE'))}</span><span>${esc(fmtQty(wax[0] || '0 WAX'))}</span></div>
    <div class="row"><small>Decks ${count('Deck')}</small><small>Wheels ${count('Wheels')}</small><small>Trucks ${count('Trucks')}</small><small>Bearings ${count('Bearings')}</small></div>`
}

// ------------------------------------------------------------------ parts

async function renderParts() {
  const box = $('sk8Parts')
  try {
    const parts = await Promise.all(SK8.parts.map(async (p) => ({ ...p, data: await templateData(SK8.collection, p.template) })))
    const card = (p) => {
      const d = p.data
      const have = owned ? (owned.get(p.template) || []).length : undefined
      // Bearing templates carry odd 'rarity' values ("Burn Token", "alpha"): show real rarities only.
      const rarityOk = /^(common|uncommon|rare|epic|legendary)$/i.test(d.rarity || '')
      const traits = ['rarity', 'speed', 'balance', 'pop'].filter((k) => d[k] && (k !== 'rarity' || rarityOk)).map((k) => `${k} ${d[k]}`).join(' · ')
      return `
      <div class="card">
        ${imgTag(d.img, p.label)}
        <div class="name">${esc(p.label)}</div>
        <div><small>${esc(traits)}</small></div>
        <div><small>${d._max ? `${d._issued.toLocaleString('en-GB')} of ${d._max.toLocaleString('en-GB')} made` : d._issued ? `${d._issued.toLocaleString('en-GB')} made` : ''}</small></div>
        ${have !== undefined ? `<div class="tags"><span class="tag ${have ? 'ready' : ''}">you have ${have}</span></div>` : ''}
      </div>`
    }
    const groups = [...new Set(SK8.parts.map((p) => p.group))]
    box.innerHTML = groups.map((g) => `<h4>${esc(g)}</h4><div class="grid">${parts.filter((p) => p.group === g).map(card).join('')}</div>`).join('')
  } catch (err) {
    box.textContent = `Couldn't load the parts: ${wallet.errorMessage(err)}`
  }
}

// ------------------------------------------------------------------ drops

async function renderDrops() {
  const box = $('sk8Drops')
  try {
    const loaded = (await Promise.all(Object.entries(SK8.drops).map(([platform, ids]) => drops.loadDropsByIds(platform, ids)))).flat()
    const list = loaded.filter((d) => d.status === 'live' && !d.authRequired)
    await Promise.all(list.map(async (d) => {
      d.image = (await templateData(SK8.collection, d.templates[0])).img || ''
      d.name = partName(d.templates[0], d.name)
    }))
    const access = await Promise.all(list.map((d) => drops.readAccess(d).catch(() => ({ kind: 'public' }))))
    const groupOf = (d) => SK8.parts.find((p) => p.template === Number(d.templates[0]))?.group || 'Other'
    const groups = [...new Set(SK8.parts.map((p) => p.group)), 'Other']
    box.innerHTML = groups.map((g) => {
      const items = list.map((d, i) => [d, access[i]]).filter(([d]) => groupOf(d) === g)
      return items.length ? `<h4>${esc(g)}</h4>${items.map(([d, a]) => dropCard(d, a)).join('')}` : ''
    }).join('') || '<div class="item">No collab parts are on sale right now.</div>'
  } catch (err) {
    box.textContent = `Couldn't load the drops: ${wallet.errorMessage(err)}`
  }
}
bindDropClaims($('sk8Drops'))

// ----------------------------------------------------------------- boards

async function renderBoards() {
  const box = $('sk8Boards')
  try {
    boards = await nb.loadNeftyBlends(SK8.blendIds, SK8.collection)
    const order = { legendary: 0, rare: 1, uncommon: 2, common: 3 }
    boards.sort((a, b) => (order[a.resultData?.rarity] ?? 3) - (order[b.resultData?.rarity] ?? 3))
    box.innerHTML = boards.map(boardCard).join('')
  } catch (err) {
    box.textContent = `Couldn't load the recipes: ${wallet.errorMessage(err)}`
  }
}

function boardCard(b) {
  const r = b.resultData || {}
  const rarity = r.rarity || (b.pool ? 'common' : '')
  const p = owned ? nb.pick(b, owned) : {}
  const ready = b.supported && b.status === 'active' && p.ids
  const traits = ['trucks', 'wheels', 'bearings', 'speed', 'balance', 'pop'].filter((k) => r[k]).map((k) => `${k} ${r[k]}`).join(' · ')
  const left = b.status === 'active' && b.max ? `${Math.max(0, b.max - b.used)} of ${b.max} left` : ''
  const tag = b.status !== 'active' ? b.status.toUpperCase() : !owned ? '' : ready ? 'READY' : 'missing parts'
  const ings = b.ingredients.map((i) => {
    const have = owned ? (owned.get(i.template_id) || []).length : undefined
    return `<div class="ing">${imgTag(i.image, i.label, 'thumb')}<small>${i.amount} × ${esc(partName(i.template_id, (i.label || '').replace(/ \(.*\)$/, '')))}${have !== undefined ? `<br><span class="${have >= i.amount ? 'ok' : 'miss'}">have ${have}</span>` : ''}</small></div>`
  }).join('')
  return `
  <div class="farm board" data-blend="${esc(b.id)}">
    <div class="drop-head">
      ${imgTag(b.image, b.name)}
      <div>
        <h3>${esc(b.name)}</h3>
        ${rarity ? `<span class="tag">${esc(rarity.toUpperCase())}</span>` : ''}
        ${tag ? `<span class="tag ${ready ? 'ready' : ''}">${esc(tag)}</span>` : ''}
        <div><small>${esc(traits || (b.pool ? 'a ready-made board drawn from the pool' : ''))}${left ? ` · ${esc(left)}` : ''}</small></div>
      </div>
    </div>
    <div class="ings">${ings}</div>
    ${b.status === 'active' && b.supported ? `<button data-build="${esc(b.id)}" ${ready || !owned ? '' : 'disabled'}>Build this board</button>` : ''}
    <div class="result" hidden></div>
  </div>`
}

$('sk8Boards').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-build]')
  if (!btn) return
  const el = btn.closest('.board')
  const out = el.querySelector('.result')
  busy(btn, out, async () => {
    const b = boards.find((x) => x.id === btn.dataset.build)
    owned = await nb.ownedByTemplate(SK8.collection)
    const p = nb.pick(b, owned)
    if (!p.ids) throw new Error(`You're missing ${p.missing.amount} × ${partName(p.missing.template_id, p.missing.label || 'a part')} for this board.`)
    const parts = b.ingredients.map((i) => `${i.amount} × ${partName(i.template_id, i.label)}`).join(' + ')
    if (!confirm(`Build ${b.name}?\n\nThese parts are used up: ${parts}\n\nYou get: ${b.resultText}`)) return
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(nb.buildFuse(b, p.ids))
    show(out, `✅ Board built! It's on its way to your wallet. ${txLink(tx)}`, 'ok')
    setTimeout(refreshSk8, 3000)
  })
})


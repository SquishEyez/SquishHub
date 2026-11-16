// SK8 page: the SquishEyez × Sk8Coin collab. Collab parts, the live drops
// that sell them, the skateboard recipes, and the wallet's collab items.
import { SK8 } from './config.js'
import { templateData } from './chain.js'
import * as wallet from './wallet.js'
import * as drops from './drops.js'
import * as nb from './neftyblends.js'
import { dropCard, bindDropClaims } from './dropsPage.js'
import { $, esc, txLink, show, busy, imgTag } from './ui.js'

let boards = []
let owned

// Sk8Coin named both the deck and the wheels plain "SquishEyez"; use clear names.
const PART_NAMES = new Map(SK8.parts.map((p) => [p.template, p.label]))
const partName = (template, fallback) => PART_NAMES.get(Number(template)) || fallback

export async function refreshSk8() {
  owned = wallet.getSession() ? await nb.ownedByTemplate(SK8.collection).catch(() => undefined) : undefined
  await Promise.all([renderParts(), renderDrops(), renderBoards()])
}

// ------------------------------------------------------------------ parts

async function renderParts() {
  const box = $('sk8Parts')
  try {
    const parts = await Promise.all(SK8.parts.map(async (p) => ({ ...p, data: await templateData(SK8.collection, p.template) })))
    box.innerHTML = parts.map((p) => {
      const d = p.data
      const have = owned ? (owned.get(p.template) || []).length : undefined
      const traits = ['rarity', 'speed', 'balance', 'pop'].filter((k) => d[k]).map((k) => `${k} ${d[k]}`).join(' · ')
      return `
      <div class="card">
        ${imgTag(d.img, p.label)}
        <div class="name">${esc(p.label)}</div>
        <div><small>${esc(traits)}</small></div>
        <div><small>${d._max ? `${d._issued.toLocaleString('en-GB')} of ${d._max.toLocaleString('en-GB')} made` : ''}</small></div>
        ${have !== undefined ? `<div class="tags"><span class="tag ${have ? 'ready' : ''}">you have ${have}</span></div>` : ''}
      </div>`
    }).join('')
  } catch (err) {
    box.textContent = `Couldn't load the parts: ${wallet.errorMessage(err)}`
  }
}

// ------------------------------------------------------------------ drops

async function renderDrops() {
  const box = $('sk8Drops')
  try {
    const list = (await drops.loadDropsByIds('nefty', SK8.dropIds)).filter((d) => d.status === 'live')
    await Promise.all(list.map(async (d) => {
      d.image = (await templateData(SK8.collection, d.templates[0])).img || ''
      d.name = partName(d.templates[0], d.name)
    }))
    const access = await Promise.all(list.map((d) => drops.readAccess(d).catch(() => ({ kind: 'public' }))))
    box.innerHTML = list.map((d, i) => dropCard(d, access[i])).join('') || '<div class="item">No collab parts are on sale right now.</div>'
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


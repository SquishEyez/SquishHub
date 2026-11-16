// FARMS page: every SquishEyez WaxDAO farm with stake / unstake / claim.
import { COLLECTION } from './config.js'
import { getOwnedAssets } from './chain.js'
import * as wallet from './wallet.js'
import * as farms from './farms.js'
import { $, esc, txLink, show, busy, mediaHtml, assetName, mintOf, imgTag, fmtQty, fmtDate, fmtDuration, schemaName } from './ui.js'
import { templateLabel } from './chain.js'

let infos = new Map()     // farm name -> farm info
let stakes = new Map()    // `${version}:${name}` -> stake row
let wallet_assets = []    // the wallet's collection NFTs
let held = new Map()      // asset id -> asset (v1-staked NFTs held by waxdaofarmer)
const selected = new Map() // `${farm}:${mode}` -> Set of asset ids

const fmtDateMs = (ms) => (ms > 946684800000 ? fmtDate(ms / 1000) : '—')

export async function refreshFarms() {
  const list = $('farmList')
  try {
    const FARMS = await farms.getFarmList()
    const loaded = await Promise.all(FARMS.map((f) => farms.readFarmInfo(f.name, f.version).then((i) => ({ ...i, label: f.label }))))
    infos = new Map(loaded.map((i) => [i.name, i]))
    if (wallet.getSession()) {
      ;[stakes, wallet_assets] = await Promise.all([
        farms.readUserStakes(),
        getOwnedAssets(wallet.actor(), { collection_name: COLLECTION }),
      ])
      const v1ids = FARMS.filter((f) => f.version === 'v1').flatMap((f) => stakes.get(`v1:${f.name}`)?.assets || [])
      held = new Map((v1ids.length ? await farms.assetsById(v1ids) : []).map((a) => [String(a.asset_id), a]))
    } else {
      stakes = new Map(); wallet_assets = []; held = new Map()
    }
    selected.clear()
    // Name the templates a farm takes, instead of showing their numbers.
    await Promise.all(loaded.flatMap((f) => (f.rules || []).filter((r) => r.template_id).map(async (r) => { r.label = await templateLabel(r.collection, r.template_id) })))
    // Show live farms, plus any other farm where this wallet still has NFTs
    // staked or rewards to collect.
    const mine = (f) => { const st = stakes.get(`${f.version}:${f.name}`); return st && (st.assets.length || st.claimable.length) }
    const shown = loaded.filter((f) => f.exists && (f.status === 'live' || mine(f)))
    list.innerHTML = shown.map(farmCard).join('') || '<div class="item">No SquishEyez farm is open right now.</div>'
  } catch (err) {
    list.innerHTML = `<div class="item">Couldn't load the farms: ${esc(wallet.errorMessage(err))}</div>`
  }
}

/** What the wallet has in / for one farm. */
function farmState(f) {
  const stake = stakes.get(`${f.version}:${f.name}`)
  const stakedIds = new Set(stake?.assets || [])
  const stakedAssets = f.version === 'v1'
    ? [...stakedIds].map((id) => held.get(id) || { asset_id: id })
    : wallet_assets.filter((a) => stakedIds.has(String(a.asset_id)))
  // v2 farms: an NFT can only be staked in one v2 farm at a time.
  const v2Staked = new Set([...stakes.values()].filter((s) => s.version === 'v2').flatMap((s) => s.assets))
  const stakeable = wallet_assets.filter((a) =>
    farms.eligible(a, f) && !stakedIds.has(String(a.asset_id)) && (f.version === 'v1' || !v2Staked.has(String(a.asset_id))) &&
    a.is_transferable !== false)
  return { stake, stakedAssets, stakeable }
}

function picker(farm, mode, assets) {
  if (!assets.length) return ''
  return `<div class="picker" data-farm="${esc(farm)}" data-mode="${mode}">${assets.map((a) => `
    <div class="pick" data-id="${esc(a.asset_id)}">${mediaHtml(a)}${esc(assetName(a))} ${esc(mintOf(a))}<br><small>${esc(a.asset_id)}</small></div>`).join('')}</div>`
}

function farmCard(f) {
  const connected = Boolean(wallet.getSession())
  const { stake, stakedAssets, stakeable } = connected ? farmState(f) : { stakedAssets: [], stakeable: [] }
  const rules = f.rules.map((r) => r.template_id ? (r.label || `template #${r.template_id}`) : r.schema ? `${schemaName(r.schema)} NFTs` : `any ${r.collection === COLLECTION ? 'SquishEyez' : r.collection} NFT`).join(', ') || 'nothing yet'
  const locked = stake?.unlock && stake.unlock > Date.now()
  const meta = [
    `<strong>Status:</strong> ${esc(f.status)}`,
    `<strong>While staked:</strong> ${f.version === 'v1' ? 'your NFTs are held by the farm' : 'your NFTs stay in your wallet'}`,
    `<strong>Accepts:</strong> ${esc(rules)}`,
    f.perNft ? `<strong>Earns:</strong> ${esc(fmtQty(f.perNft))} per NFT per hour` : '',
    `<strong>Reward pool:</strong> ${esc(f.pool.split(' + ').map(fmtQty).join(' + '))} · ${f.totalStaked.toLocaleString('en-GB')} NFTs staked`,
    `<strong>${f.status === 'ended' ? 'Ended' : 'Ends'}:</strong> ${esc(fmtDateMs(f.ends))}`,
    f.lockSeconds ? `<strong>Lock:</strong> NFTs can be unstaked ${fmtDuration(f.lockSeconds)} after staking` : '',
  ].filter(Boolean).join('<br>')

  let mine = '<br><em>Connect your wallet to stake and claim.</em>'
  if (connected) {
    mine = `<br><strong>You:</strong> ${stakedAssets.length} staked · ${stake?.claimable.length ? `${esc(stake.claimable.map(fmtQty).join(' + '))} to claim` : 'nothing to claim yet'}` +
      (locked ? ` · locked until ${esc(fmtDateMs(stake.unlock))}` : '') +
      (f.open ? `<br>${stakeable.length ? `${stakeable.length} of your NFTs can be staked here.` : 'None of your NFTs fit this farm.'}` : '<br>This farm isn\'t taking new stakes.')
  }

  return `
  <div class="farm" data-farm="${esc(f.name)}">
    <div class="drop-head">${f.logo ? imgTag(f.logo, f.name) : ''}<h3>${esc(f.name)} — ${esc(f.label)}</h3></div>
    <div class="meta">${meta}${mine}</div>
    ${connected ? `
      <div class="row">
        <button data-act="claim" ${stake ? '' : 'disabled'}>CLAIM REWARDS</button>
      </div>
      ${f.open && stakeable.length ? `
        <p class="info">Tap the NFTs you want to stake:</p>${picker(f.name, 'stake', stakeable)}
        <div class="row"><button data-act="stake">STAKE SELECTED</button><button data-act="stakeall">STAKE ALL ${stakeable.length}</button></div>` : ''}
      ${stakedAssets.length ? `
        <p class="info">Your staked NFTs${locked ? ' (still locked)' : ''}. Tap the ones you want to unstake:</p>${picker(f.name, 'unstake', stakedAssets)}
        <div class="row"><button data-act="unstake" class="danger" ${locked ? 'disabled' : ''}>UNSTAKE SELECTED</button><button data-act="unstakeall" class="danger" ${locked ? 'disabled' : ''}>UNSTAKE ALL ${stakedAssets.length}</button></div>` : ''}
      <div class="result" hidden></div>` : ''}
  </div>`
}

async function runFarmAction(card, btn) {
  const f = infos.get(card.dataset.farm)
  const out = card.querySelector('.result')
  const act = btn.dataset.act
  const { stake, stakedAssets, stakeable } = farmState(f)
  const pickIds = (mode) => [...(selected.get(`${f.name}:${mode}`) || [])]
  await busy(btn, out, async () => {
    let actions, msg
    if (act === 'claim') {
      actions = await farms.buildClaim(f, stake)
      msg = `Rewards claimed from ${f.name}.`
    } else if (act === 'stake' || act === 'stakeall') {
      const ids = act === 'stakeall' ? stakeable.map((a) => String(a.asset_id)) : pickIds('stake')
      if (!ids.length) throw new Error('Tap the NFTs you want to stake first.')
      const note = f.version === 'v1'
        ? `\n\nThe farm holds your NFTs while they're staked${f.lockSeconds ? `, and you can unstake them after ${fmtDuration(f.lockSeconds)}` : ''}.`
        : '\n\nThe NFTs stay in your wallet.'
      if (!confirm(`Stake ${ids.length} NFT${ids.length === 1 ? '' : 's'} in ${f.name}?${note}`)) return
      actions = farms.buildStake(f, ids)
      msg = `${ids.length} NFT${ids.length === 1 ? '' : 's'} staked in ${f.name}.`
    } else {
      const ids = act === 'unstakeall' ? stakedAssets.map((a) => String(a.asset_id)) : pickIds('unstake')
      if (!ids.length) throw new Error('Tap the staked NFTs you want to unstake first.')
      if (!confirm(`Unstake ${ids.length} NFT${ids.length === 1 ? '' : 's'} from ${f.name}?`)) return
      actions = await farms.buildUnstake(f, ids)
      msg = `${ids.length} NFT${ids.length === 1 ? '' : 's'} unstaked from ${f.name}.`
    }
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(actions)
    show(out, `✅ ${esc(msg)} ${txLink(tx)}`, 'ok')
    setTimeout(refreshFarms, 2500)
  })
}

$('farmList').addEventListener('click', (e) => {
  const pick = e.target.closest('.pick')
  if (pick) {
    const box = pick.closest('.picker')
    const key = `${box.dataset.farm}:${box.dataset.mode}`
    if (!selected.has(key)) selected.set(key, new Set())
    const set = selected.get(key)
    const id = pick.dataset.id
    set.has(id) ? set.delete(id) : set.add(id)
    pick.classList.toggle('on', set.has(id))
    return
  }
  const btn = e.target.closest('button[data-act]')
  if (btn) runFarmAction(btn.closest('.farm'), btn)
})

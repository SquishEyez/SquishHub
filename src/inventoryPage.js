// INVENTORY page: token balances and the wallet's NFTs, each tagged with
// what it is good for in the hub (farm, wrap, fusion, pack).
import { COLLECTION, SQUISH_TOKEN, NEFTY_PACK_IDS } from './config.js'
import { getOwnedAssets, getCurrencyBalance, getRow } from './chain.js'
import * as wallet from './wallet.js'
import * as farms from './farms.js'
import { $, esc, mediaHtml, assetName, mintOf, schemaName } from './ui.js'

// Traits that tell look-alike NFTs apart (shards are all called "SquishShard").
const TRAITS = ['Shard', 'Piece', 'Style', 'Type', 'Size']
const traitsOf = (a) => { const d = a.data || {}; return TRAITS.map((k) => d[k]).filter(Boolean).join(' · ') }

let assets = []
let tagsFor = () => []

// Templates with a use in the hub (from the on-chain scan).
const USES = new Map([
  [710813, ['wrap ingredient']],
  [710874, ['unwrap → 69 SQUISH']],
  [718046, ['fusion ingredient']],
])

async function balances() {
  const who = wallet.actor()
  const [squish, wax] = await Promise.all([
    getCurrencyBalance(SQUISH_TOKEN.contract, who, SQUISH_TOKEN.symbol).catch(() => []),
    getCurrencyBalance('eosio.token', who, 'WAX').catch(() => []),
  ])
  const fmt = (b, sym) => (b[0] ? Number(b[0].split(' ')[0]).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0') + ' ' + sym
  return `<span>${esc(fmt(squish, 'SQUISH'))}</span><span>${esc(fmt(wax, 'WAX'))}</span>`
}

async function buildTagger() {
  const [stakes, infos, packRows] = await Promise.all([
    farms.readUserStakes(),
    farms.getFarmList().then((list) => Promise.all(list.map((f) => farms.readFarmInfo(f.name, f.version).catch(() => ({ exists: false }))))),
    Promise.all(NEFTY_PACK_IDS.map((id) => getRow('neftyblocksp', 'packs', id).catch(() => undefined))),
  ])
  const stakedIn = new Map()
  for (const s of stakes.values()) for (const id of s.assets) stakedIn.set(id, s.name)
  const packTemplates = new Set(packRows.filter(Boolean).map((r) => Number(r.pack_template_id)))
  const live = infos.filter((f) => f.exists && f.open)
  return (a) => {
    const t = []
    const tid = Number(a.template?.template_id ?? 0)
    const id = String(a.asset_id)
    if (stakedIn.has(id)) t.push({ text: `staked in ${stakedIn.get(id)}`, cls: 'staked' })
    else for (const f of live) if (farms.eligible(a, f)) t.push({ text: `can stake in ${f.name}`, cls: 'ready' })
    for (const u of USES.get(tid) || []) t.push({ text: u })
    if (a.schema?.schema_name === 'squishshardz') t.push({ text: 'fusion ingredient' })
    if (packTemplates.has(tid)) t.push({ text: 'pack: open it on HUB', cls: 'ready' })
    if (a.is_transferable === false) t.push({ text: 'can\'t be transferred' })
    return t
  }
}

export async function refreshInventory() {
  const grid = $('invGrid')
  if (!wallet.getSession()) {
    $('balances').textContent = 'Connect your wallet to see your NFTs and balances.'
    grid.innerHTML = ''; $('invSummary').textContent = ''
    return
  }
  $('invSummary').textContent = 'Loading your NFTs…'
  try {
    const [bal, owned, tagger] = await Promise.all([
      balances(),
      getOwnedAssets(wallet.actor(), { collection_name: COLLECTION }),
      buildTagger(),
    ])
    $('balances').innerHTML = bal
    assets = owned
    tagsFor = tagger
    const schemas = [...new Set(assets.map((a) => a.schema?.schema_name).filter(Boolean))].sort()
    const sel = $('invSchema')
    const keep = sel.value
    sel.innerHTML = '<option value="">All types</option>' + schemas.map((s) => `<option value="${esc(s)}" ${s === keep ? 'selected' : ''}>${esc(schemaName(s))}</option>`).join('')
    render()
  } catch (err) {
    $('invSummary').textContent = `Couldn't load your NFTs: ${wallet.errorMessage(err)}`
  }
}

function render() {
  const schema = $('invSchema').value
  const shown = assets.filter((a) => !schema || a.schema?.schema_name === schema)
  $('invSummary').textContent = `${shown.length.toLocaleString('en-GB')} SquishEyez NFT${shown.length === 1 ? '' : 's'}${assets.length >= 1000 ? ' (showing the first 1,000)' : ''}. NFTs staked in farms that hold them are listed on FARMS.`
  $('invGrid').innerHTML = shown.map((a) => `
    <div class="card">
      ${mediaHtml(a)}
      <div class="name">${esc(assetName(a))} ${esc(mintOf(a))}</div>
      ${traitsOf(a) ? `<div class="traits"><small>${esc(traitsOf(a))}</small></div>` : ''}
      <div><small>${esc(schemaName(a.schema?.schema_name))} · ID ${esc(a.asset_id)}</small></div>
      <div class="tags">${tagsFor(a).map((t) => `<span class="tag ${t.cls || ''}">${esc(t.text)}</span>`).join('')}</div>
    </div>`).join('')
}

$('invSchema').addEventListener('change', render)
$('invRefresh').addEventListener('click', refreshInventory)

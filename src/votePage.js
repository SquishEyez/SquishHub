// VOTE page: SquishDAO proposals, results and voting with your NFTs.
import { DAO_NAME } from './config.js'
import * as wallet from './wallet.js'
import * as dao from './dao.js'
import { $, esc, txLink, show, busy, fmtQty, fmtDate, schemaName } from './ui.js'

let current // { dao, proposals }

export async function refreshVote() {
  const info = $('daoInfo')
  const list = $('proposalList')
  info.textContent = 'Loading…'
  list.innerHTML = ''
  try {
    const d = await dao.readDao()
    if (!d) {
      current = undefined
      info.innerHTML = 'SquishDAO isn\'t open yet. Voting will appear here as soon as it opens.'
      $('newProposalBox').hidden = true
      return
    }
    const proposals = await dao.listProposals()
    current = { dao: d, proposals }
    const who = wallet.actor()
    let power = ''
    if (who) {
      const p = await dao.votingNfts(d, proposals[0]?.id ?? '0').catch(() => ({ owned: 0 }))
      power = `<br><strong>Your voting power:</strong> ${p.owned} vote${p.owned === 1 ? '' : 's'} (one per NFT)`
    }
    const canPropose = Boolean(who) && Number(d.proposer_type) !== 0
    info.innerHTML = `
      ${d.profile?.description ? `<p>${esc(d.profile.description)}</p>` : ''}
      <strong>Who votes:</strong> holders of ${esc(d.gov_schemas.map((s) => schemaName(s.schema_name)).join(', '))}<br>
      <strong>Voting lasts:</strong> ${Number(d.hours_per_proposal)} hours per proposal<br>
      <strong>Who can propose:</strong> ${Number(d.proposer_type) === 0 ? 'SquishEyez only' : `any holder (fee ${esc(fmtQty(d.proposal_cost))})`}
      ${power}`
    $('newProposalBox').hidden = !canPropose
    $('npFee').textContent = Number(String(d.proposal_cost).split(' ')[0]) > 0 ? `Submitting costs ${fmtQty(d.proposal_cost)} (WaxDAO's fee).` : ''
    if (!proposals.length) {
      list.innerHTML = '<div class="item">No proposals yet.</div>'
      return
    }
    const votes = who ? await Promise.all(proposals.map((p) => dao.votesFor(p.id).catch(() => []))) : []
    list.innerHTML = proposals.map((p, i) => card(p, votes[i]?.find((v) => v.wallet === who))).join('')
  } catch (err) {
    info.textContent = `Couldn't load SquishDAO: ${wallet.errorMessage(err)}`
  }
}

function card(p, myVote) {
  const status = p.open ? `OPEN · ends ${fmtDate(p.end)}` : `CLOSED ${fmtDate(p.end)}${p.finalized ? '' : ' · awaiting result'}`
  const choices = p.choices.map((c) => {
    const pct = p.total ? Math.round((c.votes / p.total) * 100) : 0
    const canVote = p.open && wallet.getSession() && !myVote
    return `
      <div class="choice">
        ${esc(c.text)} — ${c.votes} vote${c.votes === 1 ? '' : 's'} (${pct}%)
        <div class="bar"><span style="width:${pct}%"></span></div>
        ${canVote ? `<button data-vote="${c.choice}" class="small">Vote ${esc(c.text)}</button>` : ''}
      </div>`
  }).join('')
  const mine = myVote ? `<p class="info">✅ You voted with ${myVote.assets.length} NFT${myVote.assets.length === 1 ? '' : 's'}.</p>` : ''
  const winner = !p.open && p.leading ? `<p><strong>Result:</strong> ${esc(p.leading.text)} (${p.leading.votes} of ${p.total} votes)</p>` : ''
  return `
  <div class="farm proposal" data-id="${esc(p.id)}">
    <h3>#${esc(p.id)} ${esc(p.title)}</h3>
    <span class="tag ${p.open ? 'ready' : ''}">${esc(status)}</span> <small>by ${esc(p.author)}</small>
    <p>${esc(p.description)}</p>
    ${winner}${choices}${mine}
    ${!p.open && !p.finalized && wallet.getSession() ? '<button data-finalize="1">Record the final result</button>' : ''}
    <div class="result" hidden></div>
  </div>`
}

$('proposalList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-vote], button[data-finalize]')
  if (!btn || !current) return
  const el = btn.closest('.proposal')
  const p = current.proposals.find((x) => x.id === el.dataset.id)
  const out = el.querySelector('.result')
  busy(btn, out, async () => {
    let actions
    if (btn.dataset.finalize) {
      actions = dao.buildFinalize(p)
    } else {
      const choice = Number(btn.dataset.vote)
      const { usable, owned } = await dao.votingNfts(current.dao, p.id)
      if (!usable.length) throw new Error(owned ? 'All your eligible NFTs have already voted on this.' : 'You need an OG or Season 2 SquishEyez to vote.')
      const text = p.choices.find((c) => c.choice === choice)?.text
      if (!confirm(`Vote "${text}" on #${p.id} "${p.title}"?\n\nYour ${usable.length} eligible NFT${usable.length === 1 ? '' : 's'} count as ${usable.length} vote${usable.length === 1 ? '' : 's'}. They stay in your wallet. Votes can't be changed.`)) return
      actions = dao.buildVote(p, choice, usable)
    }
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(actions)
    show(out, `✅ ${btn.dataset.finalize ? 'Result recorded.' : 'Vote counted!'} ${txLink(tx)}`, 'ok')
    setTimeout(refreshVote, 2500)
  })
})

// ------------------------------------------------------------ new proposal

$('npType').addEventListener('change', () => { $('npOptionsRow').hidden = $('npType').value !== '0' })

$('npSubmit').addEventListener('click', (e) => {
  const out = $('npResult')
  busy(e.currentTarget, out, async () => {
    if (!current?.dao) throw new Error('SquishDAO is not set up yet.')
    const type = Number($('npType').value)
    const options = $('npOptions').value.split('\n').map((s) => s.trim()).filter(Boolean)
    const actions = dao.buildProposal({ title: $('npTitle').value, description: $('npDesc').value, type, options }, current.dao.proposal_cost, DAO_NAME)
    const fee = Number(String(current.dao.proposal_cost).split(' ')[0]) > 0 ? ` for ${fmtQty(current.dao.proposal_cost)}` : ''
    if (!confirm(`Submit "${$('npTitle').value.trim()}"${fee}? Voting runs for ${Number(current.dao.hours_per_proposal)} hours.`)) return
    show(out, 'Approve in your wallet…')
    const tx = await wallet.transact(actions)
    show(out, `✅ Proposal submitted. ${txLink(tx)}`, 'ok')
    $('npTitle').value = ''
    $('npDesc').value = ''
    $('npOptions').value = ''
    setTimeout(refreshVote, 2500)
  })
})

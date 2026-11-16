// Wallet connection and signing through WharfKit.
//
// SessionKit (not a bare Session) is what logs a user in: it shows the
// wallet picker, talks to Anchor / WAX Cloud Wallet, and remembers the
// session so a page reload stays connected.
import { SessionKit } from '@wharfkit/session'
import { WebRenderer } from '@wharfkit/web-renderer'
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor'
import { WalletPluginCloudWallet } from '@wharfkit/wallet-plugin-cloudwallet'

import { APP_NAME, APP_RETURN_URL, WAX_CHAIN_ID, WAX_RPC_ENDPOINTS } from './config.js'
import { getAbi, getCurrencyBalance, getTableRows } from './chain.js'
import { loadLinks, permissionFor } from './permissions.js'

// Inside the Android app (Capacitor) the page runs in a WebView: Anchor is
// reached through `esr:` deep links that the app hands to the Anchor app,
// and Anchor returns with APP_RETURN_URL. WAX Cloud Wallet runs in a popup
// window, which the app opens in-app (android PopupChromeClient.java).
export const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.())

const walletPlugins = [
  isNativeApp
    ? new WalletPluginAnchor({ mode: 'app', transport: { generateReturnUrl: () => APP_RETURN_URL } })
    : new WalletPluginAnchor(),
  new WalletPluginCloudWallet(),
]

const sessionKit = new SessionKit({
  appName: APP_NAME,
  chains: [{ id: WAX_CHAIN_ID, url: WAX_RPC_ENDPOINTS[0] }],
  ui: new WebRenderer(),
  walletPlugins,
})

let session

export const getSession = () => session
export const actor = () => (session ? String(session.actor) : '')
export const walletName = () => (session ? (String(session.walletPlugin?.id) === 'cloudwallet' ? 'WAX Cloud Wallet' : 'Anchor') : '')

export async function restore() {
  session = (await sessionKit.restore()) || undefined
  if (session) await loadAccountLinks()
  return session
}

/** In the Android app: whether Anchor (or another esr: wallet) is installed. */
export async function walletAppInstalled() {
  if (!isNativeApp) return true
  try {
    const res = await window.Capacitor.Plugins.WalletCheck.hasEsrHandler()
    return Boolean(res?.installed)
  } catch {
    return true // unknown: let the login try
  }
}

/** wallet: 'anchor' | 'cloudwallet' — goes straight to that wallet. */
export async function login(wallet = 'anchor') {
  const { session: s } = await sessionKit.login({ walletPlugin: wallet })
  session = s
  await loadAccountLinks()
  return session
}

export async function logout() {
  if (session) await sessionKit.logout(session)
  session = undefined
}

let links = []
const loadAccountLinks = async () => { links = await loadLinks(actor()) }

/** Builds an action authorised by the connected account. */
export function act(account, name, data) {
  return {
    account,
    name,
    authorization: [{ actor: actor(), permission: permissionFor(links, String(session.permission), account, name) }],
    data,
  }
}

/** Signs and broadcasts; returns the transaction id. */
export async function transact(actions) {
  if (!session) throw new Error('Connect your wallet first.')
  const result = await session.transact({ actions })
  const id = result?.response?.transaction_id || result?.resolved?.transaction?.id
  return id ? String(id) : ''
}

/**
 * The `open` action a payout needs when the wallet has never held that token:
 * some contracts refuse to pay into a balance row that does not exist.
 */
export async function openIfNeeded(contract, quantityOrSymbol) {
  const [q, symbol] = String(quantityOrSymbol).includes(' ')
    ? String(quantityOrSymbol).split(' ')
    : [undefined, quantityOrSymbol]
  try {
    const bal = await getCurrencyBalance(contract, actor(), symbol)
    if (bal.length) return []
    const abi = await getAbi(contract)
    if (!abi?.actions?.some((a) => a.name === 'open')) return []
    let precision = q ? (q.split('.')[1] || '').length : undefined
    if (precision === undefined) {
      const [stat] = await getTableRows({ code: contract, scope: symbol, table: 'stat', limit: 1 })
      precision = stat ? (String(stat.supply).split(' ')[0].split('.')[1] || '').length : 0
    }
    return [act(contract, 'open', { owner: actor(), symbol: `${precision},${symbol}`, ram_payer: actor() })]
  } catch {
    return []
  }
}

/** Human-readable reason from a WharfKit / chain error. */
export function errorMessage(err) {
  const details = err?.response?.json?.error?.details || err?.error?.details
  let msg = details?.[0]?.message || err?.message || String(err)
  msg = msg.replace(/^assertion failure with message:\s*/i, '')
  return msg
}

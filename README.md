# SquishHub

```
C:\SQUISH> HUB.EXE
```

The all-in-one hub for the **SquishEyez** NFT collection
([`ssquisheyezz`](https://wax.atomichub.io/explorer/collection/wax-mainnet/ssquisheyezz) on WAX)
and its token, **$SQUISH**. It talks straight to the WAX smart contracts, so it
keeps working without the NeftyBlocks, NFTHive or WaxDAO websites. Runs as a
website and as an Android app, with a DOS look.

Every action is something a holder does with **their own** NFTs and tokens:
the contracts check each one against the wallet that signs it.

## Pages

| | |
|---|---|
| **F1 Hub** | Wrap 69 $SQUISH into a CD-R NFT and back; fuse Season 2 Shardz (Top + Bottom + Blend Diskette → Squisheye²); open packs |
| **F2 Drops** | Every SquishEyez drop on NeftyBlocks and NFTHive: buy or claim live ones, withdraw unspent deposits |
| **F3 Farms** | Stake, unstake and claim $SQUISH on the SquishEyez farms |
| **F4 Vote** | SquishDAO: one vote per OG / Season 2 SquishEyez, nothing staked; results and proposals |
| **F5 Bag** | Your $SQUISH, WAX and SquishEyez NFTs, tagged with what each is good for |

Every page shows the **$SQUISH** window: supply against the 963,369 cap, what
is left to mint, what sits in farm reward pools, and the holder count.

Wallets: **Anchor** (Android app via deep link, or desktop) and **WAX Cloud Wallet**.

## Command prompt

The status line is a working prompt: `HELP`, `HUB`, `DROPS`, `FARMS`, `VOTE`,
`BAG`, `CD FARMS`, `CONNECT`, `CLOUD`, `LOGOUT`, `WHOAMI`,
`THEME GREEN|AMBER|BLUE|GREY`, `VER`, `CLS`. F1–F5 switch pages.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # website -> dist/
npm run android:build  # Android APK (see ANDROID.md)
```

**Netlify:** connect the repository; `netlify.toml` builds with `npm run build`
and publishes `dist/`.

## Code map

| File | |
|---|---|
| `src/config.js` | Collection, token, contracts, farms, blends, packs, DAO |
| `src/chain.js` | WAX + AtomicAssets reads with failover, formatting helpers |
| `src/wallet.js`, `src/permissions.js` | WharfKit login (Anchor, Cloud Wallet) and signing |
| `src/blends.js`, `src/neftyblends.js`, `src/packs.js` | Wrap/unwrap, Shardz fusion, packs |
| `src/drops.js`, `src/dropsPage.js` | Drops on NeftyBlocks and NFTHive |
| `src/farms.js`, `src/farmsPage.js` | Farms |
| `src/dao.js`, `src/votePage.js` | SquishDAO voting |
| `src/token.js` | $SQUISH supply |
| `src/inventoryPage.js` | Bag |
| `src/dos.js`, `src/ui.js`, `index.html` | DOS shell, UI helpers, layout and themes |

Every transaction the app builds was checked with `compute_transaction` on WAX
mainnet: the node runs it exactly as if signed, without signing or saving it.

© 2026 Next Door Media (UK)

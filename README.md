# Arbitrage Bot

This was an arb bot made to profit from beet pool imbalances for the project Mainstreet Finance. However, after the 10/10 incident, smsUSD was sunset, and permissionless arbing is no longer possible for their relaunch. So I am open-sourcing this bot here. Check the relaunched Mainstreet out [here](https://mainstreet.finance/)

## Steps

The bot implements a three-step arbitrage strategy:

1. **Mint**: Convert USDC to msUSD using the PermissionlessMainstreetMinter
2. **Swap**: Exchange msUSD for ghUSDC in the Balancer pool
3. **Redeem**: Convert ghUSDC back to USDC using the SiloVault

Profit is generated from pool imbalances and price differences between these tokens.

## Prerequisites

- Node.js 18+
- TypeScript 5+
- npm or yarn
- EVM wallet with private key
- $S for gas fees
- USDC for arbitrage operations

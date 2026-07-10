# CircularDAO

A decentralized governance and tokenization framework for solid waste management in recycling cooperatives.

CircularDAO integrates, in a single blockchain framework: (i) a **Digital Waste Passport** implemented as an ERC-1155 token; (ii) two distinct ERC-20 tokens — **DAOG** for governance and **CRC** for circular credits; and (iii) **on-chain voting** based on the OpenZeppelin Governor standard. The DApp is accessible from a conventional browser through an injected EIP-1193 provider, with no wallet-extension requirement.

This repository accompanies the research article *"CircularDAO: a decentralized governance and tokenization framework for solid waste management in recycling cooperatives"* (Universidade Paulista — UNIP, Graduate Program in Production Engineering).

## Smart contracts

| Contract | Standard/Type | Role |
|---|---|---|
| `GovernanceToken` | ERC-20 (Votes) | Governance token (DAOG) with checkpoints for vote delegation and quorum |
| `StakeholderRegistry` | RBAC | Role-based registration: cooperative, recycler, auditor, government |
| `WasteCategoryRegistry` | Registry | Waste categories with credit factor (CRC/kg) and hazard level |
| `MaterialPassport` | ERC-1155 (NFT) | Digital Waste Passport per batch: unique ID, hash, lifecycle status |
| `CircularCredit` | ERC-20 | Circular credits (CRC) proportional to type and weight of recycled waste |
| `RecyclingRewards` | Incentive | Bonuses for cooperatives performing above target |
| `WasteTracker` | Tracking | Batch status: collected, sorted, processing, recycled, reinserted |
| `CircularDAO` | Governor + DAO | Hybrid governance: immutable rules, on-chain voting, public transparency panel |

Built with Solidity 0.8.28 and OpenZeppelin v5. Governance parameters (`votingDelay`, `votingPeriod`) are constructor-parameterized: 60 blocks were used for the public testnet experiment; 50400 blocks (≈7 days) are recommended for production.

## Sepolia testnet deployment

All contracts are deployed and publicly verifiable on the Sepolia testnet — addresses in [`deployments/sepolia.json`](deployments/sepolia.json). The complete governance-cycle experiment (proposal → 3 independent voting wallets → execution), with transaction hashes, gas costs, and latency measurements, is reported in [`deployments/sepolia-experiment.md`](deployments/sepolia-experiment.md).

## Getting started

```bash
npm install
npx hardhat compile

# Local proof of concept (ephemeral network, short governance cycle)
npx hardhat run scripts/test-short-cycle.js --network hardhat

# Full local environment
npx hardhat node                                            # terminal 1
VOTING_PERIOD=60 npx hardhat run scripts/deploy-all.js --network localhost
npm run ui                                                  # syncs contracts.json and serves the DApp
```

To reproduce the Sepolia experiment, set `SEPOLIA_PK` (funded deployer key) and optionally `SEPOLIA_RPC` in `.env`, then:

```bash
npx hardhat run scripts/sepolia-cycle.js --network sepolia
node scripts/report-sepolia.js > deployments/sepolia-experiment.md
```

The script is idempotent: progress is checkpointed in `deployments/sepolia-experiment.json` (git-ignored — it stores the generated voter keys) and re-running resumes from the last completed step.

## DApp

`dao-ui/novo.html` is a single-file, mobile-first interface (HTML5/CSS3/JavaScript + ethers.js v6) served by any static web server. It injects an EIP-1193-compatible provider so that cooperative members can interact with the DAO without installing a wallet extension. `dao-ui/sepolia/` points the same UI at the Sepolia deployment.

## License

MIT

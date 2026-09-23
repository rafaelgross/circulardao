// Config for protocol section 6 calibration, Strategy A (historical fork +
// impersonation replay). Separate from hardhat.config.ablation.js because
// forking is unique to this one experiment — B1-B4/N-sweep/checkpoint/token
// comparison all start from an empty local chain, not a fork.
//
// evmVersion stays "cancun" (matches the actual deployed bytecode on
// Sepolia, confirmed unchanged since the evaluated commit — protocol step
// 0.1). The forked network's OWN consensus rules come from the real chain
// at the forked block, not from a `hardfork` setting here — Hardhat forking
// uses the remote node's actual state and block context.
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun"
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
        blockNumber: 11761430 // one block before S1's first transaction (11761431)
      },
      // Same reasoning as hardhat.config.ablation.js: a real chain mines a
      // reverting transaction with status 0 instead of rejecting it outright
      // (verified against this project's own Sepolia deployment), and the
      // repeated-vote replay below needs a genuine receipt, not a client-side
      // throw. throwOnCallFailures stays at its default (true) for the same
      // reason documented there — the repeat-vote's staticCall-based revert
      // decoding depends on it.
      throwOnTransactionFailures: false
    }
  }
};

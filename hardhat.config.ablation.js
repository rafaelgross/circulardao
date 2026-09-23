// Separate config for the ablation RUNNER SCRIPTS only (not `hardhat test`,
// which keeps using the default config in hardhat.config.js).
//
// Hardhat Network's local in-process chain rejects a reverting transaction
// outright by default (throwOnTransactionFailures/throwOnCallFailures), even
// with an explicit gasLimit — unlike a real chain (verified against this
// project's own Sepolia deployment), which mines it with status 0. The
// ablation runner needs the real-chain behavior to record a genuine receipt
// for every "expected revert" step (protocol section 9: "preservar os
// recibos completos de todas as transações... incluindo as que revertem").
// Flipping these off only for this config keeps hardhat-chai-matchers'
// revertedWith/revertedWithCustomError (used throughout test/) working
// exactly as before in the default config, which relies on the opposite
// behavior (the call throwing) to detect a revert.
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
      hardfork: "cancun",
      throwOnTransactionFailures: false,
      throwOnCallFailures: false
    }
  }
};

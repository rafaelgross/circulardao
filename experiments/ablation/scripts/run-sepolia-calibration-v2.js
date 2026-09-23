// Runner for protocol section 6 (v1.4), calibration Strategy A: historical
// fork + impersonation replay of the REAL Sepolia S1 transactions, against
// the REAL, already-deployed, already-verified PRODUCTION contracts
// (CircularDAO governor + GovernanceToken + WasteCategoryRegistry at their
// real Sepolia addresses) — not the experimental T1VotesERC20/CircularDAO
// re-deployment the Round-1 version of this script used.
//
// Supersedes run-sepolia-calibration.js (kept, not deleted — it is Round 1's
// record of what was actually compared then, flagged as flawed by the v1.4
// correction roadmap for exactly the two reasons this version fixes: (a) it
// reproduced the S1 cycle against the EXPERIMENTAL token, not the deployed
// production GovernanceToken; (b) it ran under hardfork "cancun", not the
// hardfork Sepolia was actually enforcing at the S1 block (Fusaka/Osaka,
// confirmed via WebSearch against theblock.co/blog.ethereum.org/
// cointelegraph.com — Sepolia's Fusaka activation was 2025-10-14, well
// before S1's 2026-09-23 block).
//
// How this works: hardhat.config.ablation-fork.js forks Sepolia at block
// 11761430 (one block before S1's first transaction). This process's own
// eth_call/eth_getStorageAt reads against the governor/token/registry
// addresses below return REAL historical Sepolia state — confirmed
// empirically before writing this script (a throwaway fork test read the
// deployer's real historical balance, 83,000 DAOG, matching the on-chain
// checkpoint record in sepolia_deployer_checkpoints.json). The 7 real S1
// transactions (exact to/data/value, fetched via eth_getTransactionByHash
// against the public RPC and saved in sepolia_s1_real_transactions.json) are
// then RESENT, in original order, from IMPERSONATED copies of the real
// sender accounts — so the exact same calldata executes against the exact
// same contract bytecode and exact same pre-transaction state Sepolia itself
// had, and the gas this process measures is a genuine local re-execution,
// not an estimate or a functional approximation.
//
// Read-only against Sepolia itself: the only network access this script
// makes to the real chain is the fork's initial state read (via the RPC
// endpoint), inherited automatically by every eth_call the fork serves
// locally afterward. No transaction is ever sent to real Sepolia.
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { newRun, recordTx, step, recordQuery, verifyIntegrity, STATE } = require("./lib");

const GOVERNOR_ADDR = "0xB72737A3D35c00Afa8e2ff0Ba435eE635Ee66767";
const TOKEN_ADDR = "0x1fe6C81a52033BA4A2db34d82aBfDa77d88eb020";
const REGISTRY_ADDR = "0x329615cE2142A6bae05691144d0bEaEd4c014D6a";
const SEPOLIA_DEPLOY_COMMIT = "21387bcc7b55da0ef89127a9400613d7bb22b2c4";

// Real Sepolia S1 gas, from experiment-v2/run-2026-09-23T00-37-39-899Z/transactions.csv
const SEPOLIA_S1 = {
  propose: 666054,
  vote_for_1: 83384,
  vote_for_2: 66284,
  vote_for_3: 66284,
  vote_against: 83343,
  repeated_vote: 38224,
  execute: 398089,
};
// Maps each real tx (by its real block number, the only stable identifier
// across the two datasets) to the etapa label used in SEPOLIA_S1/receipts.
// Decoded directly from each real tx's calldata (castVote's last 32-byte
// word is `support`; 1=for, 0=against) — verified with a throwaway script
// before writing this mapping by hand: block 11761438 is the AGAINST vote
// (support=0), not 11761437 as an earlier draft of this mapping assumed.
const ETAPA_BY_BLOCK = {
  11761431: "propose",
  11761434: "vote_for_1",   // support=1, 0x77ba4167...
  11761435: "vote_for_2",   // support=1, 0xbe8b7e9e...
  11761437: "vote_for_3",   // support=1, 0x1a01f765...
  11761438: "vote_against", // support=0, 0x7022852b...
  11761440: "repeated_vote", // support=1, same sender as 11761434 (0x77ba4167...) — the real repeat-vote attempt that reverted on Sepolia itself
  11761494: "execute",
};

async function main() {
  const ctx = newRun("sepolia-calibration-v2-strategyA");
  ctx.manifest.calibrationStrategy = {
    chosen: "A",
    reason: "Confirmed viable before writing this script: forking Sepolia at block 11761430 via the public RPC endpoint successfully read real historical state (deployer balance 83,000 DAOG, matching sepolia_deployer_checkpoints.json). Strategy B (functional reconstruction) was the fallback if this had failed.",
    forkBlock: 11761430,
    realTxSource: "experiments/ablation/results/sepolia_s1_real_transactions.json (fetched via eth_getTransactionByHash against ethereum-sepolia-rpc.publicnode.com)",
    sepoliaDeployCommit: SEPOLIA_DEPLOY_COMMIT,
  };
  ctx.manifest.governedOperation = { target: "WasteCategoryRegistry.addCategory(...)", proposedVia: "proposeAddCategory (the real Sepolia S1 call itself, replayed byte-for-byte — its actual selector, confirmed against the real tx's input, is what's replayed, not a re-encoding)" };
  ctx.manifest.contracts = { governor: GOVERNOR_ADDR, token: TOKEN_ADDR, registry: REGISTRY_ADDR, note: "real, already-deployed, already-verified Sepolia production contracts read through the fork — not redeployed, not the experimental T1VotesERC20/CircularDAO used in the other four sub-experiments" };

  const realTxs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "results", "sepolia_s1_real_transactions.json"), "utf8"));
  if (realTxs.length !== 7) throw new Error(`expected 7 real S1 transactions, found ${realTxs.length} — dataset changed?`);

  const governor = await ethers.getContractAt("CircularDAO", GOVERNOR_ADDR);
  const registry = await ethers.getContractAt("WasteCategoryRegistry", REGISTRY_ADDR);
  const token = await ethers.getContractAt("GovernanceToken", TOKEN_ADDR);

  // Sanity check BEFORE replaying anything: the fork must actually be
  // serving real historical Sepolia state, not an empty local chain — if
  // this contract has no code (fork misconfigured / wrong network), fail
  // loudly here instead of producing silently-meaningless "gas" numbers.
  const code = await ethers.provider.getCode(GOVERNOR_ADDR);
  if (code === "0x") throw new Error("fork sanity check failed: no code at the real governor address — is this running under hardhat.config.ablation-fork.js?");
  const deployerBalance = await token.balanceOf("0xF44c9Fe8A1f0fF317225E06d59065bfb25442701");
  recordQuery(ctx, {
    etapa: "fork_sanity_check", variante: "Ref", condicao: "6-calibration-strategyA",
    query: "token.balanceOf(deployer) on the fork, at block 11761430",
    expected: "83000000000000000000000 (matches sepolia_deployer_checkpoints.json's checkpoint at fromBlock 11761222)",
    actual: deployerBalance.toString(), ok: deployerBalance === ethers.parseEther("83000"),
  });

  const uniqueSenders = [...new Set(realTxs.map((t) => t.from))];
  const signers = {};
  for (const addr of uniqueSenders) {
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
    // Top up ETH on the fork only (never touches real Sepolia — this account
    // is impersonated locally). Needed because the fork's local gas pricing
    // (current base fee) is higher than what these accounts' real historical
    // balances were sized for at the time they actually sent these
    // transactions on Sepolia — confirmed by hitting a real "not enough
    // funds" revert-before-broadcast on the first attempt. This affects only
    // whether the tx can be SENT, not the gas it consumes once mined, which
    // is what every comparison below measures.
    await hre.network.provider.send("hardhat_setBalance", [addr, "0x56BC75E2D63100000"]); // 100 ETH
    signers[addr] = await ethers.getSigner(addr);
  }

  // The real chain had large natural gaps between these transactions'
  // blocks (unrelated Sepolia traffic in between) — 3 blocks between propose
  // and the first vote, 54 between the last vote and execute — which is what
  // let votingDelay/votingPeriod elapse on the real deployment. Hardhat's
  // fork auto-mines exactly one block per transaction with no such gaps, so
  // replaying the 7 real transactions back-to-back with nothing in between
  // undershoots those windows (confirmed by hitting a real
  // GovernorUnexpectedProposalState(...,Pending) revert on the first
  // attempt). Explicitly mining votingDelay/votingPeriod blocks at the two
  // points that matter reproduces the SAME governance-window semantics the
  // real gaps produced, without needing to reproduce the gaps' exact size
  // (block count) — only their effect (proposal state) is what any of this
  // depends on.
  const votingDelay = await governor.votingDelay();
  const votingPeriod = await governor.votingPeriod();

  let proposalId = null;
  const localGas = {};
  const localHashes = {};

  for (const realTx of realTxs) {
    const etapa = ETAPA_BY_BLOCK[realTx.blockNumber];
    if (!etapa) throw new Error(`no etapa mapping for real tx at block ${realTx.blockNumber} — ETAPA_BY_BLOCK is out of date`);
    const signer = signers[realTx.from];
    const isRepeat = etapa === "repeated_vote";

    const req = { to: realTx.to, data: realTx.input, value: BigInt(realTx.value) };
    let receipt;
    if (isRepeat) {
      receipt = await step(ctx,
        { variante: "Ref", etapa, condicao: "6-calibration-strategyA", funcao: "castVote", operacao_governada: "WasteCategoryRegistry.addCategory" },
        () => signer.sendTransaction({ ...req, gasLimit: realTx.gas }),
        { expectRevert: true, decodeFn: () => ethers.provider.call({ ...req, from: realTx.from }) });
    } else {
      receipt = await step(ctx,
        { variante: "Ref", etapa, condicao: "6-calibration-strategyA", funcao: etapa === "propose" ? "proposeAddCategory" : etapa === "execute" ? "execute" : "castVote", operacao_governada: "WasteCategoryRegistry.addCategory" },
        () => signer.sendTransaction(req));
    }

    localGas[etapa] = Number(receipt.gasUsed);
    localHashes[etapa] = receipt.hash;

    if (etapa === "propose") {
      const created = receipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "ProposalCreated");
      if (!created) throw new Error("propose replay did not emit ProposalCreated — real tx data may not match the governor's current ABI");
      proposalId = created.args.proposalId;
      console.log(`  replayed propose -> proposalId=${proposalId}`);
      await hre.network.provider.send("hardhat_mine", ["0x" + (votingDelay + 1n).toString(16)]);
      const stateAfterDelay = STATE[Number(await governor.state(proposalId))];
      recordQuery(ctx, { etapa: "check_state_after_voting_delay", variante: "Ref", condicao: "6-calibration-strategyA", query: "governor.state(proposalId) after mining votingDelay+1 blocks", expected: "Active", actual: stateAfterDelay, ok: stateAfterDelay === "Active" });
    }
    if (etapa === "repeated_vote") {
      // The repeat attempt must still land while Active — otherwise its
      // revert reason would be the window closing (GovernorUnexpectedProposalState),
      // not GovernorAlreadyCastVote, which is specifically what this step
      // exists to reproduce (matching B4's check in run-b1-b4.js). Only
      // AFTER it do we mine past votingPeriod, reproducing the effect of the
      // real chain's 54-block gap before its own execute call.
      await hre.network.provider.send("hardhat_mine", ["0x" + (votingPeriod + 1n).toString(16)]);
    }
  }

  // Confirm the replayed cycle reached the same real-world outcome (Executed)
  // before trusting the gas comparison below — a gas number from a cycle
  // that silently diverged in OUTCOME would be comparing two different
  // things by accident.
  const finalState = STATE[Number(await governor.state(proposalId))];
  recordQuery(ctx, { etapa: "check_final_state", variante: "Ref", condicao: "6-calibration-strategyA", query: "governor.state(proposalId) after replaying the full S1 cycle", expected: "Executed", actual: finalState, ok: finalState === "Executed" });

  console.log("\n=== Section 6 calibration (v1.4, Strategy A): local fork replay vs. real Sepolia S1 ===");
  console.log("(exact real transactions, real production contracts, real historical state — not a functional reconstruction)\n");
  const rows = [];
  for (const key of Object.keys(SEPOLIA_S1)) {
    const sep = SEPOLIA_S1[key];
    const loc = localGas[key];
    const diff = loc - sep;
    const pct = ((diff / sep) * 100).toFixed(2);
    rows.push({ operation: key, sepolia_gas: sep, local_replay_gas: loc, diff_gas: diff, diff_pct: pct, sepolia_tx_hash: realTxs.find((t) => ETAPA_BY_BLOCK[t.blockNumber] === key).hash, local_replay_tx_hash: localHashes[key] });
    console.log(`  ${key.padEnd(14)} sepolia=${String(sep).padStart(8)}  local_replay=${String(loc).padStart(8)}  diff=${String(diff).padStart(7)} (${pct}%)`);
  }

  verifyIntegrity(ctx);

  fs.writeFileSync(path.join(ctx.outDir, "calibration.json"), JSON.stringify({
    strategy: "A — historical fork + impersonation replay of the real transactions",
    sepoliaSource: "experiment-v2/run-2026-09-23T00-37-39-899Z/transactions.csv",
    sepoliaDeployCommit: SEPOLIA_DEPLOY_COMMIT,
    forkBlock: 11761430,
    rows,
  }, null, 2));

  ctx.manifest.finishedAt = new Date().toISOString();
  ctx.manifest.calibration = rows;
  fs.writeFileSync(path.join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json, queries.json, calibration.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

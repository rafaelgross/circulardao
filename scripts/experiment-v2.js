/**
 * CircularDAO - extended governance evaluation on Ethereum Sepolia
 * ================================================================
 *
 * Runs six governance scenarios against the deployed contracts and records,
 * for every transaction, the hash, block number, gas used, effective gas price
 * and submit-to-confirmation latency.
 *
 *   S1  approved proposal          quorum met, majority in favour, executed on-chain
 *   S2  defeated proposal          quorum met, majority against, not executable
 *   S3  quorum failure             majority in favour but participation below quorum
 *   S4  late-acquisition attempt   tokens acquired AFTER the snapshot carry zero weight
 *   S5  weighted vs. simple count  3 wallets outvote 1, but the 1 outweighs them in tokens
 *   S6  DAO exclusive authority    deployer's direct admin attempts revert post-deployment
 *
 * S4 is the important one: it turns the checkpoint argument in the paper from a
 * claim into a measurement. The attacker wallet receives a large balance after
 * the proposal becomes active, self-delegates, and votes. The script asserts
 * that the recorded tally does not move.
 *
 * S3's small holder is deliberately funded with a quarter of quorum (not a
 * full quorum-worth, which every other voter gets) — otherwise "quorum
 * failure" is not actually reachable: one wallet holding exactly quorum
 * clears it by voting at all, and the scenario proves nothing.
 *
 * S5 is the only scenario where wallet-count and token-weight majorities
 * disagree (3 wallets vote For, 1 much larger wallet votes Against), so it's
 * the only one that actually demonstrates ballots are weighted, not counted
 * one-address-one-vote. S6 re-uses S1's already-executed proposal as its
 * "the DAO path still works" evidence and adds two new transactions that are
 * expected to revert (direct parameter change, self-re-granting the revoked
 * admin role) — on-chain proof for the C1 fix (see the contracts roadmap).
 *
 * Pass/fail semantics
 *   Every scenario's actual outcome is checked against what it's supposed to
 *   prove — not just logged. A failed check does not stop the run (the other
 *   scenarios are independent and still worth collecting), but it is recorded
 *   in outcomes[].valid/notes, folds into the overall exit code (non-zero if
 *   anything failed), and is impossible to miss in summary.md. S1 additionally
 *   reads back the registered category after execute() and compares every
 *   field against what was proposed — reaching state Executed is necessary
 *   but not sufficient evidence that the right data landed.
 *
 * On-chain evidence for reverts
 *   S1's repeated vote, S2's execute-while-defeated and both of S6's direct
 *   attempts are sent as real transactions with an explicit gasLimit (not
 *   staticCall'd), so a revert produces a genuine mined transaction with
 *   status 0 — verified against this project's actual Sepolia deployment:
 *   the same call with no gasLimit throws client-side before broadcast (no
 *   hash, nothing on Etherscan); with an explicit gasLimit it lands on-chain.
 *   Each such attempt also replays as a staticCall to decode which specific
 *   error caused the revert (e.g. AccessControlUnauthorizedAccount,
 *   GovernorAlreadyCastVote) — status 0 alone doesn't distinguish "the guard
 *   worked" from "ran out of gas" or "bad arguments".
 *
 * Wallet reuse across runs
 *   Voter and attacker wallets are persisted in sepolia-wallets.json and
 *   reused run to run to save ETH funding costs. S4 depends on the attacker
 *   wallet holding zero DAOG before the attack; if a previous run already
 *   gave it a balance, that precondition silently stops being true. S4
 *   checks the attacker's live balance and delegation before doing anything
 *   and fails fast, with a clear instruction, instead of quietly producing a
 *   weaker result.
 *
 * Usage
 *   npx hardhat run scripts/experiment-v2.js --network sepolia                # dry run, prints the plan
 *   RUN_EXPERIMENT=yes npx hardhat run scripts/experiment-v2.js --network sepolia # executes
 *
 * Hardhat's own CLI parser rejects any unrecognized flag (including a bare
 * `--` separator) when you invoke `npx hardhat run ...` directly, so the
 * trigger is an env var instead of a `-- --yes` argv flag.
 *
 * Only runs on Sepolia (chain id 11155111). Refuses to run anywhere else.
 *
 * Proposal payload
 *   Every scenario proposes through CircularDAO.proposeAddCategory(...), the
 *   same entry point used by the Section 6.2 run (scripts/sepolia-cycle.js),
 *   not a hand-built call to WasteCategoryRegistry.addCategory(). That wrapper
 *   forwards its arguments as (code, name, unit, creditsPerKg, hazardLevel,
 *   regulation) into a target whose own parameters are declared (name, code,
 *   color, creditsPerKg, hazard, regulation) - the labels are swapped, but the
 *   positions land correctly, which is exactly why the argument order below
 *   mirrors sepolia-cycle.js instead of being re-derived from the registry
 *   ABI. hazardLevel is the Hazard enum's uint8 encoding (0=NONE..4=TOXIC);
 *   passing anything outside that range reverts at execute() time, after the
 *   voting window has already closed.
 *
 * Every results file (transactions.json/csv, outcomes.json, summary.md) is
 * written to a per-run, timestamped folder instead of a fixed path, so
 * re-running never silently overwrites a previous run's evidence.
 *
 * SECURITY
 *   The deployer key is taken from the Hardhat network config, which reads it
 *   from .env. Extra wallets are generated locally and written to
 *   sepolia-wallets.json. Both files are in .gitignore. This script never
 *   prints a private key. Verify with:
 *       git ls-files | grep -iE "\.env|sepolia-wallets\.json"
 *   The command above must return nothing. Never copy this script (or
 *   sepolia-wallets.json) into a directory served by a web server — if it's
 *   ever run from there, the wallets file would be written straight into a
 *   publicly reachable path.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const hre = require('hardhat');
const { ethers } = hre;

/* ------------------------------------------------------------------ config */

const CONFIG = {
  chainId: 11155111n,

  // Addresses of the deployed suite (deployments/sepolia.json). Override with
  // env vars if you redeploy. This is the post-fix (C1-C7) redeploy from
  // 2026-09-22, votingDelay=1 votingPeriod=60 (~12 min) — deployed with
  // VOTING_DELAY=1 VOTING_PERIOD=60 explicitly, unlike the first redeploy
  // attempt that used the 7-day production default by mistake.
  governor: process.env.DAO_ADDRESS || '0xB72737A3D35c00Afa8e2ff0Ba435eE635Ee66767',
  token: process.env.TOKEN_ADDRESS || '0x1fe6C81a52033BA4A2db34d82aBfDa77d88eb020',
  registry: process.env.REGISTRY_ADDRESS || '0x329615cE2142A6bae05691144d0bEaEd4c014D6a',

  // Contract names as they appear in artifacts/, used to resolve the ABI.
  governorName: 'CircularDAO',
  tokenName: 'GovernanceToken',
  registryName: 'WasteCategoryRegistry',

  // Number of independent voting wallets, beyond the deployer. The 6th wallet
  // the original plan generated was never referenced by any scenario.
  voters: 5,

  // ETH sent to each new wallet so it can pay for its own votes.
  fundingPerWallet: '0.004',

  // Confirmations to wait for before reading a receipt.
  confirmations: 1,

  baseOutDir: path.join(__dirname, '..', 'experiment-v2'),
  walletsFile: path.join(__dirname, '..', 'sepolia-wallets.json'),
};

// Per-run output folder so re-running never overwrites a previous run's
// evidence. `runId` doubles as the on-chain proposal-description suffix.
const runId = new Date().toISOString().replace(/[:.]/g, '-');
CONFIG.outDir = path.join(CONFIG.baseOutDir, `run-${runId}`);

const EXECUTE = process.argv.includes('--yes') || process.env.RUN_EXPERIMENT === 'yes';

/* --------------------------------------------------------------- utilities */

const log = (...a) => console.log(...a);
const hr = () => log('-'.repeat(78));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString('en-US');

const ledger = [];
let outcomes = [];
let allValid = true;
let metaSoFar = {};

/**
 * Marks a check against an outcome object. Does not throw or stop the run —
 * the remaining scenarios are independent and still worth collecting — but
 * flips the run's overall validity, which controls the final exit code and
 * the banner printed at the end. `outcome.valid` starts undefined and, once
 * set to false by any check, stays false regardless of later checks.
 */
function checkOutcome(outcome, ok, note) {
  outcome.valid = outcome.valid === false ? false : ok;
  (outcome.notes ||= []).push(`${ok ? 'PASS' : 'FAIL'}: ${note}`);
  log(`    ${ok ? 'PASS' : 'FAIL'}: ${note}`);
  if (!ok) allValid = false;
}

/**
 * Sends a transaction and records every figure the paper needs.
 * `send` must be a function returning a transaction response.
 */
async function record(scenario, label, send) {
  const t0 = Date.now();
  const tx = await send();
  let receipt;
  try {
    receipt = await tx.wait(CONFIG.confirmations);
  } catch (e) {
    // ethers v6 throws tx.wait() on a mined-but-reverted transaction. This
    // path is only supposed to see successful transactions, but if one of
    // them reverts unexpectedly, record its hash/gas before re-throwing —
    // otherwise the evidence for exactly the transaction that broke the run
    // is the one line missing from transactions.json.
    receipt = e.receipt || await ethers.provider.getTransactionReceipt(tx.hash);
    const latencyMs = Date.now() - t0;
    const price = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
    ledger.push({
      n: ledger.length + 1, scenario, label, hash: receipt.hash, block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: price.toString(),
      costEth: ethers.formatEther(receipt.gasUsed * price), latencyMs, status: receipt.status,
    });
    flush();
    throw new Error(`${label}: expected to succeed but reverted on-chain (${receipt.hash}).`);
  }
  const latencyMs = Date.now() - t0;

  const price = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  const entry = {
    n: ledger.length + 1,
    scenario,
    label,
    hash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: price.toString(),
    costEth: ethers.formatEther(receipt.gasUsed * price),
    latencyMs,
    status: receipt.status,
  };
  ledger.push(entry);
  log(
    `  [${String(entry.n).padStart(2)}] ${label.padEnd(46)} ` +
    `gas ${fmt(entry.gasUsed).padStart(9)}  ${(latencyMs / 1000).toFixed(1)}s  ${entry.hash}`
  );
  flush();
  return receipt;
}

/**
 * Like record(), but for a transaction whose outcome (success or revert) is
 * itself the evidence — used by S1 (double vote), S2 (execute a defeated
 * proposal) and S6 (deployer locked out post-deployment). Sends the tx,
 * records it in the ledger either way (a reverted tx still gets a real hash
 * on Etherscan), and throws if the outcome doesn't match what was expected,
 * so a broken assumption fails loudly instead of silently producing
 * misleading "evidence".
 *
 * IMPORTANT: `send` must pass an explicit `gasLimit` override when the call
 * is expected to revert. Without one, ethers v6 runs eth_estimateGas first;
 * a call that would revert fails at that step and the transaction is never
 * broadcast at all — no hash, nothing on Etherscan, just a client-side
 * error. Verified against this project's actual Sepolia deployment: the
 * same call with no gasLimit throws before broadcast, and with
 * `{ gasLimit: 200000 }` it lands on-chain with status 0.
 *
 * `decode`, if given, is called as a staticCall BEFORE the real transaction
 * is sent, purely to capture which specific error caused the revert. Status
 * 0 alone doesn't distinguish "the access-control guard fired" from "ran out
 * of gas" or "wrong arguments" — the decoded error name/message does.
 */
async function recordAttempt(scenario, label, send, expectRevert, decode) {
  let revertReason = null;
  if (expectRevert && decode) {
    try {
      await decode();
      revertReason = '(staticCall did not revert — see status below)';
    } catch (e) {
      revertReason = e.shortMessage || e.reason || e.message;
    }
  }

  const t0 = Date.now();
  let tx;
  try {
    tx = await send();
  } catch (e) {
    throw new Error(
      `${label}: reverted before broadcast (no transaction was ever sent). ` +
      `Pass an explicit gasLimit override so the revert happens on-chain instead. ` +
      `Original error: ${e.shortMessage || e.message}`
    );
  }
  let receipt;
  try {
    receipt = await tx.wait(CONFIG.confirmations);
  } catch (e) {
    // ethers v6 throws on a mined-but-reverted transaction; recover the
    // receipt so a reverted attempt is still recorded, not lost.
    receipt = e.receipt || await ethers.provider.getTransactionReceipt(tx.hash);
  }
  const latencyMs = Date.now() - t0;
  const price = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  const entry = {
    n: ledger.length + 1,
    scenario,
    label,
    hash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: price.toString(),
    costEth: ethers.formatEther(receipt.gasUsed * price),
    latencyMs,
    status: receipt.status,
    revertReason,
  };
  ledger.push(entry);
  const statusLabel = receipt.status === 1 ? 'ok' : 'reverted';
  log(
    `  [${String(entry.n).padStart(2)}] ${label.padEnd(46)} ` +
    `gas ${fmt(entry.gasUsed).padStart(9)}  ${statusLabel.padEnd(8)} ${entry.hash}`
  );
  if (revertReason) log(`       reason: ${revertReason}`);
  flush();
  if (expectRevert && receipt.status !== 0) {
    throw new Error(`${label}: expected this to revert, but it succeeded.`);
  }
  if (!expectRevert && receipt.status !== 1) {
    throw new Error(`${label}: expected this to succeed, but it reverted.`);
  }
  return { receipt, revertReason };
}

function flush() {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(CONFIG.outDir, 'transactions.json'),
    JSON.stringify(ledger, null, 2)
  );
}

async function currentBlock() {
  return ethers.provider.getBlockNumber();
}

/** Waits until the chain reaches `target`, printing progress. */
async function waitForBlock(target, what) {
  let last = -1;
  for (;;) {
    const b = await currentBlock();
    if (b >= target) return b;
    if (b !== last) {
      log(`    waiting for ${what}: block ${b} of ${target} (${target - b} to go)`);
      last = b;
    }
    await sleep(6000);
  }
}

const STATE = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];

/* ------------------------------------------------- target call construction */

/**
 * Category payload for one scenario. hazardLevel is the Hazard enum's uint8
 * value (0 NONE, 1 LOW, 2 MEDIUM, 3 HIGH, 4 TOXIC) - keep it in [0,4].
 */
function categoryPayload(scenario, stamp) {
  return {
    name: 'Eletronico de Informatica',
    code: `EWASTE_IT_${scenario}_${stamp}`,
    color: '#4a90d9',
    creditsPerKg: 25n,
    hazardLevel: 2, // MEDIUM, matches the Section 6.2 precedent for this category
    regulation: 'Decreto Federal 10.240/2020 (logistica reversa de eletroeletronicos)',
  };
}

/**
 * Creates a proposal through CircularDAO.proposeAddCategory (the same entry
 * point sepolia-cycle.js used), then recomputes the proposal id locally so
 * later calls (state, execute) don't depend on parsing logs.
 */
async function createProposal(governor, registry, scenario, payload, title, description) {
  log(`    payload: addCategory("${payload.name}", "${payload.code}", "${payload.color}", ` +
      `${payload.creditsPerKg}, ${payload.hazardLevel}, "${payload.regulation}")`);

  const receipt = await record(scenario, 'proposeAddCategory', () =>
    governor.proposeAddCategory(
      payload.name, payload.code, payload.color, payload.creditsPerKg,
      payload.hazardLevel, payload.regulation, title, description
    ));

  // Authoritative: read the id from the ProposalCreated event instead of
  // trusting a locally rebuilt calldata, which can drift from what the
  // wrapper actually encoded.
  const created = receipt.logs
    .map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === 'ProposalCreated');
  if (!created) throw new Error('ProposalCreated not found in the receipt logs');
  const proposalId = created.args.proposalId;

  // execute() still needs targets/values/calldatas/descriptionHash to
  // recompute the id itself, so this must match byte-for-byte. Check it here,
  // right after propose(), instead of finding out after the voting window.
  const calldata = registry.interface.encodeFunctionData('addCategory', [
    payload.name, payload.code, payload.color, payload.creditsPerKg,
    payload.hazardLevel, payload.regulation,
  ]);
  const descHash = ethers.id(description);
  const expectedId = await governor.hashProposal([CONFIG.registry], [0], [calldata], descHash);
  if (expectedId !== proposalId) {
    throw new Error(
      `Rebuilt calldata does not match the proposal actually created ` +
      `(event id ${proposalId}, rebuilt id ${expectedId}). execute() would fail ` +
      `after the voting window. Check categoryPayload() against WasteCategoryRegistry.addCategory().`
    );
  }

  // Public RPC gateways load-balance across multiple backend nodes that are
  // not always perfectly in sync; reading proposalSnapshot immediately after
  // the proposing transaction confirmed can occasionally hit a node that
  // hasn't caught up yet, returning 0 for a proposal that genuinely exists
  // (verified once against this project's own deployment: a "snapshot 0"
  // proposalId, re-queried a few minutes later, had a real snapshot/deadline
  // and was Active). Retry briefly instead of treating a stale read as a
  // real "proposal doesn't exist" state.
  let snapshot = await governor.proposalSnapshot(proposalId);
  for (let i = 0; snapshot === 0n && i < 5; i++) {
    log(`    proposalSnapshot read 0 (attempt ${i + 1}/5) — likely RPC lag, retrying in 5s...`);
    await sleep(5000);
    snapshot = await governor.proposalSnapshot(proposalId);
  }
  if (snapshot === 0n) {
    throw new Error(
      `proposalSnapshot(${proposalId}) still 0 after retries. Either the proposing transaction ` +
      `did not actually create this proposal, or the RPC endpoint is unusually inconsistent — ` +
      `check ${receipt.hash} on Etherscan before re-running.`
    );
  }
  const deadline = await governor.proposalDeadline(proposalId);
  log(`    proposalId ${proposalId}`);
  log(`    snapshot block ${snapshot}, deadline block ${deadline}`);

  return { proposalId, calldata, descHash, snapshot, deadline, receipt };
}

async function tally(governor, proposalId) {
  const [against, forVotes, abstain] = await governor.proposalVotes(proposalId);
  return { against, forVotes, abstain };
}

/**
 * Reads the final state and tally, and classifies WHY a proposal landed
 * where it did — a bare `state` of Defeated does not distinguish "quorum was
 * never reached" from "quorum was reached but the vote failed on the merits",
 * and Section 6 of the paper needs that distinction, not just the raw enum.
 */
async function reportOutcome(governor, proposalId, scenario, unit, extra = {}) {
  const state = Number(await governor.state(proposalId));
  const t = await tally(governor, proposalId);
  const q = await governor.quorum(await governor.proposalSnapshot(proposalId));
  const quorumMet = (t.forVotes + t.abstain) >= q;
  const voteSucceeded = t.forVotes > t.against;

  let reason;
  if (state === 7) reason = 'Executed';
  else if (voteSucceeded && quorumMet) reason = 'ApprovedNotYetExecuted';
  else if (!quorumMet) reason = 'RejectedByQuorum';
  else reason = 'RejectedByVote';

  log(`    state: ${STATE[state]}  (${reason})`);
  log(`    for ${fmt(t.forVotes / unit)} DAOG  against ${fmt(t.against / unit)} DAOG  quorum ${fmt(q / unit)} DAOG  quorumMet=${quorumMet}`);

  return {
    scenario,
    state: STATE[state],
    reason,
    quorumMet,
    voteSucceeded,
    forVotes: (t.forVotes / unit).toString(),
    against: (t.against / unit).toString(),
    abstain: (t.abstain / unit).toString(),
    quorum: (q / unit).toString(),
    proposalId: proposalId.toString(),
    ...extra,
  };
}

/* --------------------------------------------------------------------- main */

async function main() {
  hr();
  log('CircularDAO - extended governance evaluation');
  hr();

  const net = await ethers.provider.getNetwork();
  if (net.chainId !== CONFIG.chainId) {
    throw new Error(`Refusing to run on chain ${net.chainId}. This script is for Sepolia (${CONFIG.chainId}).`);
  }

  const [deployer] = await ethers.getSigners();
  const governor = await ethers.getContractAt(CONFIG.governorName, CONFIG.governor);
  const token = await ethers.getContractAt(CONFIG.tokenName, CONFIG.token);
  const registry = await ethers.getContractAt(CONFIG.registryName, CONFIG.registry);

  let gitCommit = null;
  try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
  } catch { /* not fatal if git isn't available */ }

  metaSoFar = {
    runId,
    chainId: net.chainId.toString(),
    governor: CONFIG.governor,
    token: CONFIG.token,
    registry: CONFIG.registry,
    deployer: deployer.address,
    gitCommit,
    startedAt: new Date().toISOString(),
  };

  const decimals = await token.decimals();
  const unit = 10n ** BigInt(decimals);
  const deployerBalance = await token.balanceOf(deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  const votingDelay = await governor.votingDelay();
  const votingPeriod = await governor.votingPeriod();
  const blockNow = await currentBlock();
  const quorumNow = await governor.quorum(BigInt(blockNow) - 1n);

  log(`network        Sepolia (${net.chainId})`);
  log(`deployer       ${deployer.address}`);
  log(`  ETH          ${ethers.formatEther(ethBalance)}`);
  log(`  DAOG         ${fmt(deployerBalance / unit)}`);
  log(`governor       ${CONFIG.governor}`);
  log(`  votingDelay  ${votingDelay} blocks`);
  log(`  votingPeriod ${votingPeriod} blocks (~${(Number(votingPeriod) * 12 / 60).toFixed(0)} min)`);
  log(`  quorum       ${fmt(quorumNow / unit)} DAOG`);
  hr();

  /* ---- plan the token distribution from the live quorum -------------- */

  const q = quorumNow / unit;                       // quorum in whole tokens
  const perWallet = q;                              // one quorum-worth each, for voters 1..N-1
  const smallHolder = q / 4n === 0n ? 1n : q / 4n;   // last voter (S3): deliberately below quorum
  const plan = {
    s1For: [q, q, q],
    s1Against: [q],
    s2For: [q],
    s2Against: [q, q, q],
    s3For: [smallHolder],
    s4Attacker: q * 5n,
  };

  const needed = perWallet * BigInt(CONFIG.voters - 1) + smallHolder + plan.s4Attacker;

  log('plan');
  log(`  voting wallets to use     ${CONFIG.voters} (plus the deployer)`);
  log(`  tokens per wallet         ${fmt(perWallet)} DAOG (= 1x quorum), last voter gets ${fmt(smallHolder)} DAOG (S3)`);
  log(`  attacker allocation (S4)  ${fmt(plan.s4Attacker)} DAOG, transferred after the snapshot`);
  log(`  total to distribute       ${fmt(needed)} DAOG`);
  log(`  deployer holds            ${fmt(deployerBalance / unit)} DAOG`);
  if (deployerBalance / unit < needed) {
    log('  WARNING: deployer balance is below the plan. Reduce CONFIG.voters or mint more.');
  }
  const ethNeeded = Number(CONFIG.fundingPerWallet) * (CONFIG.voters + 1);
  const gasReserveEth = 0.03;
  const ethTotalNeeded = ethNeeded + gasReserveEth;
  log(`  ETH for wallet funding    ~${ethNeeded.toFixed(3)} plus ~${gasReserveEth.toFixed(3)} gas reserve = ~${ethTotalNeeded.toFixed(3)}`);
  log(`  deployer ETH               ${ethers.formatEther(ethBalance)}`);
  if (Number(ethers.formatEther(ethBalance)) < ethTotalNeeded) {
    log(`  WARNING: deployer ETH balance is below the plan (~${ethTotalNeeded.toFixed(3)} needed). ` +
        `Top up 0xF44c9Fe8A1f0fF317225E06d59065bfb25442701 on Sepolia before running with RUN_EXPERIMENT=yes, ` +
        `or the run will fail mid-way with OutOfFunds after already spending gas.`);
  }
  hr();

  if (!EXECUTE) {
    log('Dry run. Nothing was sent.');
    log('Re-run with:  RUN_EXPERIMENT=yes npx hardhat run scripts/experiment-v2.js --network sepolia');
    return;
  }

  /* ---- wallets ------------------------------------------------------- */

  let wallets = [];
  if (fs.existsSync(CONFIG.walletsFile)) {
    wallets = JSON.parse(fs.readFileSync(CONFIG.walletsFile, 'utf8'));
    log(`reusing ${wallets.length} wallets from sepolia-wallets.json`);
  }
  while (wallets.length < CONFIG.voters + 1) {          // +1 for the attacker
    const w = ethers.Wallet.createRandom();
    wallets.push({ address: w.address, privateKey: w.privateKey });
  }
  fs.writeFileSync(CONFIG.walletsFile, JSON.stringify(wallets, null, 2));
  fs.chmodSync(CONFIG.walletsFile, 0o600);
  log(`sepolia-wallets.json now holds ${wallets.length} wallets. Keep it out of git.`);

  const signers = wallets.map((w) => new ethers.Wallet(w.privateKey, ethers.provider));
  const voters = signers.slice(0, CONFIG.voters);
  const attacker = signers[CONFIG.voters];

  hr();
  log('funding and delegation');
  for (const [i, s] of voters.entries()) {
    const isSmallHolder = i === voters.length - 1;
    const target = isSmallHolder ? smallHolder : perWallet;

    const bal = await ethers.provider.getBalance(s.address);
    if (bal < ethers.parseEther(CONFIG.fundingPerWallet) / 2n) {
      await record('setup', `fund voter ${i + 1}`, () =>
        deployer.sendTransaction({ to: s.address, value: ethers.parseEther(CONFIG.fundingPerWallet) }));
    }
    const tb = await token.balanceOf(s.address);
    if (tb < target * unit) {
      await record('setup', `transfer ${fmt(target)} DAOG to voter ${i + 1}${isSmallHolder ? ' (S3 small holder)' : ''}`, () =>
        token.connect(deployer).transfer(s.address, target * unit - tb));
    }
    if ((await token.delegates(s.address)) !== s.address) {
      await record('setup', `self-delegate voter ${i + 1}`, () => token.connect(s).delegate(s.address));
    }
  }
  // The attacker is funded with ETH now but receives tokens only after the S4 snapshot.
  if (await ethers.provider.getBalance(attacker.address) < ethers.parseEther(CONFIG.fundingPerWallet) / 2n) {
    await record('setup', 'fund attacker wallet', () =>
      deployer.sendTransaction({ to: attacker.address, value: ethers.parseEther(CONFIG.fundingPerWallet) }));
  }
  if ((await token.delegates(deployer.address)) !== deployer.address) {
    await record('setup', 'self-delegate deployer', () => token.connect(deployer).delegate(deployer.address));
  }

  const stamp = Date.now();

  /* ---- S1: approved and executed ------------------------------------- */

  let s1ExecuteHash = null;

  hr();
  log('S1  approved proposal, quorum met, executed on-chain');
  {
    const payload = categoryPayload('S1', stamp);
    const title = 'S1 approved - register IT electronics at 25 CRC/kg';
    const description = `${title} - ${stamp}`;
    const p = await createProposal(governor, registry, 'S1', payload, title, description);
    await waitForBlock(Number(p.snapshot) + 1, 'proposal to become Active');

    for (const [i, s] of voters.slice(0, 3).entries()) {
      await record('S1', `vote FOR, voter ${i + 1}`, () => governor.connect(s).castVote(p.proposalId, 1));
    }
    await record('S1', 'vote AGAINST, voter 4', () => governor.connect(voters[3]).castVote(p.proposalId, 0));

    // A second vote from the same wallet must revert. Sent for real (with an
    // explicit gasLimit) so it lands on-chain with status 0, and replayed as
    // a staticCall first to confirm the specific error.
    await recordAttempt(
      'S1', 'repeated vote, voter 1 (expect revert)',
      () => governor.connect(voters[0]).castVote(p.proposalId, 1, { gasLimit: 200000 }),
      true,
      () => governor.connect(voters[0]).castVote.staticCall(p.proposalId, 1)
    );

    await waitForBlock(Number(p.deadline) + 1, 'voting window to close');

    const preExecuteState = Number(await governor.state(p.proposalId));
    if (preExecuteState === 4) {   // Succeeded
      const execReceipt = await record('S1', 'execute proposal', () =>
        governor.execute([CONFIG.registry], [0], [p.calldata], p.descHash));
      s1ExecuteHash = execReceipt.hash;
    }

    // Report AFTER attempting execute, so the recorded state is the true
    // final one (Executed) rather than the pre-execute Succeeded snapshot.
    const o = await reportOutcome(governor, p.proposalId, 'S1', unit, {
      snapshot: p.snapshot.toString(), deadline: p.deadline.toString(), executeHash: s1ExecuteHash,
    });
    checkOutcome(o, o.state === 'Executed', `proposal reached Executed (got ${o.state})`);

    // Reaching Executed proves the governance path ran; it does not prove
    // the right data landed. Read the registered category back and compare
    // every field against what was proposed.
    if (o.state === 'Executed') {
      const registered = await registry.getCategoryByCode(payload.code);
      const fieldChecks = [
        ['name', registered.name === payload.name],
        ['code', registered.code === payload.code],
        ['color', registered.color === payload.color],
        ['creditsPerKg', registered.creditsPerKg === payload.creditsPerKg],
        ['hazard', Number(registered.hazard) === payload.hazardLevel],
        ['regulation', registered.regulation === payload.regulation],
        ['active', registered.active === true],
      ];
      const mismatches = fieldChecks.filter(([, ok]) => !ok).map(([f]) => f);
      checkOutcome(o, mismatches.length === 0,
        mismatches.length === 0
          ? 'registered category matches the proposed payload field-for-field'
          : `registered category mismatches: ${mismatches.join(', ')}`);
      o.registeredCategoryId = registered.id.toString();
    }

    outcomes.push(o);
  }

  /* ---- S6: DAO exclusive authority, evidenced on-chain ---------------- */
  // Re-uses S1's already-executed proposal as "the DAO path succeeds" leg —
  // running a second full propose/vote/execute cycle here would just double
  // the cost without adding evidence. This scenario adds the two attempts
  // that are expected to revert: direct parameter change, and the deployer
  // re-granting itself the admin role that the C1 fix revoked at deploy time.

  hr();
  log('S6  DAO exclusive authority: deployer locked out post-deployment');
  {
    const s6 = { scenario: 'S6' };
    const ADMIN_ROLE = await registry.ADMIN_ROLE();
    const stillAdmin = await registry.hasRole(ADMIN_ROLE, deployer.address);
    log(`    deployer still holds WasteCategoryRegistry.ADMIN_ROLE: ${stillAdmin}`);

    // This is a hard failure of the property under test, not a skip: if the
    // deployer still has admin, C1 did not hold for this deployment and the
    // run's overall result must reflect that, not silently omit S6.
    checkOutcome(s6, !stillAdmin, 'deployer does NOT hold WasteCategoryRegistry.ADMIN_ROLE post-deployment');

    if (!stillAdmin) {
      const attempt1 = await recordAttempt(
        'S6', 'deployer direct updateCredits (expect revert)',
        () => registry.connect(deployer).updateCredits(1, 999, { gasLimit: 200000 }),
        true,
        () => registry.connect(deployer).updateCredits.staticCall(1, 999)
      );
      const attempt2 = await recordAttempt(
        'S6', 'deployer re-grants self ADMIN_ROLE (expect revert)',
        () => registry.connect(deployer).grantRole(ADMIN_ROLE, deployer.address, { gasLimit: 200000 }),
        true,
        () => registry.connect(deployer).grantRole.staticCall(ADMIN_ROLE, deployer.address)
      );
      checkOutcome(s6, attempt1.receipt.status === 0, `direct updateCredits reverted (${attempt1.revertReason})`);
      checkOutcome(s6, attempt2.receipt.status === 0, `self-regrant of ADMIN_ROLE reverted (${attempt2.revertReason})`);
      checkOutcome(s6, !!s1ExecuteHash, `DAO path already proven working: S1 execute ${s1ExecuteHash}`);
      s6.attempt1Hash = attempt1.receipt.hash;
      s6.attempt2Hash = attempt2.receipt.hash;
      s6.daoPathEvidenceHash = s1ExecuteHash;
    }
    outcomes.push(s6);
  }

  /* ---- S2: defeated on the merits ------------------------------------ */

  hr();
  log('S2  defeated proposal, quorum met, majority against');
  {
    const payload = categoryPayload('S2', stamp);
    const title = 'S2 defeated - register category at an excessive factor';
    const description = `${title} - ${stamp}`;
    const p = await createProposal(governor, registry, 'S2', payload, title, description);
    await waitForBlock(Number(p.snapshot) + 1, 'proposal to become Active');

    await record('S2', 'vote FOR, voter 1', () => governor.connect(voters[0]).castVote(p.proposalId, 1));
    for (const [i, s] of voters.slice(1, 4).entries()) {
      await record('S2', `vote AGAINST, voter ${i + 2}`, () => governor.connect(s).castVote(p.proposalId, 0));
    }

    await waitForBlock(Number(p.deadline) + 1, 'voting window to close');
    const o = await reportOutcome(governor, p.proposalId, 'S2', unit, {
      snapshot: p.snapshot.toString(), deadline: p.deadline.toString(),
    });
    // Must be defeated BY THE VOTE, with quorum met — otherwise this is
    // indistinguishable from S3 (quorum failure) and proves nothing extra.
    checkOutcome(o, o.quorumMet, `quorum was met (for+abstain vs quorum: ${o.forVotes}+${o.abstain} vs ${o.quorum})`);
    checkOutcome(o, o.reason === 'RejectedByVote', `rejected by vote count, not by quorum (reason=${o.reason})`);
    outcomes.push(o);

    // Sent for real (gasLimit forces broadcast) and replayed as a staticCall
    // first to confirm the specific revert reason.
    const attempt = await recordAttempt(
      'S2', 'execute the defeated proposal (expect revert)',
      () => governor.execute([CONFIG.registry], [0], [p.calldata], p.descHash, { gasLimit: 300000 }),
      true,
      () => governor.execute.staticCall([CONFIG.registry], [0], [p.calldata], p.descHash)
    );
    checkOutcome(o, attempt.receipt.status === 0, `execute() on a defeated proposal reverted (${attempt.revertReason})`);
  }

  /* ---- S3: quorum failure -------------------------------------------- */

  hr();
  log('S3  quorum failure, majority in favour but participation below quorum');
  {
    const payload = categoryPayload('S3', stamp);
    const title = 'S3 quorum failure - minor parameter change';
    const description = `${title} - ${stamp}`;
    const p = await createProposal(governor, registry, 'S3', payload, title, description);
    await waitForBlock(Number(p.snapshot) + 1, 'proposal to become Active');

    // Only the smallest holder votes, and it votes in favour.
    const small = voters[voters.length - 1];
    const weight = await governor.getVotes(small.address, p.snapshot);
    const quorumAtSnapshot = await governor.quorum(p.snapshot);
    log(`    only one wallet votes, weight ${fmt(weight / unit)} DAOG (quorum ${fmt(quorumAtSnapshot / unit)} DAOG)`);
    if (weight >= quorumAtSnapshot) {
      throw new Error(
        `S3 invalid: small holder's weight (${weight}) already meets quorum (${quorumAtSnapshot}). ` +
        `The scenario needs a wallet below quorum to prove anything — check smallHolder in the plan.`
      );
    }
    await record('S3', 'vote FOR, single small holder', () => governor.connect(small).castVote(p.proposalId, 1));

    await waitForBlock(Number(p.deadline) + 1, 'voting window to close');
    const o = await reportOutcome(governor, p.proposalId, 'S3', unit, {
      snapshot: p.snapshot.toString(), deadline: p.deadline.toString(),
    });
    // Unanimous (only) support must still fail — on quorum, specifically.
    checkOutcome(o, !o.quorumMet, `quorum was NOT met despite unanimous support (reason=${o.reason})`);
    checkOutcome(o, o.reason === 'RejectedByQuorum', `rejected specifically for quorum, not vote count (reason=${o.reason})`);
    outcomes.push(o);
  }

  /* ---- S4: late acquisition defeated by the checkpoint ---------------- */

  hr();
  log('S4  tokens acquired AFTER the snapshot carry zero weight');
  {
    // The scenario's premise is that the attacker starts from zero. If this
    // wallet was reused from an earlier run's S4, it may already hold a
    // balance and a self-delegation — fail fast with a clear instruction
    // instead of quietly running a weaker (or misleading) version of S4.
    const priorBalance = await token.balanceOf(attacker.address);
    const priorDelegate = await token.delegates(attacker.address);
    if (priorBalance > 0n || priorDelegate === attacker.address) {
      throw new Error(
        `S4 invalid: attacker wallet ${attacker.address} already holds ${fmt(priorBalance / unit)} DAOG ` +
        `and/or is already self-delegated (delegate=${priorDelegate}) — likely reused from a previous run. ` +
        `S4 needs a wallet with zero pre-existing balance/delegation. Remove this wallet's entry from ` +
        `sepolia-wallets.json (it will be regenerated) or bump CONFIG.voters so a fresh one is used as the attacker.`
      );
    }

    const payload = categoryPayload('S4', stamp);
    const title = 'S4 checkpoint - late acquisition attempt';
    const description = `${title} - ${stamp}`;
    const p = await createProposal(governor, registry, 'S4', payload, title, description);
    await waitForBlock(Number(p.snapshot) + 1, 'proposal to become Active');

    const before = await tally(governor, p.proposalId);
    const attackerSnapshotWeightBefore = await governor.getVotes(attacker.address, p.snapshot);
    log(`    attacker weight at snapshot: ${fmt(attackerSnapshotWeightBefore / unit)} DAOG`);

    // The attack: acquire a large balance and delegate, after the snapshot.
    await record('S4', `transfer ${fmt(plan.s4Attacker)} DAOG to attacker (post-snapshot)`, () =>
      token.connect(deployer).transfer(attacker.address, plan.s4Attacker * unit));
    await record('S4', 'attacker self-delegates (post-snapshot)', () =>
      token.connect(attacker).delegate(attacker.address));

    const liveBalance = await token.balanceOf(attacker.address);
    const snapWeight = await governor.getVotes(attacker.address, p.snapshot);
    log(`    attacker balance now:        ${fmt(liveBalance / unit)} DAOG`);
    log(`    attacker weight at snapshot: ${fmt(snapWeight / unit)} DAOG  <-- the mitigation`);

    await record('S4', 'attacker votes FOR with post-snapshot tokens', () =>
      governor.connect(attacker).castVote(p.proposalId, 1));

    const after = await tally(governor, p.proposalId);
    const moved = after.forVotes - before.forVotes;
    log(`    tally moved by:              ${fmt(moved / unit)} DAOG`);

    // One honest voter, so the proposal has a normal tally to compare against.
    await record('S4', 'vote AGAINST, honest voter 1', () =>
      governor.connect(voters[0]).castVote(p.proposalId, 0));

    await waitForBlock(Number(p.deadline) + 1, 'voting window to close');
    const o = await reportOutcome(governor, p.proposalId, 'S4', unit, {
      snapshot: p.snapshot.toString(), deadline: p.deadline.toString(),
      attackerLiveBalance: liveBalance.toString(),
      attackerSnapshotWeight: snapWeight.toString(),
      tallyMovedBy: moved.toString(),
    });
    checkOutcome(o, attackerSnapshotWeightBefore === 0n, 'attacker started from zero weight at the snapshot');
    checkOutcome(o, moved === 0n, `post-snapshot acquisition carried zero voting weight (tally moved by ${moved})`);
    outcomes.push(o);
  }

  /* ---- S5: weighted counting vs. a simple wallet-count majority ------- */
  // The only scenario where the two majorities disagree: 3 wallets (small,
  // equal balances) vote For, 1 wallet (the deployer, holding whatever is
  // left after funding everyone else) votes Against with more tokens than
  // the three combined. A wallet-count vote would pass 3-to-1; a token-
  // weighted vote must not. This is the one result S1/S2 can't produce,
  // since in both of those wallet-count and token-weight point the same way.

  hr();
  log('S5  weighted counting: 3 wallets outvote 1, but 1 outweighs them in tokens');
  {
    const payload = categoryPayload('S5', stamp);
    const title = 'S5 weighted count - register a low-value category';
    const description = `${title} - ${stamp}`;
    const p = await createProposal(governor, registry, 'S5', payload, title, description);
    await waitForBlock(Number(p.snapshot) + 1, 'proposal to become Active');

    const deployerWeight = await governor.getVotes(deployer.address, p.snapshot);
    const threeVotersWeight = (await governor.getVotes(voters[0].address, p.snapshot))
      + (await governor.getVotes(voters[1].address, p.snapshot))
      + (await governor.getVotes(voters[2].address, p.snapshot));
    log(`    deployer weight ${fmt(deployerWeight / unit)} DAOG vs. 3 voters combined ${fmt(threeVotersWeight / unit)} DAOG`);
    if (deployerWeight <= threeVotersWeight) {
      throw new Error(
        `S5 invalid: deployer's weight (${deployerWeight}) does not exceed the 3 voters combined ` +
        `(${threeVotersWeight}). The scenario needs the token-weighted and wallet-count majorities to ` +
        `disagree — deployer has given away too much of its balance by this point in the run.`
      );
    }

    for (const [i, s] of voters.slice(0, 3).entries()) {
      await record('S5', `vote FOR, voter ${i + 1}`, () => governor.connect(s).castVote(p.proposalId, 1));
    }
    await record('S5', 'vote AGAINST, deployer', () => governor.connect(deployer).castVote(p.proposalId, 0));

    await waitForBlock(Number(p.deadline) + 1, 'voting window to close');
    const o = await reportOutcome(governor, p.proposalId, 'S5', unit, {
      snapshot: p.snapshot.toString(), deadline: p.deadline.toString(),
      deployerWeight: deployerWeight.toString(), threeVotersWeight: threeVotersWeight.toString(),
    });
    checkOutcome(o, o.quorumMet, `quorum was met by the 3-wallet majority alone (reason=${o.reason})`);
    checkOutcome(o, o.reason === 'RejectedByVote', `a 3-to-1 wallet majority still lost on token weight (reason=${o.reason})`);
    outcomes.push(o);
  }

  /* ---- outputs -------------------------------------------------------- */

  hr();
  writeOutputs(outcomes, buildMeta({ quorumNow, votingPeriod, decimals, unit }));
  if (!allValid) {
    hr();
    log('RUN COMPLETED WITH FAILED CHECKS — see outcomes[].notes and the FAIL lines above.');
    process.exitCode = 1;
  }
  log('done');
}

function buildMeta({ quorumNow, votingPeriod, decimals, unit }) {
  return {
    ...metaSoFar,
    quorum: (quorumNow / unit).toString(),
    votingPeriod: votingPeriod.toString(),
    decimals: Number(decimals),
    allValid,
    finishedAt: new Date().toISOString(),
  };
}

function writeOutputs(outcomesToWrite, meta) {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });

  fs.writeFileSync(path.join(CONFIG.outDir, 'outcomes.json'), JSON.stringify({ meta, outcomes: outcomesToWrite }, null, 2));

  const csv = ['n,scenario,label,hash,block,gas_used,effective_gas_price_wei,cost_eth,latency_ms,status,revert_reason']
    .concat(ledger.map((e) =>
      [e.n, e.scenario, `"${e.label}"`, e.hash, e.block, e.gasUsed, e.effectiveGasPriceWei, e.costEth, e.latencyMs,
        e.status, `"${(e.revertReason || '').replace(/"/g, "'")}"`].join(',')))
    .join('\n');
  fs.writeFileSync(path.join(CONFIG.outDir, 'transactions.csv'), csv);

  // Aggregate by operation type, which is what Table 4 and Table 5 of the paper need.
  const groups = {};
  for (const e of ledger) {
    const key = e.label.replace(/ \d+$/, '').replace(/voter \d+/, 'voter').replace(/,.*$/, '');
    (groups[key] ||= []).push(e);
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const rows = Object.entries(groups).map(([k, v]) => {
    const gas = v.map((x) => Number(x.gasUsed));
    const lat = v.map((x) => x.latencyMs / 1000);
    return { operation: k, n: v.length, gasMean: Math.round(mean(gas)), gasMin: Math.min(...gas), gasMax: Math.max(...gas), latMean: mean(lat).toFixed(1) };
  }).sort((a, b) => b.gasMean - a.gasMean);

  const scenarioRows = outcomesToWrite.filter((o) => o.scenario !== 'S6');
  const s6 = outcomesToWrite.find((o) => o.scenario === 'S6');

  const md = [
    `# CircularDAO extended governance evaluation — run ${meta.runId}`,
    '',
    `Commit: ${meta.gitCommit || 'unknown'} · Governor: ${meta.governor} · Token: ${meta.token} · Registry: ${meta.registry}`,
    `Overall result: **${meta.allValid ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED — see notes below'}**`,
    '',
    '| Operation | n | Gas (mean) | Gas (min) | Gas (max) | Latency (s, mean) |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.operation} | ${r.n} | ${fmt(r.gasMean)} | ${fmt(r.gasMin)} | ${fmt(r.gasMax)} | ${r.latMean} |`),
    '',
    `Total transactions: ${ledger.length}`,
    `Total gas: ${fmt(ledger.reduce((s, e) => s + Number(e.gasUsed), 0))}`,
    `Total cost: ${ledger.reduce((s, e) => s + Number(e.costEth), 0).toFixed(6)} test ETH`,
    `Latency: mean ${(mean(ledger.map((e) => e.latencyMs / 1000))).toFixed(1)} s, ` +
    `min ${Math.min(...ledger.map((e) => e.latencyMs / 1000)).toFixed(1)} s, ` +
    `max ${Math.max(...ledger.map((e) => e.latencyMs / 1000)).toFixed(1)} s`,
    '',
    '## Scenario outcomes (S1-S5)',
    '',
    '| Scenario | Final state | Reason | For | Against | Quorum | Valid | Notes |',
    '|---|---|---|---|---|---|---|---|',
    ...scenarioRows.map((o) =>
      `| ${o.scenario} | ${o.state} | ${o.reason} | ${o.forVotes} | ${o.against} | ${o.quorum} | ${o.valid ? 'yes' : 'NO'} | ${(o.notes || []).join('; ')} |`),
    '',
    '## S6 — DAO exclusive authority',
    '',
    s6 ? [
      `Valid: **${s6.valid ? 'yes' : 'NO'}**`,
      '',
      ...(s6.notes || []).map((n) => `- ${n}`),
      '',
      s6.attempt1Hash ? `Direct updateCredits attempt: ${s6.attempt1Hash}` : '',
      s6.attempt2Hash ? `Self re-grant ADMIN_ROLE attempt: ${s6.attempt2Hash}` : '',
      s6.daoPathEvidenceHash ? `DAO path evidence (S1 execute): ${s6.daoPathEvidenceHash}` : '',
    ].filter(Boolean).join('\n') : '(S6 did not run)',
  ].join('\n');

  fs.writeFileSync(path.join(CONFIG.outDir, 'summary.md'), md);

  log(`wrote ${CONFIG.outDir}/`);
  log('  transactions.json   every transaction, full detail');
  log('  transactions.csv    same, for the appendix table');
  log('  outcomes.json       final state, tally and pass/fail of each scenario');
  log('  summary.md          aggregated table, ready to paste into the paper');
  log('');
  log(md);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  flush();
  // Write whatever outcomes were collected before the crash, so the run
  // isn't a total loss of reporting even when it stops partway through.
  try {
    if (outcomes.length > 0) {
      writeOutputs(outcomes, { ...metaSoFar, allValid: false, crashedWith: e.message, finishedAt: new Date().toISOString() });
    }
  } catch { /* best effort */ }
  console.error(`Partial results kept in ${CONFIG.outDir}/`);
  process.exitCode = 1;
});

// Shared plumbing for every ablation runner script: manifest + CSV + full
// receipts, per protocol section 9. Not a contract, just Node/ethers glue.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { ethers } = hre;

const STATE = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];

function gitInfo() {
  const root = path.join(__dirname, "..", "..", "..");
  const run = (cmd) => { try { return execSync(cmd, { cwd: root }).toString().trim(); } catch { return null; } };
  const commit = run("git rev-parse HEAD");
  const tag = run("git describe --exact-match --tags HEAD");
  // Exclude experiments/ablation/results/: every run writes its own output
  // folder there, which makes the tree "dirty" for the NEXT script in the
  // same batch even though no CODE changed — caught by hand when 4 of 5
  // scripts in one tagged batch mislabeled themselves "development" because
  // an earlier script's own output was sitting there untracked. Excluding
  // this path means dirty only reflects actual source/config changes.
  const dirty = run("git status --porcelain -- . ':!experiments/ablation/results'");
  return {
    commit,
    tag, // null if HEAD isn't exactly on a tag
    isResultRun: !!tag && !dirty, // protocol section 9: result runs only on a tagged, clean commit
    dirtyAtRunTime: !!dirty && dirty.length > 0,
  };
}

/** Creates a fresh run context: output dir, CSV rows array, receipts array, manifest skeleton. */
function newRun(label) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-") + "_" + label;
  const git = gitInfo();
  // ABLATION_RESULTS_GROUP nests this run's output under results/<group>/
  // instead of flat results/ — used to write a whole correction round (e.g.
  // "run2_<commit>") into its own subtree without moving or renaming the
  // previous round's results (v1.4 step 6's explicit requirement).
  const group = process.env.ABLATION_RESULTS_GROUP;
  const outDir = group ? path.join(__dirname, "..", "results", group, runId) : path.join(__dirname, "..", "results", runId);
  fs.mkdirSync(outDir, { recursive: true });

  const ctx = {
    runId,
    outDir,
    git,
    csvRows: [],
    receipts: [],
    queries: [],
    resetSeq: 0, // incremented by deployCondition() every hardhat_reset — scopes the nonce-uniqueness check (check 6) to "since the last reset", not the whole run.
    manifest: {
      runId,
      label,
      protocolVersion: "1.4",
      kind: git.isResultRun ? "result" : "development",
      startedAt: new Date().toISOString(),
      git,
      solidity: { version: "0.8.28", optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
      // Read from the actual running config instead of a hardcoded literal —
      // an earlier version of this file hardcoded "cancun" here even after
      // hardhat.config.ablation.js was changed to "osaka" to match Sepolia's
      // real hardfork at the calibration block, silently making the record
      // wrong. hre.network.config.hardfork is undefined when this runs under
      // hardhat.config.ablation-fork.js (forking derives rules from the
      // remote chain, not a hardfork literal) — recorded as such, not guessed.
      hardfork: hre.network.config.hardfork || "(forked network — rules taken from remote chain state, no local hardfork literal)",
      network: hre.network.name,
      forking: hre.network.config.forking ? { url: hre.network.config.forking.url, blockNumber: hre.network.config.forking.blockNumber } : null,
      openzeppelinVersion: require(path.join(__dirname, "..", "..", "..", "node_modules", "@openzeppelin", "contracts", "package.json")).version,
      deployments: [], // filled in by deployCondition()
    },
  };
  if (!git.isResultRun) {
    console.log(`[${runId}] DEVELOPMENT run (HEAD not on a clean tagged commit) — not for the paper. git:`, git);
  }
  return ctx;
}

const CSV_HEADER = ["execucao", "variante", "token", "N", "condicao", "posicao", "k", "etapa", "ordem", "direcao", "funcao", "seletor", "operacao_governada", "gas", "status", "motivo_reversao", "tx_hash"];

function flush(ctx) {
  const csv = [CSV_HEADER.join(",")]
    .concat(ctx.csvRows.map((r) => CSV_HEADER.map((h) => {
      const v = r[h] ?? "";
      const s = String(v).replace(/"/g, "'");
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(",")))
    .join("\n");
  fs.writeFileSync(path.join(ctx.outDir, "results.csv"), csv);
  fs.writeFileSync(path.join(ctx.outDir, "receipts.json"), JSON.stringify(ctx.receipts, null, 2));
  fs.writeFileSync(path.join(ctx.outDir, "queries.json"), JSON.stringify(ctx.queries, null, 2));
  fs.writeFileSync(path.join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
}

/** Records ONE transaction into both receipts.json and results.csv, atomically,
 * keyed by the same tx_hash on both sides — by construction, not by discipline,
 * so "recorded a receipt but forgot the CSV row" (an actual bug in an earlier
 * version of this file) can't happen again.
 *
 * `tx` (optional, the full TransactionResponse, not just the receipt) lets us
 * record the complete on-chain input per protocol section 9/v1.4 step 3:
 * from/to/nonce/value/data/gasLimit alongside the receipt's logs — not just
 * hash+gasUsed+status as an earlier version did. Callers that only have a
 * receipt (no tx object) still work; the tx-only fields are simply omitted. */
function recordTx(ctx, receipt, meta, tx = null) {
  const selector = tx && tx.data && tx.data.length >= 10 ? tx.data.slice(0, 10) : (meta.seletor || "");
  ctx.receipts.push({
    hash: receipt.hash, block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    etapa: meta.etapa, variante: meta.variante,
    resetSeq: ctx.resetSeq,
    revertReason: meta.motivo_reversao || "",
    tx: tx ? {
      from: tx.from, to: tx.to, nonce: tx.nonce,
      value: tx.value != null ? tx.value.toString() : "0",
      data: tx.data, gasLimit: tx.gasLimit != null ? tx.gasLimit.toString() : null,
    } : null,
    logs: (receipt.logs || []).map((l) => ({ address: l.address, topics: [...l.topics], data: l.data, logIndex: l.index })),
  });
  ctx.csvRows.push({
    execucao: ctx.runId,
    variante: meta.variante ?? "",
    token: meta.token ?? "",
    N: meta.N ?? "",
    condicao: meta.condicao ?? "",
    posicao: meta.posicao ?? "",
    k: meta.k ?? "",
    etapa: meta.etapa,
    ordem: meta.ordem ?? "",
    direcao: meta.direcao ?? "",
    funcao: meta.funcao ?? "",
    seletor: selector,
    operacao_governada: meta.operacao_governada ?? "",
    gas: receipt.gasUsed.toString(),
    status: receipt.status,
    motivo_reversao: meta.motivo_reversao ?? "",
    tx_hash: receipt.hash,
  });
  flush(ctx);
}

/** Records the result of a READ-ONLY verification query (numCheckpoints,
 * getPastVotes, getVotes, quorum, state, proposalVotes, ...) alongside the
 * assertion it was used for and whether that assertion held — per v1.4 step
 * 3 ("registrar toda consulta de verificação, com a asserção e o resultado"),
 * so a reviewer can see not just the final state but every check made along
 * the way, not only the ones that happened to fail. */
function recordQuery(ctx, { etapa, variante, condicao, query, expected, actual, ok }) {
  ctx.queries.push({ etapa, variante, condicao, query, expected: String(expected), actual: String(actual), ok });
  flush(ctx);
  if (!ok) throw new Error(`recordQuery: assertion failed for ${etapa} (${variante}/${condicao}): query=${query} expected=${expected} actual=${actual}`);
}

/** Checks that every receipt has exactly one CSV row with the same tx_hash and
 * vice versa — matching totals is not proof of correspondence (flagged in
 * review: an earlier version had 136 of each but no per-hash check, and a
 * mis-added arithmetic check hid a real gap). Throws on any mismatch instead
 * of just logging, so a broken run can't silently produce a "result". */
function verifyCorrespondence(ctx) {
  const receiptHashes = ctx.receipts.map((r) => r.hash);
  const csvHashes = ctx.csvRows.map((r) => r.tx_hash);
  const countOf = (arr) => arr.reduce((m, h) => (m.set(h, (m.get(h) || 0) + 1), m), new Map());
  const rCounts = countOf(receiptHashes);
  const cCounts = countOf(csvHashes);

  const problems = [];
  for (const [h, n] of rCounts) {
    if (!cCounts.has(h)) problems.push(`receipt ${h} has no CSV row`);
    else if (cCounts.get(h) !== n) problems.push(`receipt ${h} appears ${n}x but CSV has ${cCounts.get(h)}x`);
  }
  for (const [h] of cCounts) {
    if (!rCounts.has(h)) problems.push(`CSV row ${h} has no matching receipt`);
  }
  if (problems.length > 0) {
    throw new Error(`verifyCorrespondence failed (${problems.length} problem(s)):\n` + problems.join("\n"));
  }
  console.log(`verifyCorrespondence: OK — ${receiptHashes.length} receipts, each with exactly one matching CSV row (by tx_hash), no duplicates, no gaps.`);
}

/** Runs the six integrity checks from the v1.4 correction roadmap (protocol
 * section 9) against one finished run's ledger. Throws on the first failing
 * check with a specific report — a broken run should stop, not silently
 * finish as a "result".
 * 1. uniqueness WITHIN THE SAME RESET SEGMENT — no tx_hash repeats among
 *    transactions recorded since the last hardhat_reset. Scoped to
 *    `resetSeq`, not global: with deterministic per-condition resets (v1.4
 *    step 1), two DIFFERENT conditions that happen to run the identical
 *    deployment step (same sender, same nonce-after-reset, same bytecode,
 *    same constructor args) sign the exact same transaction and legitimately
 *    get the exact same hash — confirmed by running this script and seeing
 *    deploy_token_T1 repeat its hash across V0/V1/V2, which is the
 *    determinism guarantee working as intended, not a recording bug. A
 *    repeat WITHIN one condition's own sequence would still be a real bug
 *    (the same step recorded twice, or two different steps colliding).
 * 2. csv<->receipt correspondence — delegates to verifyCorrespondence().
 * 3. Ref's five auxiliary deployments (rewardsRegistryForCtor/credit/
 *    passport/rewards/stakeholders) are present for every Ref deployment in
 *    the manifest — these used to be deployed with raw awaits and never
 *    written to receipts.json/results.csv at all.
 * 4. every CSV row identifies which variant and step produced it (non-empty
 *    `variante` and `etapa` — a row with either blank can't be attributed).
 * 5. no duplicate (from, nonce) pairs WITHIN THE SAME RESET SEGMENT — two
 *    different recorded transactions can never share a nonce from the same
 *    sender since the last hardhat_reset. Scoped to `resetSeq` (bumped by
 *    deployCondition on every reset) rather than checked globally: nonces
 *    legitimately restart at 0 once per condition, not once per run, because
 *    each condition resets the chain first for deterministic addresses
 *    (v1.4 step 1) — an earlier, unscoped version of this check flagged
 *    hundreds of false positives for exactly that reason.
 */
function verifyIntegrity(ctx) {
  const problems = [];

  const hashCounts = new Map();
  for (const r of ctx.receipts) {
    const key = `seg${r.resetSeq}:${r.hash}`;
    hashCounts.set(key, (hashCounts.get(key) || 0) + 1);
  }
  for (const [k, n] of hashCounts) if (n > 1) problems.push(`check 1 (uniqueness): ${k} recorded ${n} times within the same reset segment, expected 1`);

  const refDeployments = ctx.manifest.deployments.filter((d) => d.variant === "Ref").length;
  for (const etapa of ["deploy_rewards_registry_for_ctor", "deploy_credit", "deploy_passport", "deploy_rewards", "deploy_stakeholders"]) {
    const n = ctx.receipts.filter((r) => r.etapa === etapa).length;
    if (n !== refDeployments) problems.push(`check 3 (Ref auxiliary deployments): expected ${refDeployments}x '${etapa}' (one per Ref deployment), found ${n}`);
  }

  for (const r of ctx.csvRows) {
    if (!r.variante && r.variante !== 0) problems.push(`check 4 (row identification): CSV row for tx ${r.tx_hash} has no 'variante'`);
    if (!r.etapa) problems.push(`check 4 (row identification): CSV row for tx ${r.tx_hash} has no 'etapa'`);
  }

  const nonceKeys = new Map();
  for (const r of ctx.receipts) {
    if (!r.tx || r.tx.from == null || r.tx.nonce == null) continue;
    const key = `seg${r.resetSeq}:${r.tx.from.toLowerCase()}#${r.tx.nonce}`;
    if (nonceKeys.has(key)) problems.push(`check 6 (nonce uniqueness): ${key} used by both ${nonceKeys.get(key)} and ${r.hash}`);
    else nonceKeys.set(key, r.hash);
  }

  if (problems.length > 0) throw new Error(`verifyIntegrity failed (${problems.length} problem(s)):\n` + problems.join("\n"));
  verifyCorrespondence(ctx); // check 2
  console.log(`verifyIntegrity: OK — checks 1,3,4,6 passed (${ctx.receipts.length} receipts, ${refDeployments} Ref deployment(s), ${ctx.queries.length} recorded queries).`);
}

/** Sends a transaction, records the CSV row + full receipt (same tx_hash on
 * both), returns the receipt. `expectRevert`: if true, a revert is the
 * expected/valid outcome (status 0 is not an error) and the decoded reason
 * is captured via a staticCall replay BEFORE sending, using the exact same
 * call. */
async function step(ctx, meta, sendFn, { expectRevert = false, decodeFn = null } = {}) {
  let revertReason = "";
  if (expectRevert && decodeFn) {
    try {
      await decodeFn();
      revertReason = "(staticCall did not revert — status below is the only evidence)";
    } catch (e) {
      revertReason = e.shortMessage || e.reason || e.message || "";
    }
  }
  let tx;
  try {
    tx = await sendFn();
  } catch (e) {
    throw new Error(
      `${meta.etapa}: reverted before broadcast — the network rejected it outright instead of mining it ` +
      `(check hardfork/gasLimit and that this ran under hardhat.config.ablation.js). ` +
      `Original error: ${e.shortMessage || e.message}`
    );
  }
  let receipt;
  try {
    receipt = await tx.wait();
  } catch (e) {
    receipt = e.receipt || await ethers.provider.getTransactionReceipt(tx.hash);
  }
  recordTx(ctx, receipt, { ...meta, motivo_reversao: revertReason }, tx);
  const statusLabel = receipt.status === 1 ? "ok" : "reverted";
  console.log(`    [${meta.variante ?? ""}/${meta.condicao ?? ""}] ${meta.etapa} gas=${receipt.gasUsed} ${statusLabel}${revertReason ? ` (${revertReason})` : ""}`);
  if (expectRevert && receipt.status !== 0) throw new Error(`${meta.etapa}: expected revert, got status ${receipt.status}`);
  if (!expectRevert && receipt.status !== 1) throw new Error(`${meta.etapa}: expected success, got status ${receipt.status} (${revertReason})`);
  receipt.revertReason = revertReason; // attached for callers that need to assert on it (e.g. B4)
  return receipt;
}

/** Deploys one condition (token + registry + governor) and records it in the
 * manifest. Resets the network to genesis FIRST (unless `noReset` — only used
 * by the fork-based calibration script, which must keep the forked Sepolia
 * state and never calls this function at all) so the deployer's nonce always
 * starts at 0: CREATE addresses are then a pure function of (deployer,
 * per-variant deployment sequence), reproducible run to run — the basis for
 * the v1.4 step-1 determinism test (same condition, two resets, same
 * addresses and same gas). */
async function deployCondition(ctx, { variant, tokenKind, supply, votingDelay, votingPeriod, quorumFixed, admin, noReset = false }) {
  if (!noReset) { await hre.network.provider.send("hardhat_reset", []); ctx.resetSeq++; }

  const TokenFactory = await ethers.getContractFactory(tokenKind === "T0" ? "T0PlainERC20" : "T1VotesERC20");
  const token = await TokenFactory.deploy(supply);
  await token.waitForDeployment();
  recordTx(ctx, await token.deploymentTransaction().wait(), { etapa: `deploy_token_${tokenKind}`, variante: variant, token: tokenKind, funcao: "constructor", operacao_governada: "" }, token.deploymentTransaction());

  const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();
  recordTx(ctx, await registry.deploymentTransaction().wait(), { etapa: "deploy_registry", variante: variant, funcao: "constructor" }, registry.deploymentTransaction());

  let governor, governorFactoryName, extraCtorArgs = [];
  const auxDeployments = []; // Ref's auxiliary contracts, recorded below - previously deployed with raw awaits and never written to receipts.json/results.csv at all (v1.4 step 3 gap).
  if (variant === "V0" || variant === "V1") {
    governorFactoryName = variant === "V0" ? "V0Governor" : "V1Governor";
    const F = await ethers.getContractFactory(governorFactoryName);
    governor = await F.deploy(await token.getAddress(), votingDelay, votingPeriod);
  } else if (variant === "V2") {
    governorFactoryName = "V2Governor";
    extraCtorArgs = [quorumFixed.toString()];
    const F = await ethers.getContractFactory(governorFactoryName);
    governor = await F.deploy(await token.getAddress(), votingDelay, votingPeriod, quorumFixed);
  } else if (variant === "Ref") {
    governorFactoryName = "CircularDAO";
    // Ref needs rewards/stakeholders to satisfy the constructor; not
    // exercised by any B-scenario or the N-sweep (target is always the
    // registry), so these are minimal, unused-in-practice deployments —
    // but still real transactions that must be recorded (v1.4 step 3).
    const rewardsRegistryForCtor = await (await ethers.getContractFactory("WasteCategoryRegistry")).deploy(admin.address);
    await rewardsRegistryForCtor.waitForDeployment();
    auxDeployments.push(["deploy_rewards_registry_for_ctor", rewardsRegistryForCtor]);
    const credit = await (await ethers.getContractFactory("CircularCredit")).deploy(admin.address);
    await credit.waitForDeployment();
    auxDeployments.push(["deploy_credit", credit]);
    const passport = await (await ethers.getContractFactory("MaterialPassport")).deploy(admin.address);
    await passport.waitForDeployment();
    auxDeployments.push(["deploy_passport", passport]);
    const rewards = await (await ethers.getContractFactory("RecyclingRewards")).deploy(
      admin.address, await rewardsRegistryForCtor.getAddress(), await credit.getAddress(), await passport.getAddress());
    await rewards.waitForDeployment();
    auxDeployments.push(["deploy_rewards", rewards]);
    const stakeholders = await (await ethers.getContractFactory("StakeholderRegistry")).deploy(admin.address);
    await stakeholders.waitForDeployment();
    auxDeployments.push(["deploy_stakeholders", stakeholders]);
    extraCtorArgs = [await token.getAddress(), admin.address, await registry.getAddress(), await rewards.getAddress(), await stakeholders.getAddress(), votingDelay, votingPeriod];
    const F = await ethers.getContractFactory("CircularDAO");
    governor = await F.deploy(...extraCtorArgs);
  } else {
    throw new Error(`unknown variant ${variant}`);
  }
  await governor.waitForDeployment();
  // Auxiliary deployments happened before the governor above (constructor
  // dependency order) but are recorded after it so the governor's own
  // deploy_governor_Ref row keeps the position callers of earlier runs
  // expect; order in receipts.json/results.csv reflects RECORDING order,
  // the block number in each row is the authoritative chronological record.
  for (const [etapa, contract] of auxDeployments) {
    recordTx(ctx, await contract.deploymentTransaction().wait(), { etapa, variante: variant, funcao: "constructor" }, contract.deploymentTransaction());
  }
  recordTx(ctx, await governor.deploymentTransaction().wait(), { etapa: `deploy_governor_${variant}`, variante: variant, funcao: "constructor" }, governor.deploymentTransaction());

  const ADMIN_ROLE = await registry.ADMIN_ROLE();
  const grantTx = await registry.connect(admin).grantRole(ADMIN_ROLE, await governor.getAddress());
  recordTx(ctx, await grantTx.wait(), { etapa: "grant_admin_role", variante: variant, funcao: "grantRole", operacao_governada: "" }, grantTx);
  const revokeTx = await registry.connect(admin).revokeRole(ADMIN_ROLE, admin.address);
  recordTx(ctx, await revokeTx.wait(), { etapa: "revoke_deployer_admin_role", variante: variant, funcao: "revokeRole", operacao_governada: "" }, revokeTx);

  ctx.manifest.deployments.push({
    variant, tokenKind, supply: supply.toString(), votingDelay, votingPeriod,
    quorumFixed: quorumFixed ? quorumFixed.toString() : null,
    addresses: {
      token: await token.getAddress(), registry: await registry.getAddress(), governor: await governor.getAddress(),
    },
    governorContract: governorFactoryName,
    constructorArgs: variant === "V2" ? [await token.getAddress(), votingDelay, votingPeriod, ...extraCtorArgs]
      : variant === "Ref" ? extraCtorArgs
      : [await token.getAddress(), votingDelay, votingPeriod],
  });
  flush(ctx);

  return { token, registry, governor };
}

module.exports = { STATE, newRun, recordTx, recordQuery, step, deployCondition, verifyCorrespondence, verifyIntegrity, flush };

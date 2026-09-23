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
  const dirty = run("git status --porcelain");
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
  const outDir = path.join(__dirname, "..", "results", runId);
  fs.mkdirSync(outDir, { recursive: true });

  const ctx = {
    runId,
    outDir,
    git,
    csvRows: [],
    receipts: [],
    manifest: {
      runId,
      label,
      kind: git.isResultRun ? "result" : "development",
      startedAt: new Date().toISOString(),
      git,
      solidity: { version: "0.8.28", optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
      hardfork: "cancun",
      openzeppelinVersion: require(path.join(__dirname, "..", "..", "..", "node_modules", "@openzeppelin", "contracts", "package.json")).version,
      deployments: [], // filled in by deployCondition()
    },
  };
  if (!git.isResultRun) {
    console.log(`[${runId}] DEVELOPMENT run (HEAD not on a clean tagged commit) — not for the paper. git:`, git);
  }
  return ctx;
}

const CSV_HEADER = ["execucao", "variante", "token", "N", "condicao", "posicao", "k", "etapa", "ordem", "direcao", "gas", "status", "motivo_reversao", "tx_hash"];

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
  fs.writeFileSync(path.join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
}

/** Records ONE transaction into both receipts.json and results.csv, atomically,
 * keyed by the same tx_hash on both sides — by construction, not by discipline,
 * so "recorded a receipt but forgot the CSV row" (an actual bug in an earlier
 * version of this file) can't happen again. */
function recordTx(ctx, receipt, meta) {
  ctx.receipts.push({
    hash: receipt.hash, block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    etapa: meta.etapa, variante: meta.variante,
    revertReason: meta.motivo_reversao || "",
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
    gas: receipt.gasUsed.toString(),
    status: receipt.status,
    motivo_reversao: meta.motivo_reversao ?? "",
    tx_hash: receipt.hash,
  });
  flush(ctx);
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
  recordTx(ctx, receipt, { ...meta, motivo_reversao: revertReason });
  const statusLabel = receipt.status === 1 ? "ok" : "reverted";
  console.log(`    [${meta.variante ?? ""}/${meta.condicao ?? ""}] ${meta.etapa} gas=${receipt.gasUsed} ${statusLabel}${revertReason ? ` (${revertReason})` : ""}`);
  if (expectRevert && receipt.status !== 0) throw new Error(`${meta.etapa}: expected revert, got status ${receipt.status}`);
  if (!expectRevert && receipt.status !== 1) throw new Error(`${meta.etapa}: expected success, got status ${receipt.status} (${revertReason})`);
  receipt.revertReason = revertReason; // attached for callers that need to assert on it (e.g. B4)
  return receipt;
}

/** Deploys one condition (token + registry + governor) and records it in the manifest. */
async function deployCondition(ctx, { variant, tokenKind, supply, votingDelay, votingPeriod, quorumFixed, admin }) {
  const TokenFactory = await ethers.getContractFactory(tokenKind === "T0" ? "T0PlainERC20" : "T1VotesERC20");
  const token = await TokenFactory.deploy(supply);
  await token.waitForDeployment();
  recordTx(ctx, await token.deploymentTransaction().wait(), { etapa: `deploy_token_${tokenKind}`, variante: variant, token: tokenKind });

  const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();
  recordTx(ctx, await registry.deploymentTransaction().wait(), { etapa: "deploy_registry", variante: variant });

  let governor, governorFactoryName, extraCtorArgs = [];
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
    // registry), so these are minimal, unused-in-practice deployments.
    const rewardsRegistryForCtor = await (await ethers.getContractFactory("WasteCategoryRegistry")).deploy(admin.address);
    const credit = await (await ethers.getContractFactory("CircularCredit")).deploy(admin.address);
    const passport = await (await ethers.getContractFactory("MaterialPassport")).deploy(admin.address);
    const rewards = await (await ethers.getContractFactory("RecyclingRewards")).deploy(
      admin.address, await rewardsRegistryForCtor.getAddress(), await credit.getAddress(), await passport.getAddress());
    const stakeholders = await (await ethers.getContractFactory("StakeholderRegistry")).deploy(admin.address);
    extraCtorArgs = [await token.getAddress(), admin.address, await registry.getAddress(), await rewards.getAddress(), await stakeholders.getAddress(), votingDelay, votingPeriod];
    const F = await ethers.getContractFactory("CircularDAO");
    governor = await F.deploy(...extraCtorArgs);
  } else {
    throw new Error(`unknown variant ${variant}`);
  }
  await governor.waitForDeployment();
  recordTx(ctx, await governor.deploymentTransaction().wait(), { etapa: `deploy_governor_${variant}`, variante: variant });

  const ADMIN_ROLE = await registry.ADMIN_ROLE();
  recordTx(ctx, await (await registry.connect(admin).grantRole(ADMIN_ROLE, await governor.getAddress())).wait(),
    { etapa: "grant_admin_role", variante: variant });
  recordTx(ctx, await (await registry.connect(admin).revokeRole(ADMIN_ROLE, admin.address)).wait(),
    { etapa: "revoke_deployer_admin_role", variante: variant });

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

module.exports = { STATE, newRun, recordTx, step, deployCondition, verifyCorrespondence, flush };

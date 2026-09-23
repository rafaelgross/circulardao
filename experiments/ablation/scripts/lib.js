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
    order: {}, // per (variant, proposalId, direction) -> running index, for "ordem do voto" in the CSV
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

/** Records one CSV row (protocol section 7 schema) and, if a receipt is given, its full JSON too. */
function recordRow(ctx, row) {
  ctx.csvRows.push(row);
  flush(ctx);
}

function recordReceipt(ctx, receipt, extra = {}) {
  ctx.receipts.push({
    hash: receipt.hash, block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    ...extra,
  });
  flush(ctx);
}

const CSV_HEADER = ["execucao", "variante", "token", "N", "condicao", "posicao", "k", "etapa", "ordem", "direcao", "gas", "status", "motivo_reversao"];

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

/** Sends a transaction, records the CSV row + full receipt, returns the receipt.
 * `expectRevert`: if true, a revert is the expected/valid outcome (status 0
 * is not an error) and the decoded reason is captured via staticCall replay. */
async function step(ctx, meta, sendFn, { expectRevert = false, decodeFn = null } = {}) {
  let revertReason = "";
  if (expectRevert && decodeFn) {
    try { await decodeFn(); } catch (e) { revertReason = e.shortMessage || e.reason || e.message || ""; }
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
  recordReceipt(ctx, receipt, { etapa: meta.etapa, variante: meta.variante, revertReason });
  recordRow(ctx, {
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
    motivo_reversao: revertReason,
  });
  if (expectRevert && receipt.status !== 0) throw new Error(`${meta.etapa}: expected revert, got status ${receipt.status}`);
  if (!expectRevert && receipt.status !== 1) throw new Error(`${meta.etapa}: expected success, got status ${receipt.status} (${revertReason})`);
  return receipt;
}

/** Deploys one condition (token + registry + governor) and records it in the manifest. */
async function deployCondition(ctx, { variant, tokenKind, supply, votingDelay, votingPeriod, quorumFixed, admin }) {
  const TokenFactory = await ethers.getContractFactory(tokenKind === "T0" ? "T0PlainERC20" : "T1VotesERC20");
  const token = await TokenFactory.deploy(supply);
  await token.waitForDeployment();
  const tokenDeployReceipt = await token.deploymentTransaction().wait();
  recordReceipt(ctx, tokenDeployReceipt, { etapa: `deploy_token_${tokenKind}`, variante: variant });
  recordRow(ctx, { execucao: ctx.runId, variante: variant, token: tokenKind, etapa: `deploy_token_${tokenKind}`, gas: tokenDeployReceipt.gasUsed.toString(), status: tokenDeployReceipt.status });

  const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();
  const registryDeployReceipt = await registry.deploymentTransaction().wait();
  recordReceipt(ctx, registryDeployReceipt, { etapa: "deploy_registry", variante: variant });
  recordRow(ctx, { execucao: ctx.runId, variante: variant, etapa: "deploy_registry", gas: registryDeployReceipt.gasUsed.toString(), status: registryDeployReceipt.status });

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
  const governorDeployReceipt = await governor.deploymentTransaction().wait();
  recordReceipt(ctx, governorDeployReceipt, { etapa: `deploy_governor_${variant}`, variante: variant });
  recordRow(ctx, { execucao: ctx.runId, variante: variant, etapa: `deploy_governor_${variant}`, gas: governorDeployReceipt.gasUsed.toString(), status: governorDeployReceipt.status });

  const ADMIN_ROLE = await registry.ADMIN_ROLE();
  const grantTx = await registry.connect(admin).grantRole(ADMIN_ROLE, await governor.getAddress());
  const grantReceipt = await grantTx.wait();
  recordReceipt(ctx, grantReceipt, { etapa: "grant_admin_role", variante: variant });
  recordRow(ctx, { execucao: ctx.runId, variante: variant, etapa: "grant_admin_role", gas: grantReceipt.gasUsed.toString(), status: grantReceipt.status });
  const revokeTx = await registry.connect(admin).revokeRole(ADMIN_ROLE, admin.address);
  const revokeReceipt = await revokeTx.wait();
  recordReceipt(ctx, revokeReceipt, { etapa: "revoke_deployer_admin_role", variante: variant });
  recordRow(ctx, { execucao: ctx.runId, variante: variant, etapa: "revoke_deployer_admin_role", gas: revokeReceipt.gasUsed.toString(), status: revokeReceipt.status });

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

module.exports = { STATE, newRun, recordRow, recordReceipt, step, deployCondition, flush };

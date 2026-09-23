// Protocol v1.4 step 1: prove that, with a hardhat_reset before every
// deployCondition() call (added to lib.js in this round), the SAME condition
// deployed twice from equivalent resets produces byte-identical contract
// addresses and identical gas per step — not just "close", exactly equal.
// This is what makes cross-run comparisons in the other four sub-experiments
// meaningful: if this didn't hold, "V1 costs X gas" would be partly an
// artifact of which addresses/nonces happened to be in play that run.
//
// Not a "result" run in the protocol-9 sense (it doesn't produce comparative
// numbers for the paper) — it's a one-time proof that the determinism
// mechanism lib.js relies on actually holds, kept in results/ as evidence.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, deployCondition } = require("./lib");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 60;
const SUPPLY = ethers.parseEther("100000");

async function deployAndVote(ctx, label) {
  const [admin, voter] = await ethers.getSigners();
  const { token, registry, governor } = await deployCondition(ctx, {
    variant: "V1", tokenKind: "T1", supply: SUPPLY, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: null, admin,
  });
  await step(ctx, { variante: "V1", etapa: "delegate_admin", condicao: label }, () => token.connect(admin).delegate(admin.address));
  await step(ctx, { variante: "V1", etapa: "delegate", condicao: label }, () => token.connect(voter).delegate(voter.address));
  const transferTx = await step(ctx, { variante: "V1", etapa: "transfer", condicao: label },
    () => token.connect(admin).transfer(voter.address, ethers.parseEther("4000")));

  const description = "determinism-test-fixed-description";
  const calldata = registry.interface.encodeFunctionData("addCategory", ["Cat", "CODE", "#000000", 10, 1, "reg"]);
  const registryAddr = await registry.getAddress();
  const proposeReceipt = await step(ctx, { variante: "V1", etapa: "propose", condicao: label },
    () => governor.connect(admin).propose([registryAddr], [0], [calldata], description));
  const created = proposeReceipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;

  await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);
  const voteReceipt = await step(ctx, { variante: "V1", etapa: "vote", condicao: label, direcao: "for", ordem: 1 },
    () => governor.connect(voter).castVote(proposalId, 1));

  const tokenDeployHash = (await token.deploymentTransaction()).hash;
  const deployTokenGas = Number(ctx.receipts.find((r) => r.etapa === "deploy_token_T1" && r.hash === tokenDeployHash)?.gasUsed ?? -1);
  return {
    addresses: { token: await token.getAddress(), registry: registryAddr, governor: await governor.getAddress() },
    gas: {
      deploy_token: deployTokenGas,
      transfer: Number(transferTx.gasUsed), propose: Number(proposeReceipt.gasUsed), vote: Number(voteReceipt.gasUsed),
    },
    hashes: { transfer: transferTx.hash, propose: proposeReceipt.hash, vote: voteReceipt.hash },
  };
}

async function main() {
  const ctx = newRun("determinism-test");
  const run1 = await deployAndVote(ctx, "det-run-1");
  const run2 = await deployAndVote(ctx, "det-run-2");

  const problems = [];
  for (const k of Object.keys(run1.addresses)) {
    if (run1.addresses[k] !== run2.addresses[k]) problems.push(`address mismatch (${k}): run1=${run1.addresses[k]} run2=${run2.addresses[k]}`);
  }
  for (const k of Object.keys(run1.gas)) {
    if (run1.gas[k] !== run2.gas[k]) problems.push(`gas mismatch (${k}): run1=${run1.gas[k]} run2=${run2.gas[k]}`);
  }
  for (const k of Object.keys(run1.hashes)) {
    if (run1.hashes[k] !== run2.hashes[k]) problems.push(`tx hash mismatch (${k}): run1=${run1.hashes[k]} run2=${run2.hashes[k]}`);
  }

  const result = { ok: problems.length === 0, problems, run1, run2 };
  console.log("\n=== determinism test (same V1 condition, two independent resets) ===");
  console.log(JSON.stringify(result, null, 2));

  const fs = require("fs"), path = require("path");
  fs.writeFileSync(path.join(ctx.outDir, "determinism-test.json"), JSON.stringify(result, null, 2));
  ctx.manifest.finishedAt = new Date().toISOString();
  ctx.manifest.determinismTest = { ok: result.ok, problemCount: problems.length };
  fs.writeFileSync(path.join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));

  if (!result.ok) { console.error(`FAILED: ${problems.length} determinism mismatch(es)`); process.exitCode = 1; }
  else console.log(`\nOK — addresses, gas, and tx hashes are identical between the two independent resets.\nwrote ${ctx.outDir}/determinism-test.json`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

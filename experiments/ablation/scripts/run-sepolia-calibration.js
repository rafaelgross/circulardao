// Runner for protocol section 6: reproduce the real Sepolia S1 cycle
// locally with Ref (CircularDAO), same hardfork, same target operation
// (proposeAddCategory -> WasteCategoryRegistry.addCategory, NOT
// updateCredits — this is what the real Sepolia S1 actually called), same
// supply/quorum (100,000 / 4,000), same voter composition and vote order,
// then compare gas per operation against the real numbers recorded on
// Sepolia on 2026-09-23 (experiment-v2/run-2026-09-23T00-37-39-899Z/).
//
// Per protocol section 6: this establishes coincidence or divergence for
// THESE REPRODUCED OPERATIONS ONLY — not a general claim that "local ==
// Sepolia" for anything else.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, deployCondition, verifyCorrespondence, STATE } = require("./lib");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 60; // matches the real Sepolia deployment (deployments/sepolia.json)
const SUPPLY = ethers.parseEther("100000");
const WEIGHT = ethers.parseEther("4000");

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

async function main() {
  const ctx = newRun("sepolia-calibration");
  const [admin, voter1, voter2, voter3, voter4] = await ethers.getSigners();

  const { token, registry, governor } = await deployCondition(ctx, {
    variant: "Ref", tokenKind: "T1", supply: SUPPLY, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: null, admin,
  });
  await step(ctx, { variante: "Ref", etapa: "delegate_admin", condicao: "6-calibration" }, () => token.connect(admin).delegate(admin.address));

  // Same setup order as the real run: each voter delegates at zero balance,
  // then receives one transfer of the full weight (one checkpoint).
  for (const v of [voter1, voter2, voter3, voter4]) {
    await step(ctx, { variante: "Ref", etapa: "delegate", condicao: "6-calibration" }, () => token.connect(v).delegate(v.address));
    await step(ctx, { variante: "Ref", etapa: "transfer", condicao: "6-calibration" }, () => token.connect(admin).transfer(v.address, WEIGHT));
  }

  // Same target operation and payload shape as the real Sepolia S1
  // (scripts/experiment-v2.js's categoryPayload('S1', stamp)).
  const stamp = Date.now();
  const name = "Eletronico de Informatica";
  const code = `EWASTE_IT_CAL_${stamp}`;
  const color = "#4a90d9";
  const creditsPerKg = 25;
  const hazardLevel = 2;
  const regulation = "Decreto Federal 10.240/2020 (logistica reversa de eletroeletronicos)";
  const title = "S1 calibration - register IT electronics at 25 CRC/kg";
  const description = `${title} - ${stamp}`;

  const proposeReceipt = await step(ctx, { variante: "Ref", etapa: "propose", condicao: "6-calibration" },
    () => governor.connect(admin).proposeAddCategory(name, code, color, creditsPerKg, hazardLevel, regulation, title, description));
  const created = proposeReceipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;

  await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);

  await step(ctx, { variante: "Ref", etapa: "vote_for_1", condicao: "6-calibration", direcao: "for", ordem: 1 },
    () => governor.connect(voter1).castVote(proposalId, 1));
  await step(ctx, { variante: "Ref", etapa: "vote_for_2", condicao: "6-calibration", direcao: "for", ordem: 2 },
    () => governor.connect(voter2).castVote(proposalId, 1));
  await step(ctx, { variante: "Ref", etapa: "vote_for_3", condicao: "6-calibration", direcao: "for", ordem: 3 },
    () => governor.connect(voter3).castVote(proposalId, 1));
  await step(ctx, { variante: "Ref", etapa: "vote_against", condicao: "6-calibration", direcao: "against", ordem: 1 },
    () => governor.connect(voter4).castVote(proposalId, 0));

  await step(ctx, { variante: "Ref", etapa: "repeated_vote", condicao: "6-calibration", direcao: "for", ordem: 2 },
    () => governor.connect(voter1).castVote(proposalId, 1, { gasLimit: 200000 }),
    { expectRevert: true, decodeFn: () => governor.connect(voter1).castVote.staticCall(proposalId, 1) });

  await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_PERIOD + 1).toString(16)]);
  const state = STATE[Number(await governor.state(proposalId))];
  if (state !== "Succeeded") throw new Error(`calibration: expected Succeeded before execute, got ${state}`);

  // Reconstruct the exact calldata proposeAddCategory built internally, the
  // same way scripts/experiment-v2.js's createProposal() does, to execute().
  const calldata = registry.interface.encodeFunctionData("addCategory", [name, code, color, creditsPerKg, hazardLevel, regulation]);
  const descHash = ethers.id(description);
  const registryAddr = await registry.getAddress();
  const executeReceipt = await step(ctx, { variante: "Ref", etapa: "execute", condicao: "6-calibration" },
    () => governor.execute([registryAddr], [0], [calldata], descHash));

  verifyCorrespondence(ctx);

  const local = {
    propose: Number(proposeReceipt.gasUsed),
    vote_for_1: null, vote_for_2: null, vote_for_3: null, vote_against: null, repeated_vote: null,
    execute: Number(executeReceipt.gasUsed),
  };
  // Pull the individually-recorded vote gas figures back out of the ledger
  // for the comparison table (step() already wrote them to receipts/CSV).
  for (const r of ctx.receipts) {
    if (["vote_for_1", "vote_for_2", "vote_for_3", "vote_against", "repeated_vote"].includes(r.etapa)) local[r.etapa] = Number(r.gasUsed);
  }

  console.log("\n=== Section 6 calibration: local Ref reproduction vs. real Sepolia S1 ===");
  console.log("(same target operation, same supply/quorum, same voter composition and order, same hardfork)\n");
  const rows = [];
  for (const key of Object.keys(SEPOLIA_S1)) {
    const sep = SEPOLIA_S1[key];
    const loc = local[key];
    const diff = loc - sep;
    const pct = ((diff / sep) * 100).toFixed(2);
    rows.push({ operation: key, sepolia_gas: sep, local_gas: loc, diff_gas: diff, diff_pct: pct });
    console.log(`  ${key.padEnd(14)} sepolia=${String(sep).padStart(8)}  local=${String(loc).padStart(8)}  diff=${String(diff).padStart(7)} (${pct}%)`);
  }

  const fs = require("fs");
  const path = require("path");
  fs.writeFileSync(path.join(ctx.outDir, "calibration.json"), JSON.stringify({
    sepoliaSource: "experiment-v2/run-2026-09-23T00-37-39-899Z/transactions.csv",
    sepoliaDeployCommit: "21387bcc7b55da0ef89127a9400613d7bb22b2c4",
    rows,
  }, null, 2));

  ctx.manifest.finishedAt = new Date().toISOString();
  ctx.manifest.calibration = rows;
  fs.writeFileSync(path.join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json, calibration.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

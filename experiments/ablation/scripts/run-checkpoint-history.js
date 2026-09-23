// Runner for protocol section 5.2: checkpoint history position (P1: snapshot
// after all history; P2: snapshot in the middle), k in {1,2,4,8,16} for P1,
// {2,4,8,16} for P2.
//
// Variant choice: run against V1, V2 and Ref — all three call
// token.getPastVotes(account, timepoint), the mechanism whose gas cost this
// section studies. V0 is deliberately excluded: it calls getVotes(account)
// (current power, ignoring timepoint entirely — see V0Governor.sol), so
// checkpoint POSITION cannot affect its gas cost at all; including it would
// not measure anything this section is about.
//
// Verified empirically before writing this runner (not assumed): delegating
// at a zero balance does NOT create a checkpoint entry (numCheckpoints stays
// 0), so k weight-changing transfers produce exactly k checkpoints, matching
// the protocol's own expected value.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, deployCondition, verifyCorrespondence, STATE } = require("./lib");

const VOTING_DELAY = 20; // must exceed k/2 (max 8) for P2's pre-activation transfers to land before the snapshot
const VOTING_PERIOD = 20;
const SUPPLY = ethers.parseEther("100000");
const V2_QUORUM = ethers.parseEther("4000");
const TOTAL_WEIGHT = 4000n; // whole tokens; converted with `unit` below
const VARIANTS = ["V1", "V2", "Ref"];

function mineBlocks(n) {
  return hre.network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}
async function mineToBlock(target) {
  const current = await ethers.provider.getBlockNumber();
  if (target > current) await mineBlocks(target - current);
}

async function runP1(ctx, variant, k) {
  const supply = SUPPLY;
  const { token, registry, governor } = await deployCondition(ctx, {
    variant, tokenKind: "T1", supply, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: variant === "V2" ? V2_QUORUM : null, admin: ctx.admin,
  });
  await step(ctx, { variante: variant, etapa: "delegate_admin", condicao: "5.2-P1", posicao: "P1", k }, () => token.connect(ctx.admin).delegate(ctx.admin.address));
  const unit = 10n ** (await token.decimals());
  const voter = ctx.voter;

  await step(ctx, { variante: variant, etapa: "delegate_voter", condicao: "5.2-P1", posicao: "P1", k }, () => token.connect(voter).delegate(voter.address));

  const per = (TOTAL_WEIGHT * unit) / BigInt(k);
  let sent = 0n;
  for (let i = 0; i < k; i++) {
    const amount = (i === k - 1) ? (TOTAL_WEIGHT * unit - sent) : per; // last transfer absorbs rounding
    sent += amount;
    await step(ctx, { variante: variant, etapa: "transfer_history", condicao: "5.2-P1", posicao: "P1", k, ordem: i + 1 },
      () => token.connect(ctx.admin).transfer(voter.address, amount));
  }

  const registryAddr = await registry.getAddress();
  const calldata = registry.interface.encodeFunctionData("updateCredits", [1, 666]);
  const description = `5.2-P1-k${k}-${variant} ${ctx.runId} ${Date.now()}-${Math.random()}`;
  const proposeReceipt = await step(ctx, { variante: variant, etapa: "propose", condicao: "5.2-P1", posicao: "P1", k },
    () => governor.connect(ctx.admin).propose([registryAddr], [0], [calldata], description));
  const proposalId = proposeReceipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated").args.proposalId;
  await mineBlocks(VOTING_DELAY + 1);

  const snapshot = await governor.proposalSnapshot(proposalId);
  const numCkpts = await token.numCheckpoints(voter.address);
  const pastVotes = await governor.getVotes(voter.address, snapshot);
  console.log(`  P1 k=${k} (${variant}): numCheckpoints=${numCkpts} (expect ${k})  getPastVotes=${pastVotes / unit} (expect 4000)`);
  if (Number(numCkpts) !== k) throw new Error(`P1 k=${k} (${variant}): numCheckpoints=${numCkpts}, expected ${k} — condition interrupted, investigate`);
  if (pastVotes !== TOTAL_WEIGHT * unit) throw new Error(`P1 k=${k} (${variant}): getPastVotes=${pastVotes}, expected exactly ${TOTAL_WEIGHT * unit} — condition interrupted, investigate`);

  const voteReceipt = await step(ctx, { variante: variant, etapa: "vote_measured", condicao: "5.2-P1", posicao: "P1", k, direcao: "for", ordem: 1 },
    () => governor.connect(voter).castVote(proposalId, 1));
  console.log(`  P1 k=${k} (${variant}): measured vote gas=${voteReceipt.gasUsed}`);
}

async function runP2(ctx, variant, k) {
  const half = k / 2;
  const supply = SUPPLY;
  const { token, registry, governor } = await deployCondition(ctx, {
    variant, tokenKind: "T1", supply, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: variant === "V2" ? V2_QUORUM : null, admin: ctx.admin,
  });
  await step(ctx, { variante: variant, etapa: "delegate_admin", condicao: "5.2-P2", posicao: "P2", k }, () => token.connect(ctx.admin).delegate(ctx.admin.address));
  const unit = 10n ** (await token.decimals());
  const voter = ctx.voter;

  await step(ctx, { variante: variant, etapa: "delegate_voter", condicao: "5.2-P2", posicao: "P2", k }, () => token.connect(voter).delegate(voter.address));

  const registryAddr = await registry.getAddress();
  const calldata = registry.interface.encodeFunctionData("updateCredits", [1, 777]);
  const description = `5.2-P2-k${k}-${variant} ${ctx.runId} ${Date.now()}-${Math.random()}`;
  const proposeReceipt = await step(ctx, { variante: variant, etapa: "propose", condicao: "5.2-P2", posicao: "P2", k },
    () => governor.connect(ctx.admin).propose([registryAddr], [0], [calldata], description));
  const proposalId = proposeReceipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated").args.proposalId;
  const snapshot = await governor.proposalSnapshot(proposalId);

  // k/2 transfers BEFORE activation, building up to the full 4,000.
  const per = (TOTAL_WEIGHT * unit) / BigInt(half);
  let sent = 0n;
  for (let i = 0; i < half; i++) {
    const amount = (i === half - 1) ? (TOTAL_WEIGHT * unit - sent) : per;
    sent += amount;
    await step(ctx, { variante: variant, etapa: "transfer_pre_activation", condicao: "5.2-P2", posicao: "P2", k, ordem: i + 1 },
      () => token.connect(ctx.admin).transfer(voter.address, amount));
  }
  const blockAfterPreTransfers = await ethers.provider.getBlockNumber();
  if (BigInt(blockAfterPreTransfers) > snapshot) {
    throw new Error(`P2 k=${k} (${variant}): pre-activation transfers spilled past the snapshot block (${blockAfterPreTransfers} > ${snapshot}) — increase VOTING_DELAY`);
  }

  // Advance to exactly one block past the snapshot (Active).
  await mineToBlock(Number(snapshot) + 1);

  // k/2 alternating post-activation changes, each its own block: out, in, out, in...
  for (let i = 0; i < half; i++) {
    const outward = i % 2 === 0;
    await step(ctx, { variante: variant, etapa: "transfer_post_activation", condicao: "5.2-P2", posicao: "P2", k, ordem: i + 1, direcao: outward ? "out" : "in" },
      () => outward
        ? token.connect(voter).transfer(ctx.admin.address, ethers.parseEther("1"))
        : token.connect(ctx.admin).transfer(voter.address, ethers.parseEther("1")));
  }

  const numCkpts = await token.numCheckpoints(voter.address);
  const pastVotes = await governor.getVotes(voter.address, snapshot);
  const liveBalance = await token.balanceOf(voter.address);
  console.log(`  P2 k=${k} (${variant}): numCheckpoints=${numCkpts} (expect ${k})  getPastVotes=${pastVotes / unit} (expect 4000)  liveBalance=${liveBalance / unit} (expect ${half % 2 === 0 ? 4000 : 3999})`);
  if (Number(numCkpts) !== k) throw new Error(`P2 k=${k} (${variant}): numCheckpoints=${numCkpts}, expected ${k} — condition interrupted, investigate`);
  if (pastVotes !== TOTAL_WEIGHT * unit) throw new Error(`P2 k=${k} (${variant}): getPastVotes=${pastVotes}, expected exactly ${TOTAL_WEIGHT * unit} — condition interrupted, investigate`);

  const stateNow = STATE[Number(await governor.state(proposalId))];
  if (stateNow !== "Active") throw new Error(`P2 k=${k} (${variant}): proposal is ${stateNow}, not Active, at vote time`);

  const voteReceipt = await step(ctx, { variante: variant, etapa: "vote_measured", condicao: "5.2-P2", posicao: "P2", k, direcao: "for", ordem: 1 },
    () => governor.connect(voter).castVote(proposalId, 1));
  console.log(`  P2 k=${k} (${variant}): measured vote gas=${voteReceipt.gasUsed}`);
}

async function main() {
  const ctx = newRun("checkpoint-history");
  const signers = await ethers.getSigners();
  ctx.admin = signers[0];
  ctx.voter = signers[1];

  for (const variant of VARIANTS) {
    console.log(`\n=== ${variant} — P1 ===`);
    for (const k of [1, 2, 4, 8, 16]) {
      console.log(`--- k=${k} ---`);
      await runP1(ctx, variant, k);
    }
    console.log(`\n=== ${variant} — P2 ===`);
    for (const k of [2, 4, 8, 16]) {
      console.log(`--- k=${k} ---`);
      await runP2(ctx, variant, k);
    }
  }

  verifyCorrespondence(ctx);
  ctx.manifest.finishedAt = new Date().toISOString();
  require("fs").writeFileSync(require("path").join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

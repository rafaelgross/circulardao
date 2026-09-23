// Runner for protocol section 8 (B1-B4), across V0/V1/V2/Ref, at the
// Sepolia-calibrated scale (supply 100,000 -> quorum 4,000 for both V2's
// fixed threshold and Ref's natural 4% fraction). Produces manifest.json,
// results.csv and receipts.json under experiments/ablation/results/<runId>/,
// per protocol section 9.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, deployCondition, STATE } = require("./lib");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 10;
const SUPPLY = ethers.parseEther("100000");
const V2_QUORUM = ethers.parseEther("4000");
const W = ethers.parseEther("4000");
const VARIANTS = ["V0", "V1", "V2", "Ref"];

async function propose(ctx, variant, governor, registry, admin, categoryId, newFactor, condicao) {
  const registryAddr = await registry.getAddress();
  const calldata = registry.interface.encodeFunctionData("updateCredits", [categoryId, newFactor]);
  const description = `${condicao}-${variant} ${ctx.runId} ${Date.now()}-${Math.random()}`;
  const receipt = await step(ctx, { variante: variant, etapa: "propose", condicao },
    () => governor.connect(admin).propose([registryAddr], [0], [calldata], description));
  const created = receipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;
  return { proposalId, targets: [await registry.getAddress()], values: [0], calldata, descHash: ethers.id(description) };
}

async function main() {
  const ctx = newRun("b1-b4");
  const signers = await ethers.getSigners();
  // One dedicated, never-reused signer per role across ALL of B1-B4, so no
  // scenario's leftover balance/delegation contaminates another's (this bug
  // was caught by hand on the first run: reusing one "attacker" account
  // across B1 and B3 left B3's against-side at 83,000 instead of 63,000).
  const [admin, b1Acquirer, b2Small, b3For1, b3For2, b3For3, b3Against, b4Voter] = signers;

  for (const variant of VARIANTS) {
    console.log(`\n=== ${variant} ===`);
    const { token, registry, governor } = await deployCondition(ctx, {
      variant, tokenKind: "T1", supply: SUPPLY, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
      quorumFixed: variant === "V2" ? V2_QUORUM : null, admin,
    });

    const allRoleSigners = [admin, b1Acquirer, b2Small, b3For1, b3For2, b3For3, b3Against, b4Voter];
    for (const s of allRoleSigners) {
      await step(ctx, { variante: variant, etapa: "delegate", condicao: "setup" },
        () => token.connect(s).delegate(s.address));
    }

    // ---- B1: post-activation acquisition ----
    {
      const p = await propose(ctx, variant, governor, registry, admin, 1, 111, "B1");
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);
      const snapshot = await governor.proposalSnapshot(p.proposalId);
      const weightAtActivation = await governor.getVotes(b1Acquirer.address, snapshot);
      const before = await governor.proposalVotes(p.proposalId);
      await step(ctx, { variante: variant, etapa: "transfer_post_snapshot", condicao: "B1" },
        () => token.connect(admin).transfer(b1Acquirer.address, ethers.parseEther("20000")));
      await step(ctx, { variante: variant, etapa: "delegate_post_snapshot", condicao: "B1" },
        () => token.connect(b1Acquirer).delegate(b1Acquirer.address));
      await step(ctx, { variante: variant, etapa: "vote", condicao: "B1", direcao: "for", ordem: 1 },
        () => governor.connect(b1Acquirer).castVote(p.proposalId, 1));
      const after = await governor.proposalVotes(p.proposalId);
      const moved = after.forVotes - before.forVotes;
      console.log(`  B1  weight@activation=${weightAtActivation}  tally moved by=${moved}`);
    }

    // ---- B2: unanimous support below quorum ----
    {
      await step(ctx, { variante: variant, etapa: "transfer", condicao: "B2" },
        () => token.connect(admin).transfer(b2Small.address, ethers.parseEther("1000")));
      const p = await propose(ctx, variant, governor, registry, b1Acquirer, 1, 222, "B2");
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);
      await step(ctx, { variante: variant, etapa: "vote", condicao: "B2", direcao: "for", ordem: 1 },
        () => governor.connect(b2Small).castVote(p.proposalId, 1));
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_PERIOD + 1).toString(16)]);
      const state = STATE[Number(await governor.state(p.proposalId))];
      console.log(`  B2  state=${state}`);
      if (state === "Succeeded") {
        await step(ctx, { variante: variant, etapa: "execute", condicao: "B2" },
          () => governor.execute(p.targets, p.values, [p.calldata], p.descHash));
        const cat = await registry.getCategory(1);
        console.log(`  B2  registered creditsPerKg=${cat.creditsPerKg} (expect 222)`);
      } else {
        await step(ctx, { variante: variant, etapa: "execute_attempt", condicao: "B2" },
          () => governor.execute(p.targets, p.values, [p.calldata], p.descHash, { gasLimit: 300000 }),
          { expectRevert: true, decodeFn: () => governor.execute.staticCall(p.targets, p.values, [p.calldata], p.descHash) });
      }
    }

    // ---- B3: token weight beats simple wallet-count majority ----
    {
      for (const v of [b3For1, b3For2, b3For3]) {
        await step(ctx, { variante: variant, etapa: "transfer", condicao: "B3" }, () => token.connect(admin).transfer(v.address, W));
      }
      await step(ctx, { variante: variant, etapa: "transfer", condicao: "B3" },
        () => token.connect(admin).transfer(b3Against.address, ethers.parseEther("63000")));
      const p = await propose(ctx, variant, governor, registry, b1Acquirer, 1, 333, "B3");
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);
      let ordem = 1;
      for (const v of [b3For1, b3For2, b3For3]) {
        await step(ctx, { variante: variant, etapa: "vote", condicao: "B3", direcao: "for", ordem: ordem++ },
          () => governor.connect(v).castVote(p.proposalId, 1));
      }
      await step(ctx, { variante: variant, etapa: "vote", condicao: "B3", direcao: "against", ordem: 1 },
        () => governor.connect(b3Against).castVote(p.proposalId, 0));
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_PERIOD + 1).toString(16)]);
      const tally = await governor.proposalVotes(p.proposalId);
      const quorumAtSnapshot = await governor.quorum(await governor.proposalSnapshot(p.proposalId));
      const state = STATE[Number(await governor.state(p.proposalId))];
      console.log(`  B3  for=${tally.forVotes} against=${tally.againstVotes} quorum=${quorumAtSnapshot} state=${state}`);
      if (tally.forVotes < quorumAtSnapshot) console.log("  B3  WARNING: quorum not met by FOR side alone — defeat is not attributable to vote weight alone");
      if (tally.againstVotes !== ethers.parseEther("63000")) console.log(`  B3  WARNING: against tally is ${tally.againstVotes}, expected exactly 63000`);
    }

    // ---- B4: repeated vote ----
    {
      await step(ctx, { variante: variant, etapa: "transfer", condicao: "B4" }, () => token.connect(admin).transfer(b4Voter.address, W));
      const p = await propose(ctx, variant, governor, registry, b1Acquirer, 1, 444, "B4");
      await hre.network.provider.send("hardhat_mine", ["0x" + (VOTING_DELAY + 1).toString(16)]);
      await step(ctx, { variante: variant, etapa: "vote", condicao: "B4", direcao: "for", ordem: 1 },
        () => governor.connect(b4Voter).castVote(p.proposalId, 1));
      await step(ctx, { variante: variant, etapa: "vote_repeat", condicao: "B4", direcao: "for", ordem: 2 },
        () => governor.connect(b4Voter).castVote(p.proposalId, 1, { gasLimit: 200000 }),
        { expectRevert: true, decodeFn: () => governor.connect(b4Voter).castVote.staticCall(p.proposalId, 1) });
    }
  }

  ctx.manifest.finishedAt = new Date().toISOString();
  require("fs").writeFileSync(require("path").join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

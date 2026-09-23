// Runner for protocol section 8 (B1-B4), across V0/V1/V2/Ref.
//
// Each (variant x scenario) combination gets its OWN fresh token+registry+
// governor deployment — 16 deployments total, not 4. Protocol condition 4
// ("implantação nova por condição, para estado inicial idêntico") is read
// here as applying to each scenario, not just each variant: an earlier
// version of this runner shared one deployment across B1->B2->B3->B4 within
// a variant, which meant B2/B3/B4 depended on tokens/roles that a PRIOR
// scenario happened to leave behind — caught in review before this was
// treated as a result.
//
// Supply is 100,000 for every deployment (Ref's fixed 4% fraction -> exactly
// 4,000, matching V2's fixed quorum and the real Sepolia deployment). With
// scenarios independent, B3 (the heaviest at 75,000 tokens distributed)
// still fits comfortably inside a single fresh 100,000-supply deployment, so
// Ref runs in all four B-scenarios with no exclusion at this scale. The
// large N-sweep (5.1, not started) is a different story — N=32 and N=50 need
// more tokens than a 100,000-supply Ref can hold while keeping its quorum at
// 4,000, and Ref will need to be explicitly excluded there. That is a
// consequence of Ref's quorum fraction being fixed in the deployed contract,
// not a choice to make results look more comparable than they are.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, recordQuery, deployCondition, verifyIntegrity, STATE } = require("./lib");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 10;
const SUPPLY = ethers.parseEther("100000");
const V2_QUORUM = ethers.parseEther("4000");
const W = ethers.parseEther("4000");
const VARIANTS = ["V0", "V1", "V2", "Ref"];

async function mineBlocks(n) {
  await hre.network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

// Fixed, deterministic description (protocol v1.4 step 1) — no Date.now()/
// Math.random()/runId. This is safe even though it repeats the same string
// across separate script runs: hashProposal() (and thus proposalId) does not
// include the governor's own address, but each run deploys a brand new
// governor with brand new storage, so identical proposalIds in two different
// governor contracts never collide with each other.
async function propose(ctx, variant, governor, registry, proposer, categoryId, newFactor, condicao) {
  const registryAddr = await registry.getAddress();
  const calldata = registry.interface.encodeFunctionData("updateCredits", [categoryId, newFactor]);
  const description = `ablation-v1.4-${condicao}-${variant}-cat${categoryId}-factor${newFactor}`;
  // Always the generic propose() — including for Ref, which also exposes a
  // proposeUpdateCreditWeight(...) wrapper (protocol v1.4 step 2 requires
  // recording which one is used). The wrapper is deliberately NOT used here:
  // it is pure metadata sugar over this same propose() call (confirmed by
  // reading CircularDAO.sol), so calling propose() directly keeps the
  // compared operation — same selector, same targets/calldata/description
  // shape — byte-identical across all four variants.
  const receipt = await step(ctx, { variante: variant, etapa: "propose", condicao, funcao: "propose", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(proposer).propose([registryAddr], [0], [calldata], description));
  const created = receipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;
  return { proposalId, targets: [registryAddr], values: [0], calldata, descHash: ethers.id(description) };
}

/** Every scenario starts from its own fresh deployment. `admin` (who mints
 * the token and always starts a fresh scenario holding the full 100,000
 * supply) is the proposer every time — no scenario depends on tokens a
 * PRIOR scenario happened to distribute. */
async function freshScenario(ctx, variant) {
  const { token, registry, governor } = await deployCondition(ctx, {
    variant, tokenKind: "T1", supply: SUPPLY, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: variant === "V2" ? V2_QUORUM : null, admin: ctx.admin,
  });
  await step(ctx, { variante: variant, etapa: "delegate_admin", condicao: "setup" },
    () => token.connect(ctx.admin).delegate(ctx.admin.address));
  return { token, registry, governor };
}

async function runB1(ctx, variant) {
  const { token, registry, governor } = await freshScenario(ctx, variant);
  const acquirer = ctx.roles.b1Acquirer;
  await step(ctx, { variante: variant, etapa: "delegate", condicao: "B1" }, () => token.connect(acquirer).delegate(acquirer.address));

  const p = await propose(ctx, variant, governor, registry, ctx.admin, 1, 111, "B1");
  await mineBlocks(VOTING_DELAY + 1);
  const snapshot = await governor.proposalSnapshot(p.proposalId);
  const weightAtActivation = await governor.getVotes(acquirer.address, snapshot);
  recordQuery(ctx, { etapa: "check_weight_at_activation", variante: variant, condicao: "B1", query: "governor.getVotes(acquirer, snapshot)", expected: "0", actual: weightAtActivation, ok: weightAtActivation === 0n });

  const before = await governor.proposalVotes(p.proposalId);
  await step(ctx, { variante: variant, etapa: "transfer_post_snapshot", condicao: "B1" },
    () => token.connect(ctx.admin).transfer(acquirer.address, ethers.parseEther("20000")));
  await step(ctx, { variante: variant, etapa: "delegate_post_snapshot", condicao: "B1" },
    () => token.connect(acquirer).delegate(acquirer.address));
  await step(ctx, { variante: variant, etapa: "vote", condicao: "B1", direcao: "for", ordem: 1, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(acquirer).castVote(p.proposalId, 1));
  const after = await governor.proposalVotes(p.proposalId);
  const moved = after.forVotes - before.forVotes;

  const expected = variant === "V0" ? ethers.parseEther("20000") : 0n;
  console.log(`  B1  weight@activation=${weightAtActivation}  tally moved by=${moved}  expected=${expected}`);
  recordQuery(ctx, { etapa: "check_tally_movement", variante: variant, condicao: "B1", query: "proposalVotes(id).forVotes delta after post-snapshot transfer+vote", expected, actual: moved, ok: moved === expected });
}

async function runB2(ctx, variant) {
  const { token, registry, governor } = await freshScenario(ctx, variant);
  const small = ctx.roles.b2Small;
  await step(ctx, { variante: variant, etapa: "delegate", condicao: "B2" }, () => token.connect(small).delegate(small.address));
  await step(ctx, { variante: variant, etapa: "transfer", condicao: "B2" },
    () => token.connect(ctx.admin).transfer(small.address, ethers.parseEther("1000")));

  const p = await propose(ctx, variant, governor, registry, ctx.admin, 1, 222, "B2");
  await mineBlocks(VOTING_DELAY + 1);
  await step(ctx, { variante: variant, etapa: "vote", condicao: "B2", direcao: "for", ordem: 1, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(small).castVote(p.proposalId, 1));
  await mineBlocks(VOTING_PERIOD + 1);
  const state = STATE[Number(await governor.state(p.proposalId))];
  const expected = (variant === "V0" || variant === "V1") ? "Succeeded" : "Defeated";
  console.log(`  B2  state=${state}  expected=${expected}`);
  recordQuery(ctx, { etapa: "check_state", variante: variant, condicao: "B2", query: "governor.state(id)", expected, actual: state, ok: state === expected });

  if (state === "Succeeded") {
    await step(ctx, { variante: variant, etapa: "execute", condicao: "B2", funcao: "execute", operacao_governada: "WasteCategoryRegistry.updateCredits" },
      () => governor.execute(p.targets, p.values, [p.calldata], p.descHash));
    const cat = await registry.getCategory(1);
    console.log(`  B2  registered creditsPerKg=${cat.creditsPerKg} (expect 222)`);
    recordQuery(ctx, { etapa: "check_executed_effect", variante: variant, condicao: "B2", query: "registry.getCategory(1).creditsPerKg", expected: "222", actual: cat.creditsPerKg, ok: cat.creditsPerKg === 222n });
  } else {
    await step(ctx, { variante: variant, etapa: "execute_attempt", condicao: "B2", funcao: "execute", operacao_governada: "WasteCategoryRegistry.updateCredits" },
      () => governor.execute(p.targets, p.values, [p.calldata], p.descHash, { gasLimit: 300000 }),
      { expectRevert: true, decodeFn: () => governor.execute.staticCall(p.targets, p.values, [p.calldata], p.descHash) });
  }
}

async function runB3(ctx, variant) {
  const { token, registry, governor } = await freshScenario(ctx, variant);
  const { b3For1, b3For2, b3For3, b3Against } = ctx.roles;
  for (const v of [b3For1, b3For2, b3For3, b3Against]) {
    await step(ctx, { variante: variant, etapa: "delegate", condicao: "B3" }, () => token.connect(v).delegate(v.address));
  }
  for (const v of [b3For1, b3For2, b3For3]) {
    await step(ctx, { variante: variant, etapa: "transfer", condicao: "B3" }, () => token.connect(ctx.admin).transfer(v.address, W));
  }
  await step(ctx, { variante: variant, etapa: "transfer", condicao: "B3" },
    () => token.connect(ctx.admin).transfer(b3Against.address, ethers.parseEther("63000")));

  const p = await propose(ctx, variant, governor, registry, ctx.admin, 1, 333, "B3");
  await mineBlocks(VOTING_DELAY + 1);
  let ordem = 1;
  for (const v of [b3For1, b3For2, b3For3]) {
    await step(ctx, { variante: variant, etapa: "vote", condicao: "B3", direcao: "for", ordem: ordem++, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
      () => governor.connect(v).castVote(p.proposalId, 1));
  }
  await step(ctx, { variante: variant, etapa: "vote", condicao: "B3", direcao: "against", ordem: 1, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(b3Against).castVote(p.proposalId, 0));
  await mineBlocks(VOTING_PERIOD + 1);

  const tally = await governor.proposalVotes(p.proposalId);
  const quorumAtSnapshot = await governor.quorum(await governor.proposalSnapshot(p.proposalId));
  const state = STATE[Number(await governor.state(p.proposalId))];
  console.log(`  B3  for=${tally.forVotes} against=${tally.againstVotes} quorum=${quorumAtSnapshot} state=${state}`);

  recordQuery(ctx, { etapa: "check_for_votes", variante: variant, condicao: "B3", query: "proposalVotes(id).forVotes", expected: (3n * W).toString(), actual: tally.forVotes, ok: tally.forVotes === 3n * W });
  recordQuery(ctx, { etapa: "check_against_votes", variante: variant, condicao: "B3", query: "proposalVotes(id).againstVotes", expected: ethers.parseEther("63000").toString(), actual: tally.againstVotes, ok: tally.againstVotes === ethers.parseEther("63000") });
  recordQuery(ctx, { etapa: "check_quorum_met_by_for_alone", variante: variant, condicao: "B3", query: "forVotes >= governor.quorum(snapshot)", expected: "true", actual: tally.forVotes >= quorumAtSnapshot, ok: tally.forVotes >= quorumAtSnapshot });
  recordQuery(ctx, { etapa: "check_state", variante: variant, condicao: "B3", query: "governor.state(id)", expected: "Defeated", actual: state, ok: state === "Defeated" });
}

async function runB4(ctx, variant) {
  const { token, registry, governor } = await freshScenario(ctx, variant);
  const voter = ctx.roles.b4Voter;
  await step(ctx, { variante: variant, etapa: "delegate", condicao: "B4" }, () => token.connect(voter).delegate(voter.address));
  await step(ctx, { variante: variant, etapa: "transfer", condicao: "B4" }, () => token.connect(ctx.admin).transfer(voter.address, W));

  const p = await propose(ctx, variant, governor, registry, ctx.admin, 1, 444, "B4");
  await mineBlocks(VOTING_DELAY + 1);

  // 1) the first vote must actually succeed.
  const firstReceipt = await step(ctx, { variante: variant, etapa: "vote", condicao: "B4", direcao: "for", ordem: 1, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(voter).castVote(p.proposalId, 1));
  if (firstReceipt.status !== 1) throw new Error(`B4 (${variant}): first vote did not succeed (status ${firstReceipt.status})`);

  // 2) the second attempt must happen while the proposal is still Active —
  // otherwise a revert could be caused by the window closing, not by the
  // repeated-vote guard, and would be the wrong evidence for this scenario.
  const stateBeforeRepeat = STATE[Number(await governor.state(p.proposalId))];
  if (stateBeforeRepeat !== "Active") throw new Error(`B4 (${variant}): proposal is ${stateBeforeRepeat}, not Active, before the repeat-vote attempt`);

  // 3) the second attempt must fail SPECIFICALLY with GovernorAlreadyCastVote
  // — decoded via a staticCall replay of the exact same call, done inside
  // step() BEFORE sending, and returned on the receipt so it's asserted on
  // here rather than trusted blindly.
  const repeatReceipt = await step(ctx, { variante: variant, etapa: "vote_repeat", condicao: "B4", direcao: "for", ordem: 2, funcao: "castVote", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(voter).castVote(p.proposalId, 1, { gasLimit: 200000 }),
    { expectRevert: true, decodeFn: () => governor.connect(voter).castVote.staticCall(p.proposalId, 1) });

  const decodedOk = /GovernorAlreadyCastVote/.test(repeatReceipt.revertReason || "");
  console.log(`  B4  first vote status=${firstReceipt.status}  state before repeat=${stateBeforeRepeat}  repeat status=${repeatReceipt.status}  reason="${repeatReceipt.revertReason}"  confirmsGovernorAlreadyCastVote=${decodedOk}`);
  recordQuery(ctx, { etapa: "check_first_vote_succeeded", variante: variant, condicao: "B4", query: "firstReceipt.status", expected: "1", actual: firstReceipt.status, ok: firstReceipt.status === 1 });
  recordQuery(ctx, { etapa: "check_state_before_repeat", variante: variant, condicao: "B4", query: "governor.state(id) before repeat attempt", expected: "Active", actual: stateBeforeRepeat, ok: stateBeforeRepeat === "Active" });
  recordQuery(ctx, { etapa: "check_repeat_reason", variante: variant, condicao: "B4", query: "decoded revert reason of repeat castVote", expected: "GovernorAlreadyCastVote", actual: repeatReceipt.revertReason, ok: decodedOk });
}

async function main() {
  const ctx = newRun("b1-b4");
  const signers = await ethers.getSigners();
  ctx.admin = signers[0];
  ctx.roles = {
    b1Acquirer: signers[1], b2Small: signers[2],
    b3For1: signers[3], b3For2: signers[4], b3For3: signers[5], b3Against: signers[6],
    b4Voter: signers[7],
  };

  for (const variant of VARIANTS) {
    console.log(`\n=== ${variant} ===`);
    await runB1(ctx, variant);
    await runB2(ctx, variant);
    await runB3(ctx, variant);
    await runB4(ctx, variant);
  }

  verifyIntegrity(ctx);
  ctx.manifest.finishedAt = new Date().toISOString();
  ctx.manifest.governedOperation = { target: "WasteCategoryRegistry.updateCredits(uint256,uint256)", proposedVia: "propose() (generic) for all four variants — Ref's proposeUpdateCreditWeight wrapper is metadata sugar over the same call, deliberately not used, so the compared selector/calldata is identical across variants" };
  ctx.manifest.quorumByVariant = {
    V0: { model: "none" }, V1: { model: "none" },
    V2: { model: "fixed", supply: SUPPLY.toString(), effectiveQuorum: V2_QUORUM.toString() },
    Ref: { model: "fraction-of-supply (4%, hardcoded in CircularDAO's constructor, not a deploy parameter)", supply: SUPPLY.toString(), effectiveQuorum: (SUPPLY * 4n / 100n).toString() },
  };
  ctx.manifest.calibrationStrategy = "n/a — this run does not compare against Sepolia";
  require("fs").writeFileSync(require("path").join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json, queries.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

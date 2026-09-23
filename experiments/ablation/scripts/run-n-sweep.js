// Runner for protocol section 5.1: N in {1,2,4,8,16,32,50}, composition
// conditions A-unanime / A-maioria / D-voto / E-empate, across V0/V1/V2/Ref.
//
// Ref exclusion: Ref's quorum is a fixed 4% of ITS OWN token's total supply
// (hardcoded in CircularDAO's constructor, confirmed by reading the source —
// see the note in run-b1-b4.js). To keep Ref's quorum at exactly 4,000
// (matching V2's fixed threshold and the real Sepolia deployment), Ref's
// token supply is fixed at 100,000, same as the B1-B4 tier. N=32 (128,000
// tokens needed) and N=50 (200,000) do not fit in that supply, so Ref is
// excluded there — a real mathematical constraint of the deployed contract,
// not a choice made to keep results looking more comparable than they are
// (see the review that established this). V0/V1/V2 have no such constraint
// and use a larger shared supply (300,000) so they run at every N.
//
// Each (variant, N, condition) combination gets its own fresh deployment —
// same independence requirement established for B1-B4.
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, recordQuery, deployCondition, verifyIntegrity, STATE } = require("./lib");

const VOTING_DELAY = 1;
// Hardhat Network auto-mines one block per transaction (no batching), so
// each sequential vote consumes a full block of the Active window — unlike
// a real chain, where many votes can land in the same block. With up to 50
// voters, the window must be wider than the vote count or later voters find
// it already closed (caught by hand: N=32's 10th vote reverted, gas
// coincidentally close to a double-vote revert's, which was the wrong first
// guess — it was GovernorUnexpectedProposalState, the window had closed).
const VOTING_PERIOD = 100;
const VOTER_WEIGHT = ethers.parseEther("4000"); // protocol condition 4: fixed per-voter weight
const V2_QUORUM = ethers.parseEther("4000");
const REF_SUPPLY = ethers.parseEther("100000");   // -> Ref quorum = 4,000 (4% fixed)
const MAIN_SUPPLY = ethers.parseEther("300000");  // covers N=50 (200,000) + headroom for V0/V1/V2

const REF_MAX_N = 22; // 22 * 4,000 = 88,000, comfortably under 100,000 with proposer headroom

function mineBlocks(n) {
  return hre.network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

/** Which composition conditions apply to a given N, per protocol section 5.1's table. */
function applicableConditions(N) {
  const conds = ["A-unanime"];
  if (N >= 3) conds.push("A-maioria", "D-voto");
  if (N >= 2 && N % 2 === 0) conds.push("E-empate");
  return conds;
}

/** For a given N and condition, returns { forCount, againstCount }. */
function composition(N, condicao) {
  if (condicao === "A-unanime") return { forCount: N, againstCount: 0 };
  if (condicao === "A-maioria") { const f = Math.floor(N / 2) + 1; return { forCount: f, againstCount: N - f }; }
  if (condicao === "D-voto") { const a = Math.floor(N / 2) + 1; return { forCount: N - a, againstCount: a }; }
  if (condicao === "E-empate") return { forCount: N / 2, againstCount: N / 2 };
  throw new Error(`unknown condicao ${condicao}`);
}

const expectedOutcome = {
  "A-unanime": "aprovada",
  "A-maioria": "aprovada",
  "D-voto": "derrotada",
  "E-empate": "derrotada",
};

async function runOne(ctx, variant, N, condicao) {
  const { forCount, againstCount } = composition(N, condicao);
  const supply = variant === "Ref" ? REF_SUPPLY : MAIN_SUPPLY;

  const { token, registry, governor } = await deployCondition(ctx, {
    variant, tokenKind: "T1", supply, votingDelay: VOTING_DELAY, votingPeriod: VOTING_PERIOD,
    quorumFixed: variant === "V2" ? V2_QUORUM : null, admin: ctx.admin,
  });
  await step(ctx, { variante: variant, etapa: "delegate_admin", condicao, N }, () => token.connect(ctx.admin).delegate(ctx.admin.address));

  const voters = ctx.signers.slice(1, 1 + N); // N dedicated voters, fresh per call (fresh deployment anyway)
  for (const v of voters) {
    await step(ctx, { variante: variant, etapa: "delegate", condicao, N }, () => token.connect(v).delegate(v.address));
  }
  for (const v of voters) {
    await step(ctx, { variante: variant, etapa: "transfer", condicao, N }, () => token.connect(ctx.admin).transfer(v.address, VOTER_WEIGHT));
  }

  const registryAddr = await registry.getAddress();
  const calldata = registry.interface.encodeFunctionData("updateCredits", [1, 555]);
  // Fixed, deterministic description (v1.4 step 1) — no Date.now()/Math.random()/runId; safe for the same reason documented in run-b1-b4.js (hashProposal excludes the governor address, but each combination deploys its own fresh governor).
  const description = `ablation-v1.4-5.1-${condicao}-N${N}-${variant}`;
  const proposeReceipt = await step(ctx, { variante: variant, etapa: "propose", condicao, N, funcao: "propose", operacao_governada: "WasteCategoryRegistry.updateCredits" },
    () => governor.connect(ctx.admin).propose([registryAddr], [0], [calldata], description));
  const created = proposeReceipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;
  await mineBlocks(VOTING_DELAY + 1);

  // Vote order/direction recorded per protocol condition 4 ("o primeiro voto
  // registrado em cada direção custa mais que os seguintes"): FOR voters
  // first (in registration order), then AGAINST voters.
  let ordem = 1;
  for (const v of voters.slice(0, forCount)) {
    await step(ctx, { variante: variant, etapa: "vote", condicao, N, direcao: "for", ordem: ordem++ },
      () => governor.connect(v).castVote(proposalId, 1));
  }
  ordem = 1;
  for (const v of voters.slice(forCount, forCount + againstCount)) {
    await step(ctx, { variante: variant, etapa: "vote", condicao, N, direcao: "against", ordem: ordem++ },
      () => governor.connect(v).castVote(proposalId, 0));
  }

  await mineBlocks(VOTING_PERIOD + 1);
  const tally = await governor.proposalVotes(proposalId);
  const quorumAtSnapshot = await governor.quorum(await governor.proposalSnapshot(proposalId));
  const state = STATE[Number(await governor.state(proposalId))];
  const outcome = state === "Succeeded" || state === "Executed" ? "aprovada" : "derrotada";

  console.log(`  N=${N} ${condicao} (${variant}): for=${tally.forVotes / VOTER_WEIGHT}x4000 against=${tally.againstVotes / VOTER_WEIGHT}x4000 quorum=${quorumAtSnapshot / VOTER_WEIGHT}x4000 state=${state}`);

  recordQuery(ctx, { etapa: "check_for_votes", variante: variant, condicao: `${condicao}-N${N}`, query: "proposalVotes(id).forVotes", expected: (BigInt(forCount) * VOTER_WEIGHT).toString(), actual: tally.forVotes, ok: tally.forVotes === BigInt(forCount) * VOTER_WEIGHT });
  recordQuery(ctx, { etapa: "check_against_votes", variante: variant, condicao: `${condicao}-N${N}`, query: "proposalVotes(id).againstVotes", expected: (BigInt(againstCount) * VOTER_WEIGHT).toString(), actual: tally.againstVotes, ok: tally.againstVotes === BigInt(againstCount) * VOTER_WEIGHT });
  if (forCount > 0) {
    recordQuery(ctx, { etapa: "check_quorum_met_by_for_alone", variante: variant, condicao: `${condicao}-N${N}`, query: "forVotes >= governor.quorum(snapshot)", expected: "true", actual: tally.forVotes >= quorumAtSnapshot, ok: tally.forVotes >= quorumAtSnapshot });
  }
  recordQuery(ctx, { etapa: "check_outcome", variante: variant, condicao: `${condicao}-N${N}`, query: "derived outcome from governor.state(id)", expected: expectedOutcome[condicao], actual: outcome, ok: outcome === expectedOutcome[condicao] });

  // Execution: only measured for the A-conditions. D/E get a separate,
  // expected-to-revert execute ATTEMPT — never aggregated with a successful
  // execution's stats (protocol 5.1: "Execução bem-sucedida e tentativa
  // revertida nunca são agregadas na mesma estatística").
  if (expectedOutcome[condicao] === "aprovada") {
    await step(ctx, { variante: variant, etapa: "execute", condicao, N, funcao: "execute", operacao_governada: "WasteCategoryRegistry.updateCredits" },
      () => governor.execute([registryAddr], [0], [calldata], ethers.id(description)));
  } else {
    await step(ctx, { variante: variant, etapa: "execute_attempt", condicao, N, funcao: "execute", operacao_governada: "WasteCategoryRegistry.updateCredits" },
      () => governor.execute([registryAddr], [0], [calldata], ethers.id(description), { gasLimit: 300000 }),
      { expectRevert: true, decodeFn: () => governor.execute.staticCall([registryAddr], [0], [calldata], ethers.id(description)) });
  }
}

async function main() {
  const Ns = (process.env.N_LIST ? process.env.N_LIST.split(",").map(Number) : [1, 2, 4, 8, 16, 32, 50]);
  const ctx = newRun(`n-sweep_${Ns.join("-")}`);
  ctx.signers = await ethers.getSigners();
  ctx.admin = ctx.signers[0];

  let planned = 0, ran = 0, skipped = 0;
  for (const N of Ns) {
    for (const condicao of applicableConditions(N)) {
      for (const variant of ["V0", "V1", "V2", "Ref"]) {
        planned++;
        if (variant === "Ref" && N > REF_MAX_N) {
          console.log(`\n=== N=${N} ${condicao} Ref: SKIPPED (nao aplicavel, precisa de ${N * 4000} tokens > oferta fixa da Ref de 100000) ===`);
          skipped++;
          continue;
        }
        console.log(`\n=== N=${N} ${condicao} ${variant} ===`);
        await runOne(ctx, variant, N, condicao);
        ran++;
      }
    }
  }

  verifyIntegrity(ctx);
  ctx.manifest.finishedAt = new Date().toISOString();
  ctx.manifest.sweepSummary = { Ns, planned, ran, skipped, refMaxN: REF_MAX_N };
  ctx.manifest.governedOperation = { target: "WasteCategoryRegistry.updateCredits(uint256,uint256)", proposedVia: "propose() (generic) for all four variants" };
  ctx.manifest.quorumByVariant = {
    V0: { model: "none" }, V1: { model: "none" },
    V2: { model: "fixed", supply: MAIN_SUPPLY.toString(), effectiveQuorum: V2_QUORUM.toString() },
    Ref: { model: "fraction-of-supply (4%, hardcoded in CircularDAO's constructor)", supply: REF_SUPPLY.toString(), effectiveQuorum: (REF_SUPPLY * 4n / 100n).toString() },
  };
  ctx.manifest.calibrationStrategy = "n/a — this run does not compare against Sepolia";
  require("fs").writeFileSync(require("path").join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nplanned=${planned} ran=${ran} skipped=${skipped}`);
  console.log(`wrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json, queries.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

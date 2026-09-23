// Runner for protocol section 3.2: T0 (plain ERC20) vs T1 (ERC20Votes),
// transfer and delegation gas.
//
// T1 transfer is measured in two states, both reported (the protocol doesn't
// pick one, and the difference IS informative): "undelegated" (sender and
// recipient never called delegate() — OZ v5 does not auto-self-delegate, so
// _transferVotingUnits has nothing to checkpoint and this should cost close
// to T0) and "delegated" (both sides already self-delegated, the state every
// voter is actually in throughout the rest of this study — condition 4:
// "cada votante delega a si mesmo... depois recebe"). Only "delegated" is
// the realistic governance-relevant number; "undelegated" isolates how much
// of the difference is delegation-driven versus base ERC20Votes overhead.
//
// This is a comparison between two token implementations, not an isolated
// measurement of "the cost of checkpoints" — see protocol 3.2's own caveat
// (a third, checkpoint-less-but-delegating control would be needed for that,
// and is explicitly out of scope).
const hre = require("hardhat");
const { ethers } = hre;
const { newRun, step, recordTx, verifyIntegrity } = require("./lib");

const SUPPLY = ethers.parseEther("100000");
const AMOUNT = ethers.parseEther("1000");

async function main() {
  const ctx = newRun("token-comparison");
  const [admin, a, b, c, d] = await ethers.getSigners();

  // ---- T0: plain ERC20 ----
  {
    const T0 = await ethers.getContractFactory("T0PlainERC20");
    const token = await T0.deploy(SUPPLY);
    await token.waitForDeployment();
    recordTx(ctx, await token.deploymentTransaction().wait(), { variante: "T0", token: "T0", etapa: "deploy" });
    ctx.manifest.deployments = ctx.manifest.deployments || [];
    ctx.manifest.deployments.push({ token: "T0", supply: SUPPLY.toString(), address: await token.getAddress() });

    // First transfer ever to `a` (cold storage slot) vs a later one to the
    // same already-funded address (warm) — same "first costs more" pattern
    // noted throughout this study.
    await step(ctx, { variante: "T0", token: "T0", etapa: "transfer_first", ordem: 1 },
      () => token.connect(admin).transfer(a.address, AMOUNT));
    await step(ctx, { variante: "T0", token: "T0", etapa: "transfer_subsequent", ordem: 2 },
      () => token.connect(admin).transfer(a.address, AMOUNT));
    console.log("T0: no delegate() function to measure — not applicable, per protocol 3.2.");
  }

  // ---- T1: ERC20Votes, undelegated ----
  {
    const T1 = await ethers.getContractFactory("T1VotesERC20");
    const token = await T1.deploy(SUPPLY);
    await token.waitForDeployment();
    recordTx(ctx, await token.deploymentTransaction().wait(), { variante: "T1-undelegated", token: "T1", etapa: "deploy" });

    await step(ctx, { variante: "T1-undelegated", token: "T1", etapa: "transfer_first", ordem: 1 },
      () => token.connect(admin).transfer(b.address, AMOUNT));
    await step(ctx, { variante: "T1-undelegated", token: "T1", etapa: "transfer_subsequent", ordem: 2 },
      () => token.connect(admin).transfer(b.address, AMOUNT));
  }

  // ---- T1: ERC20Votes, both sides delegated (the realistic governance state) ----
  {
    const T1 = await ethers.getContractFactory("T1VotesERC20");
    const token = await T1.deploy(SUPPLY);
    await token.waitForDeployment();
    recordTx(ctx, await token.deploymentTransaction().wait(), { variante: "T1-delegated", token: "T1", etapa: "deploy" });

    // Delegation gas: self-delegate at zero balance (the pattern used
    // everywhere else in this study — protocol condition 4).
    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "delegate_admin" }, () => token.connect(admin).delegate(admin.address));
    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "delegate_recipient_at_zero_balance" }, () => token.connect(c).delegate(c.address));

    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "transfer_first", ordem: 1 },
      () => token.connect(admin).transfer(c.address, AMOUNT));
    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "transfer_subsequent", ordem: 2 },
      () => token.connect(admin).transfer(c.address, AMOUNT));

    // Delegation gas from an ALREADY-FUNDED balance (re-delegating), as a
    // second data point distinct from the zero-balance case above — moving
    // an existing balance's voting weight is a different-sized checkpoint
    // write than moving zero.
    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "transfer_to_d" }, () => token.connect(admin).transfer(d.address, AMOUNT));
    await step(ctx, { variante: "T1-delegated", token: "T1", etapa: "delegate_from_funded_balance" }, () => token.connect(d).delegate(d.address));
  }

  verifyIntegrity(ctx);
  ctx.manifest.finishedAt = new Date().toISOString();
  require("fs").writeFileSync(require("path").join(ctx.outDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
  console.log(`\nwrote ${ctx.outDir}/ (manifest.json, results.csv, receipts.json, queries.json)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });

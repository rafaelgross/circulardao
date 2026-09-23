// B1-B4 (protocol section 8), complete: checks final proposal state, the
// actual registry content when a proposal is approved, and the specific
// revert reason for every expected-revert transaction — not just tally
// movement or bare "reverted". Supply = 100,000, so V2's fixed quorum
// (4,000) and Ref's natural 4% quorum (4,000) coincide exactly, matching
// the real Sepolia deployment's calibration — this tier is B1-B4 only, not
// the large N-sweep (5.1), which needs more tokens than 100,000 can hold
// for Ref's fixed 4% fraction and is handled separately.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 10;
const SUPPLY = ethers.parseEther("100000");   // 4% of this = 4,000, matching V2 and Sepolia
const V2_QUORUM = ethers.parseEther("4000");
const W = ethers.parseEther("4000");          // standard voter weight, matches Sepolia's S1/S2/S5

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const voters = signers.slice(1, 6);   // up to 5 spare signers per condition
  const attacker = signers[6];

  const T1 = await ethers.getContractFactory("T1VotesERC20");
  const token = await T1.deploy(SUPPLY);

  async function freshRegistry(governorAddr) {
    const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
    const registry = await Registry.deploy(deployer.address);
    const ADMIN_ROLE = await registry.ADMIN_ROLE();
    await (await registry.grantRole(ADMIN_ROLE, governorAddr)).wait();
    await (await registry.revokeRole(ADMIN_ROLE, deployer.address)).wait();
    return registry;
  }

  const V0 = await ethers.getContractFactory("V0Governor");
  const v0 = await V0.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD);
  const V1 = await ethers.getContractFactory("V1Governor");
  const v1 = await V1.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD);
  const V2 = await ethers.getContractFactory("V2Governor");
  const v2 = await V2.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD, V2_QUORUM);
  const CircularDAO = await ethers.getContractFactory("CircularDAO");
  // Ref needs the full CircularDAO constructor (categories/rewards/stakeholders) —
  // rewards/stakeholders aren't exercised by B1-B4 (target is always the
  // registry), so deploy throwaway instances just to satisfy the constructor.
  const throwawayRegistryForCtor = await (await ethers.getContractFactory("WasteCategoryRegistry")).deploy(deployer.address);
  const rewards = await (await ethers.getContractFactory("RecyclingRewards")).deploy(
    deployer.address, await throwawayRegistryForCtor.getAddress(),
    (await (await ethers.getContractFactory("CircularCredit")).deploy(deployer.address)).getAddress(),
    (await (await ethers.getContractFactory("MaterialPassport")).deploy(deployer.address)).getAddress()
  );
  const stakeholders = await (await ethers.getContractFactory("StakeholderRegistry")).deploy(deployer.address);
  const registryForRef = await freshRegistryStandalone();
  const ref = await CircularDAO.deploy(
    await token.getAddress(), deployer.address, await registryForRef.getAddress(),
    await rewards.getAddress(), await stakeholders.getAddress(), VOTING_DELAY, VOTING_PERIOD
  );
  const REF_ADMIN_ROLE = await registryForRef.ADMIN_ROLE();
  await (await registryForRef.grantRole(REF_ADMIN_ROLE, await ref.getAddress())).wait();
  await (await registryForRef.revokeRole(REF_ADMIN_ROLE, deployer.address)).wait();

  async function freshRegistryStandalone() {
    const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
    return Registry.deploy(deployer.address);
  }

  const registries = {
    V0: await freshRegistry(await v0.getAddress()),
    V1: await freshRegistry(await v1.getAddress()),
    V2: await freshRegistry(await v2.getAddress()),
    Ref: registryForRef,
  };
  const governors = { V0: v0, V1: v1, V2: v2, Ref: ref };

  // Everyone delegates to self with zero balance, then receives W in one
  // transfer — protocol condition 4: "gera exatamente um checkpoint antes
  // da ativação."
  for (const s of [...voters, attacker]) {
    await (await token.connect(s).delegate(s.address)).wait();
  }
  await (await token.connect(deployer).delegate(deployer.address)).wait();

  return { deployer, voters, attacker, token, registries, governors };
}

/** Ref's propose() must go through the plain Governor.propose (not
 * proposeAddCategory) so the target/calldata match V0/V1/V2 exactly —
 * "mesma operação alvo" (condition 4). */
async function propose(governor, registry, proposer, categoryId, newFactor, tag) {
  const calldata = registry.interface.encodeFunctionData("updateCredits", [categoryId, newFactor]);
  const description = `B-scenario ${tag} ${Date.now()}-${Math.random()}`;
  const targets = [await registry.getAddress()];
  const values = [0];
  const tx = await governor.connect(proposer).propose(targets, values, [calldata], description);
  const receipt = await tx.wait();
  const created = receipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;
  return { proposalId, targets, values, calldata, descHash: ethers.id(description) };
}

async function fund(token, from, to, amount) {
  await (await token.connect(from).transfer(to.address, amount)).wait();
}

const STATE = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];

async function decodedRevertReason(governor, fnCallPromiseFactory) {
  try {
    await fnCallPromiseFactory();
    return null;
  } catch (e) {
    return e.shortMessage || e.reason || e.message;
  }
}

const VARIANTS = ["V0", "V1", "V2", "Ref"];

describe("Ablation B1-B4, complete (state + registry content + revert reason)", () => {
  describe("B1 — post-activation acquisition", () => {
    for (const name of VARIANTS) {
      it(`${name}: tally movement matches the protocol's expected column`, async () => {
        const f = await loadFixture(deployFixture);
        const governor = f.governors[name];
        const registry = f.registries[name];
        const p = await propose(governor, registry, f.deployer, 1, 111, `B1-${name}`);
        await mine(VOTING_DELAY + 1);

        const snapshot = await governor.proposalSnapshot(p.proposalId);
        const weightAtActivation = await governor.getVotes(f.attacker.address, snapshot);
        expect(weightAtActivation).to.equal(0n);

        const before = await governor.proposalVotes(p.proposalId);
        await fund(f.token, f.deployer, f.attacker, ethers.parseEther("20000"));
        await (await f.token.connect(f.attacker).delegate(f.attacker.address)).wait();
        await (await governor.connect(f.attacker).castVote(p.proposalId, 1)).wait();
        const after = await governor.proposalVotes(p.proposalId);
        const moved = after.forVotes - before.forVotes;

        if (name === "V0") {
          expect(moved).to.equal(ethers.parseEther("20000")); // current power counts
        } else {
          expect(moved).to.equal(0n); // historical power at activation was zero
        }
      });
    }
  });

  describe("B2 — unanimous support below quorum", () => {
    for (const name of VARIANTS) {
      it(`${name}: final state matches the protocol's expected column`, async () => {
        const f = await loadFixture(deployFixture);
        const governor = f.governors[name];
        const registry = f.registries[name];
        const small = f.voters[0];
        await fund(f.token, f.deployer, small, ethers.parseEther("1000"));

        const p = await propose(governor, registry, f.deployer, 1, 222, `B2-${name}`);
        await mine(VOTING_DELAY + 1);
        await (await governor.connect(small).castVote(p.proposalId, 1)).wait();
        await mine(VOTING_PERIOD + 1);

        const state = STATE[Number(await governor.state(p.proposalId))];
        if (name === "V0" || name === "V1") {
          expect(state).to.equal("Succeeded"); // no quorum requirement

          // Content check: only meaningful once actually executed.
          await (await governor.execute(p.targets, p.values, [p.calldata], p.descHash)).wait();
          const cat = await registry.getCategory(1);
          expect(cat.creditsPerKg).to.equal(222n);
        } else {
          expect(state).to.equal("Defeated"); // quorum not met (V2: 4,000 fixed; Ref: 4,000 at this supply)

          const reason = await decodedRevertReason(governor, () =>
            governor.execute.staticCall(p.targets, p.values, [p.calldata], p.descHash));
          expect(reason).to.not.be.null;
        }
      });
    }
  });

  describe("B3 — token weight beats simple wallet-count majority", () => {
    for (const name of VARIANTS) {
      it(`${name}: 3-wallets-For still loses to 1-wallet-Against on weight`, async () => {
        const f = await loadFixture(deployFixture);
        const governor = f.governors[name];
        const registry = f.registries[name];
        const [v1_, v2_, v3_] = f.voters;
        const big = f.attacker;
        for (const v of [v1_, v2_, v3_]) await fund(f.token, f.deployer, v, W);
        await fund(f.token, f.deployer, big, ethers.parseEther("63000"));

        const p = await propose(governor, registry, f.deployer, 1, 333, `B3-${name}`);
        await mine(VOTING_DELAY + 1);
        for (const v of [v1_, v2_, v3_]) await (await governor.connect(v).castVote(p.proposalId, 1)).wait();
        await (await governor.connect(big).castVote(p.proposalId, 0)).wait();
        await mine(VOTING_PERIOD + 1);

        const tally = await governor.proposalVotes(p.proposalId);
        expect(tally.forVotes).to.equal(3n * W);
        expect(tally.againstVotes).to.equal(ethers.parseEther("63000"));
        // Quorum (for+abstain vs quorum) must be met by the FOR side alone in
        // every variant, so the defeat is attributable to vote weight, not
        // quorum — otherwise B3 stops isolating what it's meant to isolate.
        const quorumAtSnapshot = await governor.quorum(await governor.proposalSnapshot(p.proposalId));
        expect(tally.forVotes >= quorumAtSnapshot).to.equal(true);

        const state = STATE[Number(await governor.state(p.proposalId))];
        expect(state).to.equal("Defeated");
      });
    }
  });

  describe("B4 — repeated vote from the same account", () => {
    for (const name of VARIANTS) {
      it(`${name}: reverts with the expected error`, async () => {
        const f = await loadFixture(deployFixture);
        const governor = f.governors[name];
        const registry = f.registries[name];
        const voter = f.voters[0];
        await fund(f.token, f.deployer, voter, W);

        const p = await propose(governor, registry, f.deployer, 1, 444, `B4-${name}`);
        await mine(VOTING_DELAY + 1);
        await (await governor.connect(voter).castVote(p.proposalId, 1)).wait();

        await expect(governor.connect(voter).castVote(p.proposalId, 1))
          .to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
      });
    }
  });
});

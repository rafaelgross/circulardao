// Smoke test for the ablation governors (V0/V1/V2) before building the full
// experiment runner: confirms the ONE mechanism each variant is supposed to
// differ in actually behaves as the protocol describes, on a tiny scale.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 10;
const SUPPLY = ethers.parseEther("400000");
const QUORUM = ethers.parseEther("4000");

async function deployFixture() {
  const [deployer, voter, attacker] = await ethers.getSigners();

  const T1 = await ethers.getContractFactory("T1VotesERC20");
  const token = await T1.deploy(SUPPLY);

  const Registry = await ethers.getContractFactory("WasteCategoryRegistry");
  const registry = await Registry.deploy(deployer.address);

  const V0 = await ethers.getContractFactory("V0Governor");
  const v0 = await V0.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD);
  const V1 = await ethers.getContractFactory("V1Governor");
  const v1 = await V1.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD);
  const V2 = await ethers.getContractFactory("V2Governor");
  const v2 = await V2.deploy(await token.getAddress(), VOTING_DELAY, VOTING_PERIOD, QUORUM);

  const ADMIN_ROLE = await registry.ADMIN_ROLE();
  for (const g of [v0, v1, v2]) {
    await (await registry.grantRole(ADMIN_ROLE, await g.getAddress())).wait();
  }

  await (await token.delegate(deployer.address)).wait();

  return { deployer, voter, attacker, token, registry, v0, v1, v2 };
}

async function propose(governor, registry, deployer, tag) {
  const calldata = registry.interface.encodeFunctionData("updateCredits", [1, 999]);
  const description = `ablation smoke ${tag} ${Date.now()}-${Math.random()}`;
  const tx = await governor.connect(deployer).propose([await registry.getAddress()], [0], [calldata], description);
  const receipt = await tx.wait();
  const created = receipt.logs.map((l) => { try { return governor.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;
  const snapshot = await governor.proposalSnapshot(proposalId);
  return { proposalId, snapshot, calldata, descHash: ethers.id(description) };
}

describe("Ablation governors — mechanism smoke test", () => {
  it("V0 counts a late (post-snapshot) acquisition; V1 does not (B1's premise, at unit scale)", async () => {
    const f = await loadFixture(deployFixture);

    // Late-acquisition wallet starts at zero on both governors' tokens (same token).
    for (const gov of [f.v0, f.v1]) {
      const { proposalId, snapshot, calldata, descHash } = await propose(gov, f.registry, f.deployer, gov === f.v0 ? "V0" : "V1");
      await mine(VOTING_DELAY + 1);

      const weightAtSnapshotBefore = await gov.getVotes(f.attacker.address, snapshot);
      expect(weightAtSnapshotBefore).to.equal(0n);

      // Acquire AFTER the snapshot/activation.
      await (await f.token.connect(f.deployer).transfer(f.attacker.address, QUORUM)).wait();
      await (await f.token.connect(f.attacker).delegate(f.attacker.address)).wait();

      await (await gov.connect(f.attacker).castVote(proposalId, 1)).wait();
      const tally = await gov.proposalVotes(proposalId);

      if (gov === f.v0) {
        // V0 reads CURRENT power at vote time — the late acquisition counts.
        expect(tally.forVotes).to.equal(QUORUM);
      } else {
        // V1 reads HISTORICAL power at the snapshot — it does not.
        expect(tally.forVotes).to.equal(0n);
      }

      // Reset attacker's balance/delegation for the next governor's turn.
      await (await f.token.connect(f.attacker).transfer(f.deployer.address, QUORUM)).wait();
    }
  });

  it("V2 enforces its fixed quorum; V1 does not (B2's premise)", async () => {
    const f = await loadFixture(deployFixture);
    const small = f.voter;
    await (await f.token.connect(f.deployer).transfer(small.address, ethers.parseEther("1000"))).wait();
    await (await f.token.connect(small).delegate(small.address)).wait();

    for (const gov of [f.v1, f.v2]) {
      const { proposalId } = await propose(gov, f.registry, f.deployer, gov === f.v1 ? "V1" : "V2");
      await mine(VOTING_DELAY + 1);
      await (await gov.connect(small).castVote(proposalId, 1)).wait();
      await mine(VOTING_PERIOD + 1);
      const state = Number(await gov.state(proposalId));
      const STATE = ["Pending", "Active", "Canceled", "Defeated", "Succeeded"];
      if (gov === f.v1) {
        expect(STATE[state]).to.equal("Succeeded"); // no quorum requirement
      } else {
        expect(STATE[state]).to.equal("Defeated"); // 1000 < fixed 4000 quorum
      }
    }
  });

  it("V0/V1/V2 all reject a repeated vote from the same account (B4's premise)", async () => {
    const f = await loadFixture(deployFixture);
    for (const gov of [f.v0, f.v1, f.v2]) {
      const { proposalId } = await propose(gov, f.registry, f.deployer, "repeat");
      await mine(VOTING_DELAY + 1);
      await (await gov.connect(f.deployer).castVote(proposalId, 1)).wait();
      await expect(gov.connect(f.deployer).castVote(proposalId, 1))
        .to.be.revertedWithCustomError(gov, "GovernorAlreadyCastVote");
    }
  });
});

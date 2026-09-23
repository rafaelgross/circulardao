// Acceptance tests for the C1-C7 security fixes (see the correction roadmap).
// Each test targets a specific defect and is written to fail on the
// pre-fix code and pass after it. Local Hardhat network only.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  impersonateAccount,
  setBalance,
} = require("@nomicfoundation/hardhat-network-helpers");

const VOTING_DELAY = 1;
const VOTING_PERIOD = 5; // blocks — short on purpose, this is a local-network test
const EWASTE_GENERAL_ID = 3; // pre-registered in WasteCategoryRegistry's constructor, 25 CRC/kg

async function deployFixture() {
  const [deployer, alice, bob, carol, dave, erin] = await ethers.getSigners();

  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const govToken = await GovernanceToken.deploy(deployer.address);

  const StakeholderRegistry = await ethers.getContractFactory("StakeholderRegistry");
  const stakeholders = await StakeholderRegistry.deploy(deployer.address);

  const WasteCategoryRegistry = await ethers.getContractFactory("WasteCategoryRegistry");
  const categories = await WasteCategoryRegistry.deploy(deployer.address);

  const MaterialPassport = await ethers.getContractFactory("MaterialPassport");
  const passport = await MaterialPassport.deploy(deployer.address);

  const CircularCredit = await ethers.getContractFactory("CircularCredit");
  const credit = await CircularCredit.deploy(deployer.address);

  const RecyclingRewards = await ethers.getContractFactory("RecyclingRewards");
  const rewards = await RecyclingRewards.deploy(
    deployer.address, await categories.getAddress(), await credit.getAddress(), await passport.getAddress()
  );

  const WasteTracker = await ethers.getContractFactory("WasteTracker");
  const tracker = await WasteTracker.deploy(
    deployer.address, await categories.getAddress(), await passport.getAddress(), await rewards.getAddress()
  );

  const CircularDAO = await ethers.getContractFactory("CircularDAO");
  const dao = await CircularDAO.deploy(
    await govToken.getAddress(), deployer.address,
    await categories.getAddress(), await rewards.getAddress(), await stakeholders.getAddress(),
    VOTING_DELAY, VOTING_PERIOD
  );
  const daoAddr = await dao.getAddress();

  // ─── Wiring, mirroring scripts/deploy-all.js ────────────────────────
  await (await credit.grantRole(await credit.MINTER_ROLE(), await rewards.getAddress())).wait();
  await (await passport.grantRole(await passport.OPERATOR_ROLE(), await tracker.getAddress())).wait();
  await (await passport.grantRole(await passport.MINTER_ROLE(), deployer.address)).wait();
  await (await rewards.grantRole(await rewards.TRACKER_ROLE(), await tracker.getAddress())).wait();

  const CATEGORIES_ADMIN_ROLE = await categories.ADMIN_ROLE();
  await (await categories.grantRole(CATEGORIES_ADMIN_ROLE, daoAddr)).wait();
  const REWARDS_ADMIN_ROLE = await rewards.ADMIN_ROLE();
  await (await rewards.grantRole(REWARDS_ADMIN_ROLE, daoAddr)).wait();
  const STAKEHOLDERS_ADMIN_ROLE = await stakeholders.ADMIN_ROLE();
  await (await stakeholders.grantRole(STAKEHOLDERS_ADMIN_ROLE, daoAddr)).wait();
  const CREDIT_ADMIN_ROLE = await credit.ADMIN_ROLE();
  await (await credit.grantRole(CREDIT_ADMIN_ROLE, daoAddr)).wait();

  await (await categories.revokeRole(CATEGORIES_ADMIN_ROLE, deployer.address)).wait();
  await (await rewards.revokeRole(REWARDS_ADMIN_ROLE, deployer.address)).wait();
  await (await stakeholders.revokeRole(STAKEHOLDERS_ADMIN_ROLE, deployer.address)).wait();
  await (await credit.revokeRole(CREDIT_ADMIN_ROLE, deployer.address)).wait();

  await (await govToken.delegate(deployer.address)).wait();

  return { deployer, alice, bob, carol, dave, erin, govToken, stakeholders, categories, passport, credit, rewards, tracker, dao };
}

/** Proposes targets/values/calldatas through the plain Governor.propose(), votes it
 * through with `deployer` (holds the whole 100k DAOG supply, self-delegated), and
 * executes once the voting window closes. Returns the proposalId. */
async function proposeVoteExecute(dao, deployer, targets, values, calldatas, description) {
  const tx = await dao.connect(deployer).propose(targets, values, calldatas, description);
  const receipt = await tx.wait();
  const created = receipt.logs.map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");
  const proposalId = created.args.proposalId;

  await mine(VOTING_DELAY + 1);
  await (await dao.connect(deployer).castVote(proposalId, 1)).wait(); // For
  await mine(VOTING_PERIOD + 1);
  await (await dao.connect(deployer).execute(targets, values, calldatas, ethers.id(description))).wait();
  return proposalId;
}

/** Mints a passport and returns its tokenId. */
async function mintPassport(passport, deployer, recipient, overrides = {}) {
  const params = {
    recipient: recipient.address,
    externalProductId: overrides.externalProductId ?? `PROD-${Date.now()}-${Math.random()}`,
    externalDataHash: ethers.ZeroHash,
    externalDataURI: "",
    categoryId: overrides.categoryId ?? EWASTE_GENERAL_ID,
    categoryCode: ethers.id("EWASTE_GENERAL"),
    weightKg: overrides.weightGrams ?? 3800, // grams, despite the struct field's name
    composition: "",
    originLocation: "",
    isLot: false,
    quantity: 1,
  };
  const tx = await passport.connect(deployer).mint(params);
  const receipt = await tx.wait();
  const minted = receipt.logs.map((l) => { try { return passport.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "PassportMinted");
  return { tokenId: minted.args.tokenId, externalProductId: params.externalProductId };
}

/** Walks a freshly minted passport all the way to PROCESSING, using freshly
 * granted collector/recycler roles on the tracker. Returns the tokenId. */
async function walkToProcessing(f, { collector, recycler }) {
  await (await f.tracker.grantRole(await f.tracker.COLLECTOR_ROLE(), collector.address)).wait();
  await (await f.tracker.grantRole(await f.tracker.RECYCLER_ROLE(), recycler.address)).wait();
  await (await f.tracker.grantRole(await f.tracker.OPERATOR_ROLE(), f.deployer.address)).wait();

  const { tokenId } = await mintPassport(f.passport, f.deployer, collector);
  await (await f.tracker.connect(collector).registerCollection(tokenId, "SP", "")).wait();
  await (await f.tracker.connect(f.deployer).registerTriagem(tokenId, "SP", "")).wait(); // COLLECTED -> TRIAGED shortcut
  await (await f.tracker.connect(recycler).registerProcessing(tokenId, "")).wait();
  return tokenId;
}

describe("C1 — DAO exclusive authority", () => {
  it("deployer can no longer alter a WasteCategoryRegistry parameter directly", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.categories.connect(f.deployer).updateCredits(EWASTE_GENERAL_ID, 99))
      .to.be.revertedWithCustomError(f.categories, "AccessControlUnauthorizedAccount");
  });

  it("deployer cannot re-grant themselves the revoked role", async () => {
    const f = await loadFixture(deployFixture);
    const ADMIN_ROLE = await f.categories.ADMIN_ROLE();
    await expect(f.categories.connect(f.deployer).grantRole(ADMIN_ROLE, f.deployer.address))
      .to.be.revertedWithCustomError(f.categories, "AccessControlUnauthorizedAccount");
  });

  it("an executed DAO proposal can still alter the same parameter", async () => {
    const f = await loadFixture(deployFixture);
    await proposeVoteExecute(
      f.dao, f.deployer,
      [await f.categories.getAddress()], [0],
      [f.categories.interface.encodeFunctionData("updateCredits", [EWASTE_GENERAL_ID, 99])],
      `C1 categories - ${Date.now()}`
    );
    expect((await f.categories.getCategory(EWASTE_GENERAL_ID)).creditsPerKg).to.equal(99n);
  });

  it("RecyclingRewards: same pattern (deployer locked out, DAO proposal succeeds)", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.rewards.connect(f.deployer).setBonusMultiplier(15000))
      .to.be.revertedWithCustomError(f.rewards, "AccessControlUnauthorizedAccount");

    await proposeVoteExecute(
      f.dao, f.deployer,
      [await f.rewards.getAddress()], [0],
      [f.rewards.interface.encodeFunctionData("setBonusMultiplier", [15000])],
      `C1 rewards - ${Date.now()}`
    );
    expect(await f.rewards.bonusMultiplierBp()).to.equal(15000n);
  });

  it("StakeholderRegistry: same pattern (deployer locked out, DAO proposal succeeds)", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.stakeholders.connect(f.deployer).grantValidatorRole(f.alice.address))
      .to.be.revertedWithCustomError(f.stakeholders, "AccessControlUnauthorizedAccount");

    await proposeVoteExecute(
      f.dao, f.deployer,
      [await f.stakeholders.getAddress()], [0],
      [f.stakeholders.interface.encodeFunctionData("grantValidatorRole", [f.alice.address])],
      `C1 stakeholders - ${Date.now()}`
    );
    expect(await f.stakeholders.hasRole(await f.stakeholders.VALIDATOR_ROLE(), f.alice.address)).to.equal(true);
  });
});

describe("C2 — WasteTracker authorization by actor role", () => {
  it("an address with no role cannot call registerCollection", async () => {
    const f = await loadFixture(deployFixture);
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice);
    await expect(f.tracker.connect(f.alice).registerCollection(tokenId, "SP", ""))
      .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount");
  });

  it("an address with the collector role can call registerCollection", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.tracker.grantRole(await f.tracker.COLLECTOR_ROLE(), f.alice.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice);
    await expect(f.tracker.connect(f.alice).registerCollection(tokenId, "SP", "")).to.not.be.reverted;
  });

  it("a collector cannot register the transition to recycled", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.tracker.grantRole(await f.tracker.COLLECTOR_ROLE(), f.alice.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice);
    await (await f.tracker.connect(f.alice).registerCollection(tokenId, "SP", "")).wait();
    await expect(f.tracker.connect(f.alice).registerRecycled(tokenId, 3800, ""))
      .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount");
  });

  it("a recycler registers the transition to recycled successfully", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await expect(f.tracker.connect(f.bob).registerRecycled(tokenId, 3800, "")).to.not.be.reverted;
  });
});

describe("C3 — WasteTracker to RecyclingRewards integration", () => {
  it("recycling a 3.8kg lot at 25 CRC/kg credits exactly 95.00 CRC before bonus", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await (await f.tracker.connect(f.bob).registerRecycled(tokenId, 3800, "")).wait();
    expect(await f.credit.balanceOf(f.bob.address)).to.equal(9500n); // 95.00 CRC, 2 decimals
  });

  it("calling registerRecycled again on the same lot does not pay out a second time", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await (await f.tracker.connect(f.bob).registerRecycled(tokenId, 3800, "")).wait();
    await expect(f.tracker.connect(f.bob).registerRecycled(tokenId, 3800, "")).to.be.reverted;
    expect(await f.credit.balanceOf(f.bob.address)).to.equal(9500n);
  });

  it("issuing a reward for a lot that never reached RECYCLED reverts", async () => {
    const f = await loadFixture(deployFixture);
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice); // status REGISTERED

    // Call RecyclingRewards.issueReward directly, as only the tracker contract
    // (holder of TRACKER_ROLE) is allowed to — impersonate it to reach the
    // guard directly rather than through WasteTracker's own state check.
    const trackerAddr = await f.tracker.getAddress();
    await impersonateAccount(trackerAddr);
    await setBalance(trackerAddr, ethers.parseEther("1"));
    const trackerSigner = await ethers.getSigner(trackerAddr);

    await expect(f.rewards.connect(trackerSigner).issueReward(tokenId, f.alice.address, 3800))
      .to.be.revertedWith("Rewards: passaporte precisa estar RECYCLED");
  });
});

describe("C4 — weight unit (grams canonical, kg-rate pricing)", () => {
  it("a non-round weight (3.75kg) yields the exact expected credits", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await (await f.tracker.connect(f.bob).registerRecycled(tokenId, 3750, "")).wait(); // 3.75 kg
    expect(await f.credit.balanceOf(f.bob.address)).to.equal(9375n); // 93.75 CRC
  });

  it("documents floor rounding when the division is not exact", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await (await f.tracker.connect(f.bob).registerRecycled(tokenId, 3751, "")).wait(); // 3.751 kg
    // (3751 * 25 * 100) / 1000 = 9377.5 -> floors to 9377, never rounds up.
    expect(await f.credit.balanceOf(f.bob.address)).to.equal(9377n);
  });

  it("zero weight is rejected rather than silently minting zero credits", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await expect(f.tracker.connect(f.bob).registerRecycled(tokenId, 0, ""))
      .to.be.revertedWith("Rewards: peso invalido");
  });

  it("applies a bonus without double-rounding (single division, not weight/1000 then *bonus/10000)", async () => {
    const f = await loadFixture(deployFixture);
    await proposeVoteExecute(
      f.dao, f.deployer,
      [await f.rewards.getAddress()], [0],
      [f.rewards.interface.encodeFunctionData("setBonusMultiplier", [12000])], // 1.2x
      `C4 bonus - ${Date.now()}`
    );
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await (await f.tracker.connect(f.bob).registerRecycled(tokenId, 3751, "")).wait(); // 3.751 kg
    // (3751 * 25 * 100 * 12000) / (1000 * 10000) = 11253 exactly. The old
    // two-step form floored 3751g to 9377 credits first, then applied the
    // bonus to that already-truncated number, landing on 11252 instead.
    expect(await f.credit.balanceOf(f.bob.address)).to.equal(11253n);
  });

  it("an unrepresentable weight overflows and reverts instead of wrapping", async () => {
    const f = await loadFixture(deployFixture);
    const tokenId = await walkToProcessing(f, { collector: f.alice, recycler: f.bob });
    await expect(f.tracker.connect(f.bob).registerRecycled(tokenId, ethers.MaxUint256, ""))
      .to.be.reverted; // Solidity 0.8 checked-arithmetic panic
  });
});

describe("C5 — external id uniqueness", () => {
  it("minting twice with the same externalProductId reverts the second time", async () => {
    const f = await loadFixture(deployFixture);
    const extId = `DUP-${Date.now()}`;
    const { tokenId: firstId } = await mintPassport(f.passport, f.deployer, f.alice, { externalProductId: extId });

    await expect(mintPassport(f.passport, f.deployer, f.bob, { externalProductId: extId }))
      .to.be.revertedWith("Passport: externalProductId ja registrado");

    const stillFirst = await f.passport.getByExternalId(extId);
    expect(stillFirst.tokenId).to.equal(firstId);
    expect(stillFirst.currentHolder).to.equal(f.alice.address);
  });
});

describe("C6 — status progression, including the privileged direct path", () => {
  it("updateStatus rejects a skip-ahead transition", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.passport.grantRole(await f.passport.OPERATOR_ROLE(), f.deployer.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice); // REGISTERED = 0
    await expect(f.passport.connect(f.deployer).updateStatus(tokenId, 5, "")) // RECYCLED
      .to.be.revertedWith("Passport: transicao de estado invalida");
  });

  it("updateStatus rejects going back to a previous state", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.passport.grantRole(await f.passport.OPERATOR_ROLE(), f.deployer.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice);
    await (await f.passport.connect(f.deployer).updateStatus(tokenId, 1, "")).wait(); // -> COLLECTED
    await expect(f.passport.connect(f.deployer).updateStatus(tokenId, 0, "")) // -> REGISTERED
      .to.be.revertedWith("Passport: transicao de estado invalida");
  });

  it("updateStatus rejects repeating the same state", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.passport.grantRole(await f.passport.OPERATOR_ROLE(), f.deployer.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice);
    await (await f.passport.connect(f.deployer).updateStatus(tokenId, 1, "")).wait();
    await expect(f.passport.connect(f.deployer).updateStatus(tokenId, 1, ""))
      .to.be.revertedWith("Passport: transicao de estado invalida");
  });

  it("the same three rules hold through WasteTracker's own indirect calls", async () => {
    const f = await loadFixture(deployFixture);
    await (await f.tracker.grantRole(await f.tracker.RECYCLER_ROLE(), f.bob.address)).wait();
    const { tokenId } = await mintPassport(f.passport, f.deployer, f.alice); // REGISTERED, no collector role granted

    // Skip-ahead: try to go straight to processing/recycled without collection.
    await expect(f.tracker.connect(f.bob).registerProcessing(tokenId, ""))
      .to.be.revertedWith("Tracker: precisa estar triado");
    await expect(f.tracker.connect(f.bob).registerRecycled(tokenId, 3800, ""))
      .to.be.revertedWith("Tracker: precisa estar em processamento");
  });
});

describe("C7 — CircularCredit minter-role governance", () => {
  it("deployer can no longer grant MINTER_ROLE directly", async () => {
    const f = await loadFixture(deployFixture);
    const MINTER_ROLE = await f.credit.MINTER_ROLE();
    await expect(f.credit.connect(f.deployer).grantRole(MINTER_ROLE, f.alice.address))
      .to.be.revertedWithCustomError(f.credit, "AccessControlUnauthorizedAccount");
  });

  it("the DAO, through an executed proposal, can grant MINTER_ROLE", async () => {
    const f = await loadFixture(deployFixture);
    const MINTER_ROLE = await f.credit.MINTER_ROLE();

    await proposeVoteExecute(
      f.dao, f.deployer,
      [await f.credit.getAddress()], [0],
      [f.credit.interface.encodeFunctionData("grantRole", [MINTER_ROLE, f.alice.address])],
      `C7 minter - ${Date.now()}`
    );

    expect(await f.credit.hasRole(MINTER_ROLE, f.alice.address)).to.equal(true);
  });
});

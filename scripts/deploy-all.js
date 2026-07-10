// scripts/deploy-all.js
// Deploy completo do sistema DAO Circular — em ordem de dependência
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("=== CircularDAO Deploy ===");
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  // ─── 1. GovernanceToken (DAOG) ───────────────────────────────────
  console.log("1/7 Deployando GovernanceToken (DAOG)...");
  const GovernanceToken = await hre.ethers.getContractFactory("GovernanceToken");
  const govToken = await GovernanceToken.deploy(deployer.address);
  await govToken.waitForDeployment();
  const govTokenAddr = await govToken.getAddress();
  console.log("   DAOG:", govTokenAddr);

  // ─── 2. StakeholderRegistry ──────────────────────────────────────
  console.log("2/7 Deployando StakeholderRegistry...");
  const StakeholderRegistry = await hre.ethers.getContractFactory("StakeholderRegistry");
  const stakeholders = await StakeholderRegistry.deploy(deployer.address);
  await stakeholders.waitForDeployment();
  const stakeholdersAddr = await stakeholders.getAddress();
  console.log("   StakeholderRegistry:", stakeholdersAddr);

  // ─── 3. WasteCategoryRegistry ────────────────────────────────────
  console.log("3/7 Deployando WasteCategoryRegistry...");
  const WasteCategoryRegistry = await hre.ethers.getContractFactory("WasteCategoryRegistry");
  const categories = await WasteCategoryRegistry.deploy(deployer.address);
  await categories.waitForDeployment();
  const categoriesAddr = await categories.getAddress();
  console.log("   WasteCategoryRegistry:", categoriesAddr);

  // ─── 4. MaterialPassport (ERC-1155) ──────────────────────────────
  console.log("4/7 Deployando MaterialPassport...");
  const MaterialPassport = await hre.ethers.getContractFactory("MaterialPassport");
  const passport = await MaterialPassport.deploy(deployer.address);
  await passport.waitForDeployment();
  const passportAddr = await passport.getAddress();
  console.log("   MaterialPassport:", passportAddr);

  // ─── 5. CircularCredit (ERC-20 CRC) ─────────────────────────────
  console.log("5/7 Deployando CircularCredit (CRC)...");
  const CircularCredit = await hre.ethers.getContractFactory("CircularCredit");
  const credit = await CircularCredit.deploy(deployer.address);
  await credit.waitForDeployment();
  const creditAddr = await credit.getAddress();
  console.log("   CircularCredit:", creditAddr);

  // ─── 6. RecyclingRewards ─────────────────────────────────────────
  console.log("6/7 Deployando RecyclingRewards...");
  const RecyclingRewards = await hre.ethers.getContractFactory("RecyclingRewards");
  const rewards = await RecyclingRewards.deploy(deployer.address, categoriesAddr, creditAddr, passportAddr);
  await rewards.waitForDeployment();
  const rewardsAddr = await rewards.getAddress();
  console.log("   RecyclingRewards:", rewardsAddr);

  // ─── 7. WasteTracker ─────────────────────────────────────────────
  console.log("7/7 Deployando WasteTracker...");
  const WasteTracker = await hre.ethers.getContractFactory("WasteTracker");
  const tracker = await WasteTracker.deploy(deployer.address, categoriesAddr, passportAddr);
  await tracker.waitForDeployment();
  const trackerAddr = await tracker.getAddress();
  console.log("   WasteTracker:", trackerAddr);

  // ─── 8. CircularDAO ──────────────────────────────────────────────
  console.log("\n8/8 Deployando CircularDAO...");
  const CircularDAO = await hre.ethers.getContractFactory("CircularDAO");
  // Parâmetros de governança: produção = 1 bloco de delay, 50400 blocos (~7 dias) de votação.
  // Para experimentos em testnet, sobrescrever via VOTING_DELAY / VOTING_PERIOD.
  const votingDelay  = process.env.VOTING_DELAY  || 1;
  const votingPeriod = process.env.VOTING_PERIOD || 50400;
  console.log(`   votingDelay=${votingDelay} votingPeriod=${votingPeriod} blocos`);
  const dao = await CircularDAO.deploy(
    govTokenAddr,
    deployer.address,
    categoriesAddr,
    rewardsAddr,
    stakeholdersAddr,
    votingDelay,
    votingPeriod
  );
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("   CircularDAO:", daoAddr);

  // ─── Concessão de Roles ───────────────────────────────────────────
  console.log("\n=== Configurando Roles ===");

  // CircularCredit: MINTER_ROLE → RecyclingRewards
  const MINTER_ROLE = await credit.MINTER_ROLE();
  await (await credit.grantRole(MINTER_ROLE, rewardsAddr)).wait();
  console.log("CRC.MINTER_ROLE → RecyclingRewards ✓");

  // MaterialPassport: OPERATOR_ROLE → WasteTracker
  const PASSPORT_OPERATOR_ROLE = await passport.OPERATOR_ROLE();
  await (await passport.grantRole(PASSPORT_OPERATOR_ROLE, trackerAddr)).wait();
  console.log("MaterialPassport.OPERATOR_ROLE → WasteTracker ✓");

  // MaterialPassport: MINTER_ROLE → deployer (bootstrap / integração inicial)
  const PASSPORT_MINTER_ROLE = await passport.MINTER_ROLE();
  await (await passport.grantRole(PASSPORT_MINTER_ROLE, deployer.address)).wait();
  console.log("MaterialPassport.MINTER_ROLE → Deployer ✓");

  // RecyclingRewards: TRACKER_ROLE → WasteTracker
  const TRACKER_ROLE = await rewards.TRACKER_ROLE();
  await (await rewards.grantRole(TRACKER_ROLE, trackerAddr)).wait();
  console.log("RecyclingRewards.TRACKER_ROLE → WasteTracker ✓");

  // CircularDAO recebe privilégios administrativos para executar propostas aprovadas
  const CATEGORIES_ADMIN_ROLE = await categories.ADMIN_ROLE();
  await (await categories.grantRole(CATEGORIES_ADMIN_ROLE, daoAddr)).wait();
  console.log("WasteCategoryRegistry.ADMIN_ROLE → CircularDAO ✓");

  const REWARDS_ADMIN_ROLE = await rewards.ADMIN_ROLE();
  await (await rewards.grantRole(REWARDS_ADMIN_ROLE, daoAddr)).wait();
  console.log("RecyclingRewards.ADMIN_ROLE → CircularDAO ✓");

  const STAKEHOLDERS_ADMIN_ROLE = await stakeholders.ADMIN_ROLE();
  await (await stakeholders.grantRole(STAKEHOLDERS_ADMIN_ROLE, daoAddr)).wait();
  console.log("StakeholderRegistry.ADMIN_ROLE → CircularDAO ✓");

  // ─── Delegação de Votos ───────────────────────────────────────────
  // O deployer delega os 100k tokens bootstrap para si mesmo (habilita votação)
  await (await govToken.delegate(deployer.address)).wait();
  console.log("GovernanceToken: votos delegados ao deployer ✓");

  // ─── Resumo ───────────────────────────────────────────────────────
  console.log("\n=== Deploy Completo ===");
  const addresses = {
    network:              hre.network.name,
    deployer:             deployer.address,
    GovernanceToken_DAOG: govTokenAddr,
    StakeholderRegistry:  stakeholdersAddr,
    WasteCategoryRegistry: categoriesAddr,
    MaterialPassport:     passportAddr,
    CircularCredit_CRC:   creditAddr,
    RecyclingRewards:     rewardsAddr,
    WasteTracker:         trackerAddr,
    CircularDAO:          daoAddr,
    deployedAt:           new Date().toISOString()
  };
  console.log(JSON.stringify(addresses, null, 2));

  // Salva em arquivo para uso nos scripts de integração
  const fs = require("fs");
  const outFile = `./deployments/${hre.network.name}.json`;
  if (!fs.existsSync("./deployments")) fs.mkdirSync("./deployments");
  fs.writeFileSync(outFile, JSON.stringify(addresses, null, 2));
  console.log(`\nEndereços salvos em ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

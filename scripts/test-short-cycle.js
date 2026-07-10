// Teste do ciclo de governança com votingPeriod parametrizado (rede hardhat efêmera)
// Uso: VOTING_PERIOD=10 npx hardhat run scripts/test-short-cycle.js --network hardhat
const hre = require("hardhat");

async function main() {
  const [deployer, voter2, voter3] = await hre.ethers.getSigners();
  const mine = (n) => hre.network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);

  // Deploy mínimo: token + registries + DAO com período curto
  const gov = await (await hre.ethers.getContractFactory("GovernanceToken")).deploy(deployer.address);
  const stakeholders = await (await hre.ethers.getContractFactory("StakeholderRegistry")).deploy(deployer.address);
  const categories = await (await hre.ethers.getContractFactory("WasteCategoryRegistry")).deploy(deployer.address);
  const passport = await (await hre.ethers.getContractFactory("MaterialPassport")).deploy(deployer.address);
  const credit = await (await hre.ethers.getContractFactory("CircularCredit")).deploy(deployer.address);
  const rewards = await (await hre.ethers.getContractFactory("RecyclingRewards")).deploy(
    deployer.address, await categories.getAddress(), await credit.getAddress(), await passport.getAddress());

  const VOTING_DELAY = 1, VOTING_PERIOD = 10;
  const dao = await (await hre.ethers.getContractFactory("CircularDAO")).deploy(
    await gov.getAddress(), deployer.address, await categories.getAddress(),
    await rewards.getAddress(), await stakeholders.getAddress(),
    VOTING_DELAY, VOTING_PERIOD);
  console.log("Deploy ok. votingDelay:", String(await dao.votingDelay()),
              "votingPeriod:", String(await dao.votingPeriod()));

  await (await categories.grantRole(await categories.ADMIN_ROLE(), await dao.getAddress())).wait();

  // Distribuição e delegação (3 votantes: 60k / 20k / 20k)
  await (await gov.transfer(voter2.address, hre.ethers.parseEther("20000"))).wait();
  await (await gov.transfer(voter3.address, hre.ethers.parseEther("20000"))).wait();
  await (await gov.delegate(deployer.address)).wait();
  await (await gov.connect(voter2).delegate(voter2.address)).wait();
  await (await gov.connect(voter3).delegate(voter3.address)).wait();

  // Proposta
  const tx = await dao.proposeAddCategory(
    "ELE", "Eletrônico", "#4a90d9", 25n, 2, "Decreto 10.240/2020",
    'Cadastrar categoria "Eletrônico" a 25 CRC/kg',
    "Categoria para resíduos eletroeletrônicos conforme logística reversa obrigatória.");
  await tx.wait();
  const id = await dao.allProposalIds(0);
  console.log("Proposta criada, estado:", String(await dao.state(id)));

  await mine(VOTING_DELAY + 1);
  console.log("Após delay, estado:", String(await dao.state(id)), "(1=Active)");

  await (await dao.castVote(id, 1)).wait();
  await (await dao.connect(voter2).castVote(id, 1)).wait();
  await (await dao.connect(voter3).castVote(id, 0)).wait();
  const votes = await dao.proposalVotes(id);
  console.log("Votos — contra:", hre.ethers.formatEther(votes[0]),
              "a favor:", hre.ethers.formatEther(votes[1]),
              "abstenção:", hre.ethers.formatEther(votes[2]));

  await mine(VOTING_PERIOD + 1);
  console.log("Após período, estado:", String(await dao.state(id)), "(4=Succeeded)");

  // Execução — reconstrói os calldata a partir do evento ProposalCreated
  const evs = await dao.queryFilter(dao.filters.ProposalCreated(), 0);
  const a = evs.find(e => e.args[0].toString() === id.toString()).args;
  const descHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(a[8]));
  await (await dao.execute([...a[2]], [...a[3]], [...a[5]], descHash)).wait();
  console.log("Executada, estado final:", String(await dao.state(id)), "(7=Executed)");

  const cats = await categories.getAllCategories();
  console.log("Categorias após execução:", cats.length, "— TESTE OK");
}

main().catch(e => { console.error("ERRO:", e.shortMessage || e.message); process.exit(1); });

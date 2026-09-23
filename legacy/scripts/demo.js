const { ethers } = require("hardhat");

async function main() {
  const [owner, membro1, membro2, membro3] = await ethers.getSigners();

  console.log("============================================");
  console.log("   DEMONSTRAÇÃO DA DAO - TESE");
  console.log("============================================\n");

  // 1. Deploy
  console.log("1️⃣  FAZENDO DEPLOY DO CONTRATO...");
  const DAO = await ethers.getContractFactory("DAO");
  const dao = await DAO.deploy();
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log(`   Endereço do contrato: ${daoAddr}`);
  console.log(`   Owner/Deployer:       ${owner.address}\n`);

  // 2. Adicionar membros
  console.log("2️⃣  ADICIONANDO MEMBROS À DAO...");
  await dao.connect(owner).addMember(membro1.address);
  await dao.connect(owner).addMember(membro2.address);
  await dao.connect(owner).addMember(membro3.address);
  const total = await dao.memberCount();
  console.log(`   Membro 1: ${membro1.address}`);
  console.log(`   Membro 2: ${membro2.address}`);
  console.log(`   Membro 3: ${membro3.address}`);
  console.log(`   Total de membros: ${total}\n`);

  // 3. Criar proposta
  console.log("3️⃣  CRIANDO UMA PROPOSTA...");
  const tx = await dao.connect(membro1).createProposal(
    "Alocar 50 ETH para pesquisa de contratos inteligentes em governança descentralizada"
  );
  await tx.wait();
  const proposta = await dao.getProposal(0);
  console.log(`   Proposta ID:    ${proposta.id}`);
  console.log(`   Descrição:      ${proposta.description}`);
  console.log(`   Proponente:     ${proposta.proposer}`);
  const deadline = new Date(Number(proposta.deadline) * 1000);
  console.log(`   Prazo:          ${deadline.toLocaleString("pt-BR")}\n`);

  // 4. Votação
  console.log("4️⃣  MEMBROS VOTANDO NA PROPOSTA...");
  await dao.connect(owner).vote(0, true);    // owner: SIM
  await dao.connect(membro1).vote(0, true);  // membro1: SIM
  await dao.connect(membro2).vote(0, false); // membro2: NÃO
  await dao.connect(membro3).vote(0, true);  // membro3: SIM

  const depois = await dao.getProposal(0);
  console.log(`   ✅ Votos A FAVOR:   ${depois.voteFor}`);
  console.log(`   ❌ Votos CONTRA:    ${depois.voteAgainst}\n`);

  // 5. Avançar o tempo (simular fim do prazo de votação)
  console.log("5️⃣  SIMULANDO PASSAGEM DE 3 DIAS (fim da votação)...");
  await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
  await ethers.provider.send("evm_mine", []);
  console.log("   Tempo avançado! Votação encerrada.\n");

  // 6. Executar proposta
  console.log("6️⃣  EXECUTANDO A PROPOSTA...");
  await dao.connect(owner).executeProposal(0);
  const final = await dao.getProposal(0);
  console.log(`   Executada: ${final.executed}`);
  console.log(`   Aprovada:  ${final.passed}`);
  console.log(`   Resultado: ${final.passed ? "✅ PROPOSTA APROVADA!" : "❌ Proposta rejeitada"}\n`);

  // 7. Saldo das carteiras
  console.log("7️⃣  SALDO DAS CARTEIRAS (ETH)...");
  for (const [label, signer] of [["Owner", owner], ["Membro1", membro1], ["Membro2", membro2]]) {
    const bal = await ethers.provider.getBalance(signer.address);
    console.log(`   ${label}: ${parseFloat(ethers.formatEther(bal)).toFixed(4)} ETH`);
  }

  console.log("\n============================================");
  console.log("   DEMO CONCLUÍDA COM SUCESSO! ✅");
  console.log("============================================");
}

main().catch((e) => { console.error(e); process.exit(1); });

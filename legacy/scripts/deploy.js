const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DAO com a conta:", deployer.address);

  const DAO = await ethers.getContractFactory("DAO");
  const dao = await DAO.deploy();
  await dao.waitForDeployment();

  const address = await dao.getAddress();
  console.log("DAO deployada em:", address);
}

main().catch((e) => { console.error(e); process.exit(1); });

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const deploymentsPath = path.join(root, "deployments", "localhost.json");
const outPath = path.join(root, "dao-ui", "contracts.json");
const publicHost = process.env.PUBLIC_HOST || "85.190.254.7";
const publicRpcUrl = process.env.PUBLIC_RPC_URL || `http://${publicHost}:8545`;

const deployment = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

function readAbi(relativeArtifactPath) {
  const artifactPath = path.join(root, "artifacts", relativeArtifactPath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;
}

const config = {
  chainId: 31337,
  chainName: "Hardhat Local",
  rpcUrl: publicRpcUrl,
  explorerUrl: "",
  addresses: {
    dao: deployment.CircularDAO,
    governanceToken: deployment.GovernanceToken_DAOG,
    categoryRegistry: deployment.WasteCategoryRegistry,
    rewards: deployment.RecyclingRewards,
    stakeholders: deployment.StakeholderRegistry,
    passport: deployment.MaterialPassport,
    tracker: deployment.WasteTracker,
    credit: deployment.CircularCredit_CRC
  },
  abi: {
    dao: readAbi(path.join("contracts", "core", "CircularDAO.sol", "CircularDAO.json")),
    governanceToken: readAbi(path.join("contracts", "tokens", "GovernanceToken.sol", "GovernanceToken.json")),
    categoryRegistry: readAbi(path.join("contracts", "core", "WasteCategoryRegistry.sol", "WasteCategoryRegistry.json")),
    rewards: readAbi(path.join("contracts", "core", "RecyclingRewards.sol", "RecyclingRewards.json")),
    stakeholders: readAbi(path.join("contracts", "identity", "StakeholderRegistry.sol", "StakeholderRegistry.json")),
    passport: readAbi(path.join("contracts", "tokens", "MaterialPassport.sol", "MaterialPassport.json")),
    tracker: readAbi(path.join("contracts", "core", "WasteTracker.sol", "WasteTracker.json")),
    credit: readAbi(path.join("contracts", "tokens", "CircularCredit.sol", "CircularCredit.json"))
  }
};

fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
console.log(`Config UI exportada para ${outPath}`);

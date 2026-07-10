// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title StakeholderRegistry — Registro de Participantes da DAO
/// @notice Gerencia identidades e papéis na cadeia circular
/// @dev Integra com JSON do Alexandre: recebe productId e registra o stakeholder responsável
contract StakeholderRegistry is AccessControl {

    // ─── Papéis (Roles) ───────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE       = DEFAULT_ADMIN_ROLE;
    bytes32 public constant PRODUCER_ROLE    = keccak256("PRODUCER");    // Gerador do resíduo
    bytes32 public constant COLLECTOR_ROLE   = keccak256("COLLECTOR");   // Coletor/transportador
    bytes32 public constant RECYCLER_ROLE    = keccak256("RECYCLER");    // Reciclador
    bytes32 public constant CONSUMER_ROLE    = keccak256("CONSUMER");    // Consumidor final
    bytes32 public constant VALIDATOR_ROLE   = keccak256("VALIDATOR");   // Validador oficial (governo, auditoria)

    // ─── Estruturas ───────────────────────────────────────────────────
    enum StakeholderType { PRODUCER, COLLECTOR, RECYCLER, CONSUMER, VALIDATOR }

    struct Stakeholder {
        address wallet;
        string  name;
        string  cnpjCpf;          // CPF ou CNPJ
        string  location;         // Cidade/Estado
        StakeholderType role;
        bool    active;
        uint256 registeredAt;
        uint256 totalTransactions;
    }

    // ─── Estado ───────────────────────────────────────────────────────
    mapping(address => Stakeholder) public stakeholders;
    mapping(address => bool)        public isRegistered;
    address[]                       public stakeholderList;
    uint256                         public totalStakeholders;

    // ─── Eventos ──────────────────────────────────────────────────────
    event StakeholderRegistered(address indexed wallet, string name, StakeholderType role);
    event StakeholderDeactivated(address indexed wallet);
    event StakeholderReactivated(address indexed wallet);
    event TransactionRecorded(address indexed wallet, uint256 total);

    // ─── Constructor ──────────────────────────────────────────────────
    constructor(address admin) {
        _grantRole(ADMIN_ROLE, admin);
    }

    // ─── Registro ─────────────────────────────────────────────────────
    /// @notice Registra novo participante
    /// @param wallet      Endereço da carteira do participante
    /// @param name        Nome ou razão social
    /// @param cnpjCpf     CPF ou CNPJ
    /// @param location    Localização
    /// @param role        Tipo (PRODUCER=0, COLLECTOR=1, RECYCLER=2, CONSUMER=3, VALIDATOR=4)
    function register(
        address           wallet,
        string  calldata  name,
        string  calldata  cnpjCpf,
        string  calldata  location,
        StakeholderType   role
    ) external onlyRole(ADMIN_ROLE) {
        require(!isRegistered[wallet], "Registry: ja registrado");
        require(wallet != address(0), "Registry: endereco invalido");

        stakeholders[wallet] = Stakeholder({
            wallet:            wallet,
            name:              name,
            cnpjCpf:           cnpjCpf,
            location:          location,
            role:              role,
            active:            true,
            registeredAt:      block.timestamp,
            totalTransactions: 0
        });

        isRegistered[wallet] = true;
        stakeholderList.push(wallet);
        totalStakeholders++;

        // Conceder papel on-chain correspondente
        bytes32 roleHash = _roleForType(role);
        _grantRole(roleHash, wallet);

        emit StakeholderRegistered(wallet, name, role);
    }

    /// @notice Auto-registro (participante solicita entrada na DAO)
    function selfRegister(
        string calldata name,
        string calldata cnpjCpf,
        string calldata location,
        StakeholderType role
    ) external {
        require(!isRegistered[msg.sender], "Registry: ja registrado");
        // Auto-registro só permite PRODUCER e CONSUMER
        require(
            role == StakeholderType.PRODUCER || role == StakeholderType.CONSUMER,
            "Registry: use admin para outros papeis"
        );

        stakeholders[msg.sender] = Stakeholder({
            wallet:            msg.sender,
            name:              name,
            cnpjCpf:           cnpjCpf,
            location:          location,
            role:              role,
            active:            true,
            registeredAt:      block.timestamp,
            totalTransactions: 0
        });

        isRegistered[msg.sender] = true;
        stakeholderList.push(msg.sender);
        totalStakeholders++;

        bytes32 roleHash = _roleForType(role);
        _grantRole(roleHash, msg.sender);

        emit StakeholderRegistered(msg.sender, name, role);
    }

    /// @notice Incrementa contador de transações (chamado pelos contratos de rastreio)
    function recordTransaction(address wallet) external {
        require(isRegistered[wallet], "Registry: nao registrado");
        stakeholders[wallet].totalTransactions++;
        emit TransactionRecorded(wallet, stakeholders[wallet].totalTransactions);
    }

    function deactivate(address wallet) external onlyRole(ADMIN_ROLE) {
        require(isRegistered[wallet], "Registry: nao registrado");
        stakeholders[wallet].active = false;
        emit StakeholderDeactivated(wallet);
    }

    function reactivate(address wallet) external onlyRole(ADMIN_ROLE) {
        require(isRegistered[wallet], "Registry: nao registrado");
        stakeholders[wallet].active = true;
        emit StakeholderReactivated(wallet);
    }

    // ─── Views ────────────────────────────────────────────────────────
    function getStakeholder(address wallet) external view returns (Stakeholder memory) {
        require(isRegistered[wallet], "Registry: nao registrado");
        return stakeholders[wallet];
    }

    function getAllStakeholders() external view returns (address[] memory) {
        return stakeholderList;
    }

    function isActive(address wallet) external view returns (bool) {
        return isRegistered[wallet] && stakeholders[wallet].active;
    }

    // ─── Interno ──────────────────────────────────────────────────────
    function _roleForType(StakeholderType t) internal pure returns (bytes32) {
        if (t == StakeholderType.PRODUCER)  return PRODUCER_ROLE;
        if (t == StakeholderType.COLLECTOR) return COLLECTOR_ROLE;
        if (t == StakeholderType.RECYCLER)  return RECYCLER_ROLE;
        if (t == StakeholderType.CONSUMER)  return CONSUMER_ROLE;
        return VALIDATOR_ROLE;
    }

    // ─── Gestão de Validadores (chamada pela DAO) ─────────────────────
    function grantValidatorRole(address validator) external onlyRole(ADMIN_ROLE) {
        _grantRole(VALIDATOR_ROLE, validator);
    }

    function revokeValidatorRole(address validator) external onlyRole(ADMIN_ROLE) {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

}
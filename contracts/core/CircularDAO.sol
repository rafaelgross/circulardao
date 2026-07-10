// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./WasteCategoryRegistry.sol";
import "./RecyclingRewards.sol";
import "../identity/StakeholderRegistry.sol";

/// @title CircularDAO — DAO Híbrida para Economia Circular de Resíduos
/// @notice Governança on-chain para a pesquisa de doutorado (UNIP — Produção)
/// @dev Baseado em OpenZeppelin Governor + contratos customizados
///      Tokens de governança (DAOG) dão direito a voto ponderado
contract CircularDAO is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    AccessControl
{
    // ─── Roles ────────────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE     = DEFAULT_ADMIN_ROLE;
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR");

    // ─── Referências ──────────────────────────────────────────────────
    WasteCategoryRegistry public categoryRegistry;
    RecyclingRewards      public rewardsContract;
    StakeholderRegistry   public stakeholderRegistry;

    // ─── Regras Pétreis (imutáveis por design) ────────────────────────
    /// @notice Peso mínimo para proposta (protege contra spam)
    uint256 public constant MIN_PROPOSAL_THRESHOLD = 1000e18; // 1.000 DAOG

    /// @notice Porcentagem de quórum: 4% (razoável para DAO de pesquisa)
    ///         Configurado via GovernorVotesQuorumFraction

    // ─── Tipos de Proposta Especializados ────────────────────────────
    enum ProposalType {
        GENERAL,                // proposta geral de governança
        ADD_WASTE_CATEGORY,     // adicionar nova categoria de resíduo
        UPDATE_CREDIT_WEIGHT,   // alterar créditos/kg de uma categoria
        ADMIT_VALIDATOR,        // admitir novo validador na rede
        REVOKE_VALIDATOR,       // revogar validador existente
        FUND_4R_PROJECT,        // financiar projeto 4R com créditos da tesouraria
        UPDATE_BONUS_MULTIPLIER // ajustar multiplicador de bônus de recompensa
    }

    struct ProposalMeta {
        ProposalType pType;
        string       title;
        string       description;
        address      proposer;
        uint256      createdAt;
        bytes        encodedData; // dados específicos do tipo
    }

    mapping(uint256 => ProposalMeta) public proposalMeta;
    uint256[]                        public allProposalIds;

    // ─── Eventos ──────────────────────────────────────────────────────
    event ProposalCreatedWithMeta(
        uint256 indexed proposalId,
        ProposalType    pType,
        string          title,
        address indexed proposer
    );
    event CategoryAdded(uint256 indexed proposalId, string code);
    event CreditWeightUpdated(uint256 indexed proposalId, uint256 categoryId, uint256 newWeight);
    event ValidatorAdmitted(uint256 indexed proposalId, address validator);
    event ValidatorRevoked(uint256 indexed proposalId, address validator);

    // ─── Constructor ──────────────────────────────────────────────────
    /// @param token           Endereço do GovernanceToken (DAOG)
    /// @param admin           Endereço do admin inicial
    /// @param categoryReg     Endereço do WasteCategoryRegistry
    /// @param rewards         Endereço do RecyclingRewards
    /// @param stakeholders    Endereço do StakeholderRegistry
    /// @param votingDelay_    Blocos entre a criação da proposta e o início da votação
    /// @param votingPeriod_   Duração da votação em blocos (produção: 50400 ≈ 7 dias a 12 s/bloco)
    constructor(
        IVotes token,
        address admin,
        address categoryReg,
        address rewards,
        address stakeholders,
        uint48 votingDelay_,
        uint32 votingPeriod_
    )
        Governor("CircularDAO")
        GovernorSettings(
            votingDelay_,
            votingPeriod_,
            MIN_PROPOSAL_THRESHOLD
        )
        GovernorVotes(token)
        GovernorVotesQuorumFraction(4) // 4% de quórum
    {
        _grantRole(ADMIN_ROLE, admin);
        categoryRegistry    = WasteCategoryRegistry(categoryReg);
        rewardsContract     = RecyclingRewards(rewards);
        stakeholderRegistry = StakeholderRegistry(stakeholders);
    }

    // ─── Criação de Propostas Especializadas ─────────────────────────

    /// @notice Proposta para adicionar nova categoria de resíduos
    function proposeAddCategory(
        string calldata code,
        string calldata name,
        string calldata unit,
        uint256         creditsPerKg,
        uint8           hazardLevel,
        string calldata regulation,
        string calldata title,
        string calldata description
    ) external returns (uint256 proposalId) {
        bytes memory callData = abi.encodeWithSelector(
            categoryRegistry.addCategory.selector,
            code, name, unit, creditsPerKg, hazardLevel, regulation
        );

        address[] memory targets = new address[](1);
        uint256[] memory values  = new uint256[](1);
        bytes[]   memory callds  = new bytes[](1);
        targets[0] = address(categoryRegistry);
        values[0]  = 0;
        callds[0]  = callData;

        proposalId = propose(targets, values, callds, description);
        _saveMeta(proposalId, ProposalType.ADD_WASTE_CATEGORY, title, description, callData);
        emit CategoryAdded(proposalId, code);
    }

    /// @notice Proposta para alterar peso de créditos de uma categoria
    function proposeUpdateCreditWeight(
        uint256 categoryId,
        uint256 newCreditsPerKg,
        string calldata title,
        string calldata description
    ) external returns (uint256 proposalId) {
        bytes memory callData = abi.encodeWithSelector(
            categoryRegistry.updateCredits.selector,
            categoryId, newCreditsPerKg
        );

        address[] memory targets = new address[](1);
        uint256[] memory values  = new uint256[](1);
        bytes[]   memory callds  = new bytes[](1);
        targets[0] = address(categoryRegistry);
        values[0]  = 0;
        callds[0]  = callData;

        proposalId = propose(targets, values, callds, description);
        _saveMeta(proposalId, ProposalType.UPDATE_CREDIT_WEIGHT, title, description, callData);
        emit CreditWeightUpdated(proposalId, categoryId, newCreditsPerKg);
    }

    /// @notice Proposta para admitir novo validador
    function proposeAdmitValidator(
        address validator,
        string calldata title,
        string calldata description
    ) external returns (uint256 proposalId) {
        bytes memory callData = abi.encodeWithSelector(
            stakeholderRegistry.grantValidatorRole.selector,
            validator
        );

        address[] memory targets = new address[](1);
        uint256[] memory values  = new uint256[](1);
        bytes[]   memory callds  = new bytes[](1);
        targets[0] = address(stakeholderRegistry);
        values[0]  = 0;
        callds[0]  = callData;

        proposalId = propose(targets, values, callds, description);
        _saveMeta(proposalId, ProposalType.ADMIT_VALIDATOR, title, description, callData);
        emit ValidatorAdmitted(proposalId, validator);
    }

    /// @notice Proposta para alterar multiplicador de bônus de recompensa
    function proposeUpdateBonus(
        uint256 newBp,
        string calldata title,
        string calldata description
    ) external returns (uint256 proposalId) {
        bytes memory callData = abi.encodeWithSelector(
            rewardsContract.setBonusMultiplier.selector,
            newBp
        );

        address[] memory targets = new address[](1);
        uint256[] memory values  = new uint256[](1);
        bytes[]   memory callds  = new bytes[](1);
        targets[0] = address(rewardsContract);
        values[0]  = 0;
        callds[0]  = callData;

        proposalId = propose(targets, values, callds, description);
        _saveMeta(proposalId, ProposalType.UPDATE_BONUS_MULTIPLIER, title, description, callData);
    }

    // ─── Dashboard de Transparência ──────────────────────────────────

    /// @notice Lista todas as propostas em aberto
    function getActiveProposals() external view returns (uint256[] memory active) {
        uint256 count = 0;
        for (uint i = 0; i < allProposalIds.length; i++) {
            if (state(allProposalIds[i]) == ProposalState.Active) count++;
        }
        active = new uint256[](count);
        uint256 idx = 0;
        for (uint i = 0; i < allProposalIds.length; i++) {
            if (state(allProposalIds[i]) == ProposalState.Active) {
                active[idx++] = allProposalIds[i];
            }
        }
    }

    /// @notice Retorna os votos de uma proposta (total FOR / AGAINST / ABSTAIN)
    function getVoteSummary(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes
    ) {
        (againstVotes, forVotes, abstainVotes) = proposalVotes(proposalId);
    }

    /// @notice Retorna metadados de uma proposta
    function getProposalMeta(uint256 proposalId) external view returns (ProposalMeta memory) {
        return proposalMeta[proposalId];
    }

    /// @notice Estado textual da proposta (para frontend)
    function getProposalStateLabel(uint256 proposalId) external view returns (string memory) {
        ProposalState s = state(proposalId);
        if (s == ProposalState.Pending)   return "Pendente";
        if (s == ProposalState.Active)    return "Em Votacao";
        if (s == ProposalState.Canceled)  return "Cancelada";
        if (s == ProposalState.Defeated)  return "Reprovada";
        if (s == ProposalState.Succeeded) return "Aprovada";
        if (s == ProposalState.Queued)    return "Em Fila";
        if (s == ProposalState.Expired)   return "Expirada";
        if (s == ProposalState.Executed)  return "Executada";
        return "Desconhecido";
    }

    /// @notice Total de propostas históricas
    function totalProposals() external view returns (uint256) {
        return allProposalIds.length;
    }

    // ─── Overrides Obrigatórios ───────────────────────────────────────

    function votingDelay()
        public view override(Governor, GovernorSettings)
        returns (uint256)
    { return super.votingDelay(); }

    function votingPeriod()
        public view override(Governor, GovernorSettings)
        returns (uint256)
    { return super.votingPeriod(); }

    function quorum(uint256 blockNumber)
        public view override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    { return super.quorum(blockNumber); }

    function proposalThreshold()
        public view override(Governor, GovernorSettings)
        returns (uint256)
    { return super.proposalThreshold(); }

    // GovernorCountingSimple precisa deste override em OZ v5
    function COUNTING_MODE()
        public pure override(GovernorCountingSimple, IGovernor)
        returns (string memory)
    { return "support=bravo&quorum=for,abstain"; }

    // Compatibilidade AccessControl + Governor (ambos implementam supportsInterface)
    function supportsInterface(bytes4 interfaceId)
        public view override(Governor, AccessControl)
        returns (bool)
    { return super.supportsInterface(interfaceId); }

    // ─── Interno ──────────────────────────────────────────────────────
    function _saveMeta(
        uint256 proposalId,
        ProposalType pType,
        string memory title,
        string memory description,
        bytes memory data
    ) internal {
        proposalMeta[proposalId] = ProposalMeta({
            pType:       pType,
            title:       title,
            description: description,
            proposer:    msg.sender,
            createdAt:   block.timestamp,
            encodedData: data
        });
        allProposalIds.push(proposalId);
        emit ProposalCreatedWithMeta(proposalId, pType, title, msg.sender);
    }
}

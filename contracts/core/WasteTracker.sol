// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./WasteCategoryRegistry.sol";
import "../tokens/MaterialPassport.sol";

/// @title WasteTracker — Rastreamento do Ciclo de Vida dos Resíduos
/// @notice Registra cada etapa da cadeia: coleta → triagem → reciclagem → reinserção
/// @dev Integração central entre o sistema do Alexandre e o blockchain
contract WasteTracker is AccessControl, ReentrancyGuard {

    bytes32 public constant ADMIN_ROLE     = DEFAULT_ADMIN_ROLE;
    bytes32 public constant COLLECTOR_ROLE = keccak256("COLLECTOR");
    bytes32 public constant RECYCLER_ROLE  = keccak256("RECYCLER");
    bytes32 public constant OPERATOR_ROLE  = keccak256("OPERATOR");

    // ─── Referências ──────────────────────────────────────────────────
    WasteCategoryRegistry public categoryRegistry;
    MaterialPassport      public passport;

    // ─── Estruturas ───────────────────────────────────────────────────
    struct WasteEvent {
        uint256 tokenId;         // Passaporte NFT correspondente
        string  productId;       // ID externo do Alexandre
        address actor;           // Quem executou a ação
        uint8   action;          // 0=coleta 1=transit 2=triagem 3=processamento 4=reciclagem 5=reinserção
        uint256 weightKg;        // Peso em gramas processado nesta etapa
        uint256 timestamp;
        string  location;
        string  notes;
    }

    // ─── Estado ───────────────────────────────────────────────────────
    mapping(uint256 => WasteEvent[]) public eventsByToken;  // tokenId → histórico
    mapping(address => uint256)      public weightByActor;  // total em gramas por ator
    mapping(uint256 => uint256)      public weightByCat;    // total em gramas por categoria
    uint256                          public totalWeightProcessed; // gramas totais
    uint256                          public totalEventsRecorded;

    // ─── Eventos ──────────────────────────────────────────────────────
    event WasteCollected(uint256 indexed tokenId, string productId, address collector, uint256 weightKg);
    event WasteTriaged(uint256 indexed tokenId, address triager, uint256 weightKg);
    event WasteProcessed(uint256 indexed tokenId, address recycler, uint256 weightKg);
    event WasteRecycled(uint256 indexed tokenId, address recycler, uint256 weightKg, uint256 categoryId);
    event WasteReinserted(uint256 indexed tokenId, address actor, uint256 weightKg);

    // ─── Constructor ──────────────────────────────────────────────────
    constructor(
        address admin,
        address categoryRegistryAddr,
        address passportAddr
    ) {
        _grantRole(ADMIN_ROLE, admin);
        categoryRegistry = WasteCategoryRegistry(categoryRegistryAddr);
        passport         = MaterialPassport(passportAddr);
    }

    // ─── Funções de Rastreio ──────────────────────────────────────────

    /// @notice Registra coleta física do resíduo
    function registerCollection(
        uint256         tokenId,
        string calldata location,
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.REGISTERED,
            "Tracker: status invalido para coleta"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.COLLECTED, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 0, p.weightKg, location, notes);

        weightByActor[msg.sender] += p.weightKg;
        weightByCat[p.categoryId] += p.weightKg;
        totalWeightProcessed      += p.weightKg;

        emit WasteCollected(tokenId, p.externalProductId, msg.sender, p.weightKg);
    }

    /// @notice Registra início do transporte
    function registerTransit(
        uint256         tokenId,
        address         nextHolder,
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.COLLECTED,
            "Tracker: precisa estar coletado"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.IN_TRANSIT, notes);
        passport.transferHolder(tokenId, nextHolder, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 1, p.weightKg, "", notes);

        emit WasteTriaged(tokenId, msg.sender, p.weightKg);
    }

    /// @notice Registra triagem/classificação
    function registerTriagem(
        uint256         tokenId,
        string calldata location,
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.IN_TRANSIT ||
            p.status == MaterialPassport.MaterialStatus.COLLECTED,
            "Tracker: status invalido para triagem"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.TRIAGED, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 2, p.weightKg, location, notes);

        emit WasteTriaged(tokenId, msg.sender, p.weightKg);
    }

    /// @notice Registra início do processamento/reciclagem
    function registerProcessing(
        uint256         tokenId,
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.TRIAGED,
            "Tracker: precisa estar triado"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.PROCESSING, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 3, p.weightKg, "", notes);
        emit WasteProcessed(tokenId, msg.sender, p.weightKg);
    }

    /// @notice Finaliza a reciclagem — aciona emissão de créditos
    function registerRecycled(
        uint256         tokenId,
        uint256         actualWeightKg, // peso real após processamento (pode ser < original)
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.PROCESSING,
            "Tracker: precisa estar em processamento"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.RECYCLED, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 4, actualWeightKg, "", notes);

        emit WasteRecycled(tokenId, msg.sender, actualWeightKg, p.categoryId);
    }

    /// @notice Registra reinserção na cadeia produtiva
    function registerReinserted(
        uint256         tokenId,
        string calldata notes
    ) external nonReentrant {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.RECYCLED,
            "Tracker: precisa estar reciclado"
        );

        passport.updateStatus(tokenId, MaterialPassport.MaterialStatus.REINSERTED, notes);
        _recordEvent(tokenId, p.externalProductId, msg.sender, 5, p.weightKg, "", notes);

        emit WasteReinserted(tokenId, msg.sender, p.weightKg);
    }

    // ─── Views ────────────────────────────────────────────────────────
    function getHistory(uint256 tokenId) external view returns (WasteEvent[] memory) {
        return eventsByToken[tokenId];
    }

    function getActorStats(address actor) external view returns (uint256 totalWeight, uint256 totalEvents) {
        totalWeight = weightByActor[actor];
        totalEvents = 0;
        // Nota: contagem de eventos por ator seria custosa on-chain; usar indexer off-chain
    }

    function getCategoryStats(uint256 categoryId) external view returns (uint256 totalWeight) {
        return weightByCat[categoryId];
    }

    // ─── Interno ──────────────────────────────────────────────────────
    function _recordEvent(
        uint256 tokenId,
        string memory productId,
        address actor,
        uint8 action,
        uint256 weightKg,
        string memory location,
        string memory notes
    ) internal {
        eventsByToken[tokenId].push(WasteEvent({
            tokenId:   tokenId,
            productId: productId,
            actor:     actor,
            action:    action,
            weightKg:  weightKg,
            timestamp: block.timestamp,
            location:  location,
            notes:     notes
        }));
        totalEventsRecorded++;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MaterialPassport — Passaporte Digital de Material (ERC-1155)
/// @notice Registra lotes de resíduos de qualquer categoria na blockchain
/// @dev campos fixos usam bytes32 para evitar stack too deep no ABI encoder
contract MaterialPassport is ERC1155, ERC1155Burnable, AccessControl, ReentrancyGuard {

    bytes32 public constant MINTER_ROLE   = keccak256("MINTER");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");
    bytes32 public constant ADMIN_ROLE    = DEFAULT_ADMIN_ROLE;

    enum MaterialStatus {
        REGISTERED, COLLECTED, IN_TRANSIT,
        TRIAGED, PROCESSING, RECYCLED,
        REINSERTED, REJECTED, COMPOSTED
    }

    struct PassportCore {
        uint256       tokenId;
        string        externalProductId;  // ID no sistema externo
        bytes32       externalDataHash;   // SHA-256 do JSON (bytes32 = exato)
        string        externalDataURI;    // URL do dado original
        uint256       categoryId;
        bytes32       categoryCode;       // ex: keccak256("EWASTE_GENERAL")
        uint256       weightKg;           // em gramas
        address       registeredBy;
        address       currentHolder;
        MaterialStatus status;
        uint256       registeredAt;
        uint256       lastUpdated;
        bool          isLot;
        uint256       quantity;
    }

    struct PassportMeta {
        string composition;      // composição do material
        string originLocation;   // local de origem
    }

    struct StatusHistory {
        MaterialStatus status;
        address        updatedBy;
        uint256        timestamp;
        string         notes;
    }

    struct MintParams {
        address  recipient;
        string   externalProductId;
        bytes32  externalDataHash;
        string   externalDataURI;
        uint256  categoryId;
        bytes32  categoryCode;
        uint256  weightKg;
        string   composition;
        string   originLocation;
        bool     isLot;
        uint256  quantity;
    }

    mapping(uint256 => PassportCore)        public passports;
    mapping(uint256 => PassportMeta)        public passportMeta;
    mapping(string  => uint256)             public externalIdToToken;
    mapping(uint256 => StatusHistory[])     public statusHistory;

    uint256 public nextTokenId;
    uint256 public totalPassports;

    event PassportMinted(
        uint256 indexed tokenId,
        string  externalProductId,
        uint256 categoryId,
        uint256 weightKg,
        address registeredBy
    );
    event StatusUpdated(
        uint256 indexed tokenId,
        MaterialStatus  oldStatus,
        MaterialStatus  newStatus,
        address         updatedBy
    );
    event HolderTransferred(
        uint256 indexed tokenId,
        address from,
        address to
    );

    constructor(address admin) ERC1155("") {
        _grantRole(ADMIN_ROLE, admin);
        nextTokenId = 1;
    }

    function mint(MintParams calldata p)
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (uint256 tokenId)
    {
        require(bytes(p.externalProductId).length > 0, "Passport: productId vazio");
        require(p.weightKg > 0, "Passport: peso invalido");
        require(p.quantity > 0, "Passport: quantidade invalida");

        tokenId = nextTokenId++;

        passports[tokenId] = PassportCore({
            tokenId:          tokenId,
            externalProductId: p.externalProductId,
            externalDataHash: p.externalDataHash,
            externalDataURI:  p.externalDataURI,
            categoryId:       p.categoryId,
            categoryCode:     p.categoryCode,
            weightKg:         p.weightKg,
            registeredBy:     msg.sender,
            currentHolder:    p.recipient,
            status:           MaterialStatus.REGISTERED,
            registeredAt:     block.timestamp,
            lastUpdated:      block.timestamp,
            isLot:            p.isLot,
            quantity:         p.quantity
        });

        passportMeta[tokenId] = PassportMeta({
            composition:    p.composition,
            originLocation: p.originLocation
        });

        externalIdToToken[p.externalProductId] = tokenId;
        totalPassports++;

        statusHistory[tokenId].push(StatusHistory({
            status:    MaterialStatus.REGISTERED,
            updatedBy: msg.sender,
            timestamp: block.timestamp,
            notes:     "Registro inicial"
        }));

        _mint(p.recipient, tokenId, p.isLot ? 1 : p.quantity, "");
        emit PassportMinted(tokenId, p.externalProductId, p.categoryId, p.weightKg, msg.sender);
    }

    function updateStatus(
        uint256        tokenId,
        MaterialStatus newStatus,
        string calldata notes
    ) external onlyRole(OPERATOR_ROLE) {
        PassportCore storage pc = passports[tokenId];
        require(pc.tokenId != 0, "Passport: nao encontrado");

        MaterialStatus old = pc.status;
        pc.status      = newStatus;
        pc.lastUpdated = block.timestamp;

        statusHistory[tokenId].push(StatusHistory({
            status:    newStatus,
            updatedBy: msg.sender,
            timestamp: block.timestamp,
            notes:     notes
        }));

        emit StatusUpdated(tokenId, old, newStatus, msg.sender);
    }

    function transferHolder(
        uint256 tokenId,
        address newHolder,
        string calldata notes
    ) external onlyRole(OPERATOR_ROLE) {
        PassportCore storage pc = passports[tokenId];
        require(pc.tokenId != 0, "Passport: nao encontrado");

        address old = pc.currentHolder;
        pc.currentHolder = newHolder;
        pc.lastUpdated   = block.timestamp;

        statusHistory[tokenId].push(StatusHistory({
            status:    pc.status,
            updatedBy: msg.sender,
            timestamp: block.timestamp,
            notes:     notes
        }));

        emit HolderTransferred(tokenId, old, newHolder);
    }

    function getPassportCore(uint256 tokenId) external view returns (PassportCore memory) {
        require(passports[tokenId].tokenId != 0, "Passport: nao encontrado");
        return passports[tokenId];
    }

    function getPassportMeta(uint256 tokenId) external view returns (PassportMeta memory) {
        return passportMeta[tokenId];
    }

    function getByExternalId(string calldata extId) external view returns (PassportCore memory) {
        uint256 tid = externalIdToToken[extId];
        require(tid != 0, "Passport: ID externo nao encontrado");
        return passports[tid];
    }

    function getHistory(uint256 tokenId) external view returns (StatusHistory[] memory) {
        return statusHistory[tokenId];
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

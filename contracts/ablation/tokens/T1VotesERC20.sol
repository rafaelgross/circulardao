// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title T1VotesERC20 — ablation study's governance-capable token (3.1, 3.2)
/// @notice Same OpenZeppelin ERC20Votes used by GovernanceToken.sol (the
///         Sepolia-deployed token), minus the AccessControl-gated mint and
///         MAX_SUPPLY cap — those aren't part of what's under study here,
///         and keeping them would make the T0-vs-T1 comparison confound
///         "has checkpoints" with "has access control", which isn't the
///         question in section 3.2. Whole supply minted to the deployer at
///         construction, same as T0, so the two tokens start from an
///         identical state and differ only in the mechanism being compared.
contract T1VotesERC20 is ERC20Votes {
    constructor(uint256 totalSupply_)
        ERC20("Ablation Votes Token", "T1")
        EIP712("Ablation Votes Token", "1")
    {
        _mint(msg.sender, totalSupply_);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title T0PlainERC20 — control token for the ablation study (3.2)
/// @notice Plain ERC20, no vote history, no delegation. Whole supply minted
///         to the deployer at construction so per-condition deployments
///         start from an identical state (protocol condition 4).
contract T0PlainERC20 is ERC20 {
    constructor(uint256 totalSupply_) ERC20("Ablation Plain Token", "T0") {
        _mint(msg.sender, totalSupply_);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AblationGovernorBase.sol";

/// @title V1Governor — historical voting power, no quorum (protocol 3.1)
/// @notice `_getVotes` is GovernorVotes' own default: `token.getPastVotes(
///         account, timepoint)`, i.e. delegated power at the proposal's
///         activation block. Not overridden here — this contract IS the
///         "historical" baseline that V0 (current power) and V2 (historical
///         + fixed quorum) each differ from in exactly one respect.
contract V1Governor is AblationGovernorBase {
    constructor(IVotes token_, uint256 votingDelay_, uint256 votingPeriod_)
        AblationGovernorBase("V1Governor", token_, votingDelay_, votingPeriod_)
    {}

    /// @notice No quorum requirement — always trivially met.
    function quorum(uint256) public pure override returns (uint256) {
        return 0;
    }
}

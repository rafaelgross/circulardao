// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AblationGovernorBase.sol";

/// @title V0Governor — current voting power, no quorum (protocol 3.1)
/// @notice The only difference from V1Governor: `_getVotes` reads the
///         voter's CURRENT delegated power (`token().getVotes(account)`)
///         instead of their power at the proposal's activation block. The
///         `timepoint` parameter is intentionally unused — that omission is
///         exactly the mechanism this variant is measuring the absence of.
///         Everything else (AblationGovernorBase, majority rule, no
///         quorum) is identical to V1Governor, so V0-vs-V1 gas and
///         behavior differences are attributable to this one line.
contract V0Governor is AblationGovernorBase {
    constructor(IVotes token_, uint256 votingDelay_, uint256 votingPeriod_)
        AblationGovernorBase("V0Governor", token_, votingDelay_, votingPeriod_)
    {}

    function quorum(uint256) public pure override returns (uint256) {
        return 0;
    }

    function _getVotes(address account, uint256 /* timepoint */, bytes memory /* params */)
        internal
        view
        override(Governor, GovernorVotes)
        returns (uint256)
    {
        return token().getVotes(account);
    }
}

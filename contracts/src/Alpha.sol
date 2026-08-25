// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title ALPHA — the Outfox premium token
/// @notice Fixed-supply ERC-20: the entire 2,000,000 cap is minted once to the treasury
///         at deployment. There is no mint function, no owner, no pause, no upgrade
///         path — the token is inert by design. Every economic control lives in the
///         server-authoritative game ledger, and value crosses the chain edge only
///         through the Settlement contract.
/// @dev ERC20Permit is included so deposits can be single-transaction (permit + deposit)
///      at the Settlement edge.
contract Alpha is ERC20, ERC20Permit {
    uint256 public constant CAP = 2_000_000e18;

    constructor(address treasury) ERC20("Alpha", "ALPHA") ERC20Permit("Alpha") {
        require(treasury != address(0), "treasury=0");
        _mint(treasury, CAP);
    }
}

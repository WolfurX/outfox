// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Alpha} from "../src/Alpha.sol";
import {Settlement} from "../src/Settlement.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// Deploys Alpha + Settlement. All addresses come from env — no keys or
/// identities in source. See ../README.md for the chain-ID verification step
/// and deployer key-hygiene rules that MUST precede any run of this script.
contract Deploy is Script {
    // Robinhood Chain (docs.robinhood.com/chain/connecting), verified 2026-07-11.
    uint256 constant TESTNET_CHAIN_ID = 46630;
    uint256 constant MAINNET_CHAIN_ID = 4663;

    function run() external {
        address treasury = vm.envAddress("ALPHA_TREASURY");
        address signer = vm.envAddress("SETTLEMENT_SIGNER");
        address owner = vm.envAddress("SETTLEMENT_OWNER");
        uint256 windowCap = vm.envUint("SETTLEMENT_WINDOW_CAP");

        require(
            block.chainid == TESTNET_CHAIN_ID || block.chainid == MAINNET_CHAIN_ID,
            "unexpected chain id - verify RPC against docs.robinhood.com/chain"
        );
        // The three roles must be three DIFFERENT keys, and none of them may be the
        // deployer: the deployer is a throwaway hot key, and minting the entire supply
        // (or handing pause/signer powers) to it would defeat the whole key hierarchy.
        require(treasury != signer && treasury != owner && signer != owner, "roles must differ");
        require(treasury != msg.sender && signer != msg.sender && owner != msg.sender, "role == deployer");

        vm.startBroadcast();
        Alpha alpha = new Alpha(treasury);
        Settlement settlement = new Settlement(IERC20(address(alpha)), signer, windowCap, owner);
        vm.stopBroadcast();

        console.log("chainid:   ", block.chainid);
        console.log("Alpha:     ", address(alpha));
        console.log("Settlement:", address(settlement));
    }
}

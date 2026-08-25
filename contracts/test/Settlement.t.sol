// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Alpha} from "../src/Alpha.sol";
import {Settlement} from "../src/Settlement.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract SettlementTest is Test {
    Alpha alpha;
    Settlement settlement;

    uint256 constant SIGNER_PK = 0xA11CE;
    uint256 constant PLAYER_PK = 0xB0B;
    address signer;
    address player;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    uint256 constant WINDOW_CAP = 10_000e18;

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        player = vm.addr(PLAYER_PK);
        alpha = new Alpha(treasury);
        settlement = new Settlement(IERC20(address(alpha)), signer, WINDOW_CAP, owner);
        // fund the reserve and a player
        vm.startPrank(treasury);
        alpha.transfer(address(settlement), 100_000e18);
        alpha.transfer(player, 1_000e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _voucherDigest(address to, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("OutfoxSettlement")),
                keccak256(bytes("1")),
                block.chainid,
                address(settlement)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdrawal(address to,uint256 amount,uint256 nonce,uint256 deadline)"),
                to,
                amount,
                nonce,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function _sign(uint256 pk, address to, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _voucherDigest(to, amount, nonce, deadline));
        return abi.encodePacked(r, s, v);
    }

    // -------------------------------------------------------------------- token

    function test_alpha_fixed_supply_minted_to_treasury() public {
        Alpha fresh = new Alpha(treasury);
        assertEq(fresh.totalSupply(), 2_000_000e18);
        assertEq(fresh.CAP(), 2_000_000e18);
        assertEq(fresh.name(), "Alpha");
        assertEq(fresh.symbol(), "ALPHA");
    }

    function test_alpha_zero_treasury_reverts() public {
        vm.expectRevert(bytes("treasury=0"));
        new Alpha(address(0));
    }

    // ----------------------------------------------------------------- deposits

    function test_deposit_transfers_and_emits() public {
        vm.startPrank(player);
        alpha.approve(address(settlement), 500e18);
        vm.expectEmit(true, false, false, true);
        emit Settlement.Deposited(player, 500e18);
        settlement.deposit(500e18);
        vm.stopPrank();
        assertEq(alpha.balanceOf(player), 500e18);
        assertEq(settlement.reserve(), 100_500e18);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(player);
        vm.expectRevert(Settlement.ZeroAmount.selector);
        settlement.deposit(0);
    }

    function test_deposit_blocked_when_paused() public {
        vm.prank(owner);
        settlement.pause();
        vm.startPrank(player);
        alpha.approve(address(settlement), 1e18);
        vm.expectRevert();
        settlement.deposit(1e18);
        vm.stopPrank();
    }

    function test_depositWithPermit_single_tx() public {
        uint256 amount = 250e18;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 permitDigest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                alpha.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        player,
                        address(settlement),
                        amount,
                        alpha.nonces(player),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PLAYER_PK, permitDigest);
        vm.prank(player);
        settlement.depositWithPermit(amount, deadline, v, r, s);
        assertEq(settlement.reserve(), 100_250e18);
    }

    function test_depositWithPermit_griefed_permit_still_works_with_allowance() public {
        uint256 amount = 100e18;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(player);
        alpha.approve(address(settlement), amount); // pre-existing allowance
        // garbage sig -> permit reverts internally, deposit proceeds on allowance
        vm.prank(player);
        settlement.depositWithPermit(amount, deadline, 27, bytes32(uint256(1)), bytes32(uint256(2)));
        assertEq(settlement.reserve(), 100_100e18);
    }

    // -------------------------------------------------------------- withdrawals

    function test_withdraw_happy_path() public {
        bytes memory sig = _sign(SIGNER_PK, player, 700e18, 1, block.timestamp + 1 hours);
        vm.expectEmit(true, true, false, true);
        emit Settlement.Withdrawn(player, 700e18, 1);
        settlement.withdraw(player, 700e18, 1, block.timestamp + 1 hours, sig);
        assertEq(alpha.balanceOf(player), 1_700e18);
        assertTrue(settlement.usedNonce(1));
    }

    function test_withdraw_replay_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(SIGNER_PK, player, 10e18, 7, dl);
        settlement.withdraw(player, 10e18, 7, dl, sig);
        vm.expectRevert(Settlement.NonceUsed.selector);
        settlement.withdraw(player, 10e18, 7, dl, sig);
    }

    function test_withdraw_expired_reverts() public {
        uint256 dl = block.timestamp + 1;
        bytes memory sig = _sign(SIGNER_PK, player, 10e18, 8, dl);
        vm.warp(block.timestamp + 2);
        vm.expectRevert(Settlement.Expired.selector);
        settlement.withdraw(player, 10e18, 8, dl, sig);
    }

    function test_withdraw_wrong_signer_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(PLAYER_PK, player, 10e18, 9, dl); // not the signer
        vm.expectRevert(Settlement.BadSignature.selector);
        settlement.withdraw(player, 10e18, 9, dl, sig);
    }

    function test_withdraw_tampered_amount_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(SIGNER_PK, player, 10e18, 10, dl);
        vm.expectRevert(Settlement.BadSignature.selector);
        settlement.withdraw(player, 11e18, 10, dl, sig);
    }

    function test_withdraw_blocked_when_paused() public {
        vm.prank(owner);
        settlement.pause();
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(SIGNER_PK, player, 10e18, 11, dl);
        vm.expectRevert();
        settlement.withdraw(player, 10e18, 11, dl, sig);
    }

    function test_withdraw_zero_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(SIGNER_PK, player, 0, 12, dl);
        vm.expectRevert(Settlement.ZeroAmount.selector);
        settlement.withdraw(player, 0, 12, dl, sig);
    }

    // --------------------------------------------------------------- window cap

    function test_window_cap_enforced() public {
        uint256 dl = block.timestamp + 1 hours;
        settlement.withdraw(player, 6_000e18, 20, dl, _sign(SIGNER_PK, player, 6_000e18, 20, dl));
        settlement.withdraw(player, 4_000e18, 21, dl, _sign(SIGNER_PK, player, 4_000e18, 21, dl));
        // cap exactly consumed (same block: nothing has leaked); one more must fail
        bytes memory sig = _sign(SIGNER_PK, player, 1e18, 22, dl);
        vm.expectRevert(Settlement.WindowCapExceeded.selector);
        settlement.withdraw(player, 1e18, 22, dl, sig);
    }

    function test_bucket_leaks_linearly() public {
        uint256 dl = block.timestamp + 3 days;
        settlement.withdraw(player, WINDOW_CAP, 30, dl, _sign(SIGNER_PK, player, WINDOW_CAP, 30, dl));
        // a quarter-window later, exactly a quarter of the cap has leaked back
        vm.warp(block.timestamp + 6 hours);
        bytes memory tooMuch = _sign(SIGNER_PK, player, WINDOW_CAP / 4 + 1e18, 31, dl);
        vm.expectRevert(Settlement.WindowCapExceeded.selector);
        settlement.withdraw(player, WINDOW_CAP / 4 + 1e18, 31, dl, tooMuch);
        settlement.withdraw(player, WINDOW_CAP / 4, 32, dl, _sign(SIGNER_PK, player, WINDOW_CAP / 4, 32, dl));
    }

    function test_full_window_idle_refills_bucket() public {
        uint256 dl = block.timestamp + 3 days;
        settlement.withdraw(player, WINDOW_CAP, 33, dl, _sign(SIGNER_PK, player, WINDOW_CAP, 33, dl));
        vm.warp(block.timestamp + 1 days);
        settlement.withdraw(player, WINDOW_CAP, 34, dl, _sign(SIGNER_PK, player, WINDOW_CAP, 34, dl));
        assertEq(alpha.balanceOf(player), 1_000e18 + 2 * WINDOW_CAP);
    }

    /// The finding this replaced: a tumbling window let an attacker take the full cap
    /// at the end of window N and again at the start of N+1 — 2x the cap in seconds.
    function test_no_boundary_burst_across_window_edge() public {
        uint256 dl = block.timestamp + 3 days;
        settlement.withdraw(player, WINDOW_CAP, 40, dl, _sign(SIGNER_PK, player, WINDOW_CAP, 40, dl));
        // one second before a full window has passed, essentially nothing has leaked
        vm.warp(block.timestamp + 1 days - 1);
        bytes memory sig = _sign(SIGNER_PK, player, WINDOW_CAP, 41, dl);
        vm.expectRevert(Settlement.WindowCapExceeded.selector);
        settlement.withdraw(player, WINDOW_CAP, 41, dl, sig);
    }

    /// Invariant: across ANY rolling window, total withdrawn <= windowCap + one
    /// window's worth of leak (the bucket can only ever hold windowCap).
    function testFuzz_rolling_window_never_exceeds_cap(uint256[8] calldata amounts, uint32[8] calldata gaps) public {
        uint256 dl = block.timestamp + 3650 days;
        uint256 start = block.timestamp;
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = bound(amounts[i], 1, WINDOW_CAP);
            vm.warp(block.timestamp + bound(gaps[i], 0, 12 hours));
            bytes memory sig = _sign(SIGNER_PK, player, amt, 100 + i, dl);
            try settlement.withdraw(player, amt, 100 + i, dl, sig) {
                total += amt;
            } catch {}
        }
        // elapsed leak + the bucket's own capacity bounds everything withdrawn
        uint256 elapsed = block.timestamp - start;
        uint256 maxAllowed = WINDOW_CAP + (WINDOW_CAP * elapsed) / settlement.WINDOW();
        assertLe(total, maxAllowed);
        assertLe(settlement.bucket(), WINDOW_CAP);
    }

    // ---------------------------------------------------------------------- ops

    function test_setSigner_only_owner() public {
        vm.expectRevert();
        settlement.setSigner(player);
        vm.prank(owner);
        settlement.setSigner(player);
        assertEq(settlement.signer(), player);
    }

    function test_setSigner_zero_reverts() public {
        vm.prank(owner);
        vm.expectRevert(bytes("signer=0"));
        settlement.setSigner(address(0));
    }

    function test_setWindowCap_only_owner() public {
        vm.expectRevert();
        settlement.setWindowCap(1);
        vm.prank(owner);
        settlement.setWindowCap(1);
        assertEq(settlement.windowCap(), 1);
    }

    function test_setWindowCap_zero_reverts() public {
        vm.prank(owner);
        vm.expectRevert(bytes("cap=0"));
        settlement.setWindowCap(0);
    }

    function test_constructor_rejects_signer_equals_owner() public {
        vm.expectRevert(bytes("signer==owner"));
        new Settlement(IERC20(address(alpha)), owner, WINDOW_CAP, owner);
    }

    function test_constructor_rejects_zero_cap() public {
        vm.expectRevert(bytes("cap=0"));
        new Settlement(IERC20(address(alpha)), signer, 0, owner);
    }

    function test_setSigner_rejects_owner() public {
        vm.prank(owner);
        vm.expectRevert(bytes("signer==owner"));
        settlement.setSigner(owner);
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(bytes("disabled"));
        settlement.renounceOwnership();
        assertEq(settlement.owner(), owner);
    }

    function test_owner_cannot_move_funds() public {
        // no owner-facing function transfers tokens; verify by interface surface:
        // pause/unpause/setSigner/setWindowCap are the only owner ops, none moves value.
        vm.startPrank(owner);
        settlement.pause();
        settlement.unpause();
        settlement.setWindowCap(WINDOW_CAP);
        settlement.setSigner(signer);
        vm.stopPrank();
        assertEq(settlement.reserve(), 100_000e18); // unchanged
    }

    function test_ownable2step_transfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        settlement.transferOwnership(newOwner);
        assertEq(settlement.owner(), owner); // not yet — 2-step
        vm.prank(newOwner);
        settlement.acceptOwnership();
        assertEq(settlement.owner(), newOwner);
    }
}

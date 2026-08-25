// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/// @title Settlement — the chain edge of the Outfox economy
/// @notice Deposits and withdrawals of ALPHA settle here; game state is off-chain and
///         server-authoritative, so the chain sees only the edges. Deposits are
///         permissionless and credited off-chain to the account linked to the
///         depositing address. Withdrawals require an EIP-712 voucher signed by the
///         game server, which applies the game-side gates (identity verification, fees,
///         holding periods, per-account limits) BEFORE signing. The contract enforces
///         only what the chain must: single use, expiry, signature, pause, and a
///         rolling cap bounding the blast radius of a compromised signer key.
/// @dev    The contract balance is the proof of reserves: total withdrawable
///         liabilities in the game ledger must never exceed reserve(). No function
///         moves tokens out except voucher withdrawal — the owner cannot seize funds.
contract Settlement is Ownable2Step, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public immutable alpha;

    /// @notice Game-server voucher signing key (hot key; separate from owner).
    address public signer;

    /// @notice Rolling withdrawal cap (blast-radius bound): a leaky bucket that drains
    ///         `windowCap` per WINDOW. Bounds withdrawals in ANY rolling 24h span — a
    ///         fixed/tumbling window would let an attacker burst 2x the cap across the
    ///         boundary, which is exactly what this bound is supposed to prevent.
    uint256 public windowCap;
    uint256 public constant WINDOW = 1 days;
    uint256 public bucket; // outstanding "filled" volume, decays linearly
    uint256 public lastDrain; // last time the bucket was drained

    mapping(uint256 => bool) public usedNonce;

    bytes32 private constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address to,uint256 amount,uint256 nonce,uint256 deadline)");

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount, uint256 indexed nonce);
    event SignerChanged(address indexed newSigner);
    event WindowCapChanged(uint256 newCap);

    error Expired();
    error NonceUsed();
    error BadSignature();
    error WindowCapExceeded();
    error ZeroAmount();

    constructor(IERC20 alpha_, address signer_, uint256 windowCap_, address owner_)
        EIP712("OutfoxSettlement", "1")
        Ownable(owner_)
    {
        require(address(alpha_) != address(0) && signer_ != address(0), "zero addr");
        // signer is a HOT key (game server) and owner is a COLD key: if they were the
        // same key, its compromise would let the attacker raise windowCap and drain the
        // whole reserve — silently voiding the blast-radius bound this contract exists for.
        require(signer_ != owner_, "signer==owner");
        require(windowCap_ > 0, "cap=0"); // 0 would brick every withdrawal (use pause())
        alpha = alpha_;
        signer = signer_;
        windowCap = windowCap_;
        lastDrain = block.timestamp;
    }

    // ---------------------------------------------------------------- deposits

    /// @notice Deposit ALPHA into the game. Credited off-chain to the account linked
    ///         to msg.sender (event-indexed by the game server).
    function deposit(uint256 amount) external whenNotPaused {
        _deposit(amount);
    }

    /// @notice Single-transaction deposit using ERC-2612 permit.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external whenNotPaused {
        // Front-running a permit call cannot steal funds; ignore failures so a
        // griefed (pre-consumed) permit still lets the deposit succeed.
        try IERC20Permit(address(alpha)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(amount);
    }

    function _deposit(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        alpha.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // -------------------------------------------------------------- withdrawals

    /// @notice Redeem a server-signed withdrawal voucher. Anyone may submit; tokens
    ///         go to the voucher's `to`. All game-side gates were applied before the
    ///         voucher was signed.
    function withdraw(address to, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert Expired();
        if (usedNonce[nonce]) revert NonceUsed();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(WITHDRAWAL_TYPEHASH, to, amount, nonce, deadline)));
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();

        usedNonce[nonce] = true;
        _bumpWindow(amount);
        alpha.safeTransfer(to, amount);
        emit Withdrawn(to, amount, nonce);
    }

    /// @dev Leaky bucket: the bucket drains at windowCap/WINDOW per second, so total
    ///      withdrawals across any rolling WINDOW cannot exceed windowCap.
    function _bumpWindow(uint256 amount) internal {
        uint256 drained = (windowCap * (block.timestamp - lastDrain)) / WINDOW;
        bucket = drained >= bucket ? 0 : bucket - drained;
        lastDrain = block.timestamp;

        bucket += amount;
        if (bucket > windowCap) revert WindowCapExceeded();
    }

    // -------------------------------------------------------------------- views

    /// @notice On-chain reserve backing the game ledger's withdrawable liabilities.
    function reserve() external view returns (uint256) {
        return alpha.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------- ops

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "signer=0");
        require(newSigner != owner(), "signer==owner");
        signer = newSigner;
        emit SignerChanged(newSigner);
    }

    function setWindowCap(uint256 newCap) external onlyOwner {
        require(newCap > 0, "cap=0"); // use pause() to stop withdrawals, not a 0 cap
        // drain at the OLD rate first, so a cap change cannot retroactively rewrite
        // how much of the current bucket has already leaked away
        uint256 drained = (windowCap * (block.timestamp - lastDrain)) / WINDOW;
        bucket = drained >= bucket ? 0 : bucket - drained;
        lastDrain = block.timestamp;

        windowCap = newCap;
        emit WindowCapChanged(newCap);
    }

    /// @dev Disabled: renouncing would permanently remove the ability to pause or
    ///      rotate a compromised signer key — with a paused contract, that would
    ///      freeze the entire reserve forever.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

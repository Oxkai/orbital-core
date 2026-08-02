// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";

import {OrbitalHook} from "../src/OrbitalHook.sol";
import {TickLib} from "../src/libraries/TickLib.sol";

/// @notice Lifecycle simulation on the live Monad testnet pool, kept near peg:
///         swaps -> seed again (new tick) -> swaps. Swaps are small relative to
///         the interior radius and roughly balanced, so reserves barely move and
///         no tick crosses to boundary (kBound stays 0).
///
/// @dev forge script script/SeedActivity.s.sol --rpc-url monad_testnet \
///          --broadcast --slow --private-key $PRIVATE_KEY
contract SeedActivityScript is Script {
    // Defaults are the live Monad testnet deployment (Deploy.s.sol +
    // DeployPeriphery.s.sol output). Override per chain with env vars:
    //   HOOK=0x… ROUTER=0x… forge script script/SeedActivity.s.sol …
    address internal constant DEFAULT_HOOK = 0x63deB95aFa4EED08271831750059CD4e42e76A88;
    address internal constant DEFAULT_ROUTER = 0xC30819b8ac12B5d12751b83cFfebD6F0bFa0b53E;

    uint8 internal constant N = 4;

    OrbitalHook internal hook;
    IUniswapV4Router04 internal router;

    // Registered assets, read off the hook rather than pinned to addresses that
    // go stale on every redeploy.
    address internal A;
    address internal B;
    address internal C;
    address internal D;

    function run() external {
        hook = OrbitalHook(vm.envOr("HOOK", DEFAULT_HOOK));
        router = IUniswapV4Router04(payable(vm.envOr("ROUTER", DEFAULT_ROUTER)));

        A = Currency.unwrap(hook.assetAt(0));
        B = Currency.unwrap(hook.assetAt(1));
        C = Currency.unwrap(hook.assetAt(2));
        D = Currency.unwrap(hook.assetAt(3));
        address[4] memory toks = [A, B, C, D];

        vm.startBroadcast();
        for (uint256 i = 0; i < 4; ++i) {
            IERC20(toks[i]).approve(address(router), type(uint256).max);
            IERC20(toks[i]).approve(address(hook), type(uint256).max);
        }

        console2.log("--- T0: seeded (4 concentrated tiers) ---");
        _logState();

        // T1 — first wave: small, near-balanced swaps (volume + tiny skew, near peg).
        _swap(A, B, 12_000 ether);
        _swap(B, A, 9_000 ether);
        _swap(C, D, 10_000 ether);
        _swap(D, C, 8_000 ether);
        _swap(A, C, 7_000 ether);
        _swap(B, D, 6_000 ether);
        console2.log("--- T1: after first swap wave ---");
        _logState();

        // T2 — seed again: add a fifth tick at a fresh depeg bound (pool still
        // near peg + all-interior, so the mint is valid and pro-rata).
        _seedTier(2_000_000 ether, 0.88e18);
        console2.log("--- T2: re-seeded (new tick added) ---");
        _logState();

        // T3 — second wave: more small near-balanced swaps.
        _swap(C, A, 8_000 ether);
        _swap(D, B, 7_000 ether);
        _swap(A, D, 6_000 ether);
        _swap(B, C, 9_000 ether);
        _swap(C, B, 7_000 ether);

        vm.stopBroadcast();

        console2.log("--- final state (near peg, no crossing) ---");
        _logState();
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn) internal {
        (address c0, address c1) = tokenIn < tokenOut ? (tokenIn, tokenOut) : (tokenOut, tokenIn);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 0,
            tickSpacing: 1,
            hooks: IHooks(address(hook))
        });
        router.swapExactTokensForTokens(amountIn, 0, tokenIn == c0, key, "", msg.sender, block.timestamp + 7200);
    }

    function _seedTier(uint256 rWad, uint256 depegWad) internal {
        uint256 k = TickLib.kFromDepegPrice(rWad, N, depegWad);
        uint256[] memory maxA = new uint256[](N);
        for (uint256 i = 0; i < N; ++i) maxA[i] = type(uint256).max;
        hook.addLiquidity(k, rWad, maxA);
    }

    function _logState() internal view {
        (uint256 sumX, , uint256 rInt, uint256 kBound,) = hook.slot0();
        console2.log("  numTicks:", hook.numTicks(), "rInt:", rInt);
        console2.log("  sumX(TVL):", sumX, "kBound:", kBound);
        for (uint8 i = 0; i < N; ++i) {
            console2.log("  reserve", i, hook.reserves(i));
        }
    }
}

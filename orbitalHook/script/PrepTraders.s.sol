// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {OrbitalHook} from "../src/OrbitalHook.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Pre-fund, mint and approve for the SimulateSwaps traders.
///
/// @dev    SimulateSwaps mints, approves and swaps inside one broadcast batch.
///         Chains whose RPC estimates a queued transaction against pre-batch
///         state reject the swap, because the mint it depends on has not landed
///         yet. Running this first leaves every trader already funded and
///         approved, so each swap is a single independent transaction.
///
///         Uses the same key derivation and mint buffer as SimulateSwaps.
///
///         Required env: ORBITAL_HOOK, V4_ROUTER
///         Optional env: GAS_PER_ACTOR (wei, default 0.05 ether)
contract PrepTradersScript is Script {
    uint256 constant TRADERS = 5;
    uint256 constant MINT_BUFFER_USD = 20_000;

    function run() external {
        OrbitalHook hook = OrbitalHook(vm.envAddress("ORBITAL_HOOK"));
        address router = vm.envAddress("V4_ROUTER");
        uint256 gasPerActor = vm.envOr("GAS_PER_ACTOR", uint256(0.05 ether));

        uint8 n = hook.N();
        address[] memory toks = new address[](n);
        uint8[] memory decs = new uint8[](n);
        for (uint8 i = 0; i < n; ++i) {
            toks[i] = Currency.unwrap(hook.assetAt(i));
            decs[i] = IERC20(toks[i]).decimals();
        }

        for (uint256 t = 0; t < TRADERS; ++t) {
            uint256 pk = uint256(keccak256(abi.encode("orbital.live.trader", t)));
            address me = vm.addr(pk);

            if (me.balance < gasPerActor) {
                vm.broadcast();
                (bool ok,) = me.call{value: gasPerActor - me.balance}("");
                require(ok, "gas funding failed");
            }

            for (uint8 i = 0; i < n; ++i) {
                uint256 buffer = MINT_BUFFER_USD * (10 ** uint256(decs[i]));
                if (IERC20(toks[i]).balanceOf(me) < buffer) {
                    vm.broadcast(pk);
                    IMintable(toks[i]).mint(me, buffer);
                }
                if (IERC20(toks[i]).allowance(me, router) != type(uint256).max) {
                    vm.broadcast(pk);
                    IERC20(toks[i]).approve(router, type(uint256).max);
                }
            }
            console2.log("  trader ready", me);
        }
    }
}

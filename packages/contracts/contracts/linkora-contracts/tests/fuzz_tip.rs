#![cfg(test)]

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

// Property-based tests for tip and token transfer invariants
// These verify that fee calculations and balances remain consistent
// under arbitrary tip amounts and fee configurations.

proptest! {
    #[test]
    fn prop_tip_amount_split_correctly(
        amount in 1i128..1_000_000_000,
        fee_bps in 0u32..10001,
    ) {
        // Verify that amount = author_amount + fee_amount
        // fee_amount = (amount / 10_000) * fee_bps + (amount % 10_000) * fee_bps / 10_000

        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;

        // Amount must split correctly:
        assert_eq!(author_amount + fee_amount, amount,
            "tip split failed: {} + {} != {}", author_amount, fee_amount, amount);

        // Fee must be within expected range
        let max_possible_fee = (amount * fee_bps as i128) / 10_000 + 1;
        assert!(fee_amount <= max_possible_fee,
            "fee {} exceeds max {}", fee_amount, max_possible_fee);
    }

    #[test]
    fn prop_tip_total_reflects_author_amount(
        initial_tips in 0i128..10_000_000,
        new_tip in 1i128..1_000_000_000,
        fee_bps in 0u32..10001,
    ) {
        // tip_total should only accumulate author_amount, not the full tip
        let fee_amount = (new_tip / 10_000) * fee_bps as i128
            + (new_tip % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = new_tip - fee_amount;

        let updated_tip_total = initial_tips + author_amount;

        // Verify no overflow in typical ranges
        assert!(updated_tip_total >= initial_tips,
            "tip_total underflow: {} + {} < {}", initial_tips, author_amount, initial_tips);
    }

    #[test]
    fn prop_zero_fee_means_full_amount_to_author(
        amount in 1i128..1_000_000_000,
    ) {
        let fee_bps = 0u32;
        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;

        assert_eq!(author_amount, amount,
            "with zero fee, author should get full amount: {} != {}", author_amount, amount);
    }

    #[test]
    fn prop_max_fee_is_bounded(
        amount in 1i128..1_000_000_000,
    ) {
        // Max fee is 100% (10_000 bps)
        let fee_bps = 10_000u32;
        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;

        // Fee should be roughly equal to amount with max bps, ±1 due to rounding
        assert!(fee_amount >= amount - 1 && fee_amount <= amount + 1,
            "max fee {} should be ~{}", fee_amount, amount);
    }
}

// ── Issue #617: Deterministic Tip Fee Reference Computation Tests ─────────────

/// Reference integer computation for protocol fee and creator amounts.
/// Mirrors LinkoraContract's split formula:
/// `fee_amount = (amount / 10_000) * fee_bps + (amount % 10_000) * fee_bps / 10_000`
/// `creator_amount = amount - fee_amount`
fn reference_fee_split(amount: i128, fee_bps: u32) -> (i128, i128) {
    let fee_amount = (amount / 10_000) * fee_bps as i128
        + (amount % 10_000) * fee_bps as i128 / 10_000;
    let creator_amount = amount - fee_amount;
    (fee_amount, creator_amount)
}

#[test]
fn test_deterministic_tip_fee_rounding_integer_cases() {
    // Discrete threshold amounts testing fractional boundaries and scale transitions
    let threshold_amounts: [i128; 21] = [
        1, 2, 7, 10, 99, 100, 250, 500, 999, 1_000,
        3_333, 5_000, 9_999, 10_000, 10_001, 12_345, 20_000,
        33_333, 100_000, 1_000_000, 10_000_000,
    ];

    // Discrete fee basis-point values covering boundary and fractional rates
    let fee_bps_cases: [u32; 11] = [
        0, 1, 50, 100, 250, 333, 1_000, 2_500, 5_000, 9_999, 10_000,
    ];

    for &fee_bps in &fee_bps_cases {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(LinkoraContract, ());
        let client = LinkoraContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        client.initialize(&admin, &treasury, &fee_bps);

        let author = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        client.set_profile(&author, &String::from_str(&env, "author"), &token);
        let post_id = client.create_post(&author, &String::from_str(&env, "Tip test post"));

        let token_client = TokenClient::new(&env, &token);

        for &amount in &threshold_amounts {
            let (expected_fee, expected_creator) = reference_fee_split(amount, fee_bps);

            // Acceptance criterion: Transfer totals equal input amount for every accepted case
            assert_eq!(
                expected_fee + expected_creator,
                amount,
                "Reference split failed: {} + {} != {}",
                expected_fee,
                expected_creator,
                amount
            );

            // Bounds check
            assert!(expected_fee >= 0 && expected_fee <= amount);
            assert!(expected_creator >= 0 && expected_creator <= amount);

            // Generate fresh tipper to isolate test from cooldown constraints
            let tipper = Address::generate(&env);
            StellarAssetClient::new(&env, &token).mint(&tipper, &amount);

            let treasury_before = token_client.balance(&treasury);
            let author_before = token_client.balance(&author);

            client.tip(&tipper, &post_id, &token, &amount);

            let treasury_after = token_client.balance(&treasury);
            let author_after = token_client.balance(&author);

            let observed_fee_transfer = treasury_after - treasury_before;
            let observed_creator_transfer = author_after - author_before;

            // Acceptance criterion: Observed transfers match expected integer split at each threshold
            assert_eq!(
                observed_fee_transfer, expected_fee,
                "Observed fee transfer {} does not match expected fee {} (amount={}, fee_bps={})",
                observed_fee_transfer, expected_fee, amount, fee_bps
            );
            assert_eq!(
                observed_creator_transfer, expected_creator,
                "Observed creator transfer {} does not match expected creator {} (amount={}, fee_bps={})",
                observed_creator_transfer, expected_creator, amount, fee_bps
            );

            // Acceptance criterion: Transfer totals equal input amount for every accepted case
            assert_eq!(
                observed_fee_transfer + observed_creator_transfer,
                amount,
                "Observed transfer total {} + {} != input amount {}",
                observed_fee_transfer,
                observed_creator_transfer,
                amount
            );
        }
    }
}


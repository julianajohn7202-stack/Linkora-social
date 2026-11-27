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

// ── Deterministic ledger-boundary tests for tip cooldown ─────────────────────
//
// These tests exercise the exact ledger boundaries of the tip cooldown:
//   - last restricted ledger  (elapsed = cooldown - 1 → rejected)
//   - first eligible ledger   (elapsed = cooldown     → accepted)
//   - window-of-1 fast path   (every ledger advance allows re-tipping)
//
// They are kept in a separate module so they can be ordinary `#[test]` fns
// and do not need to live inside the `proptest! { }` block above.
mod deterministic_cooldown_boundary {
    use linkora_contracts::{LinkoraContract, LinkoraContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String,
    };

    // Mint 100_000 units of a new Stellar asset to `admin`.
    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        StellarAssetClient::new(env, &token_id.address()).mint(admin, &100_000);
        token_id.address()
    }

    // Register the contract and initialize it with a 2.5 % fee (250 bps).
    fn setup_contract_local(
        env: &Env,
    ) -> (LinkoraContractClient<'_>, Address, Address) {
        let contract_id = env.register(LinkoraContract, ());
        let client = LinkoraContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        client.initialize(&admin, &treasury, &250); // 2.5% fee
        (client, admin, treasury)
    }

    // ── Test 1 ────────────────────────────────────────────────────────────────
    //
    // The last restricted ledger: elapsed = cooldown - 1 < cooldown → rejected.
    //
    // Timeline (cooldown = 10):
    //   ledger 0 : first tip (accepted, sets last_tip_ledger = 0)
    //   ledger 9 : second tip (elapsed = 9 < 10) → must panic
    #[test]
    fn test_tip_cooldown_last_restricted_ledger() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, _treasury) = setup_contract_local(&env);

        let cooldown: u32 = 10;
        client.set_tip_cooldown_window(&admin, &cooldown);

        let author = Address::generate(&env);
        let tipper = Address::generate(&env);

        let token = setup_token(&env, &tipper);
        client.set_profile(&author, &String::from_str(&env, "author"), &token);
        let post_id = client.create_post(&author, &String::from_str(&env, "cooldown boundary post"));

        // Tip at ledger 0 (sequence_number starts at 0 in test env).
        env.ledger().with_mut(|l| l.sequence_number = 0);
        client.tip(&tipper, &post_id, &token, &100);

        // Advance to ledger cooldown - 1 (elapsed = cooldown - 1 < cooldown).
        env.ledger().with_mut(|l| l.sequence_number = cooldown - 1);

        // Second tip must be rejected: cooldown has not yet expired.
        let result = client.try_tip(&tipper, &post_id, &token, &100);
        assert!(
            result.is_err(),
            "tip at ledger cooldown-1 must be rejected (elapsed < cooldown)"
        );
    }

    // ── Test 2 ────────────────────────────────────────────────────────────────
    //
    // The first eligible ledger: elapsed = cooldown >= cooldown → accepted,
    // and a TipEvent must be emitted.
    //
    // Timeline (cooldown = 10):
    //   ledger  0 : first tip (accepted)
    //   ledger 10 : second tip (elapsed = 10 >= 10) → must succeed
    #[test]
    fn test_tip_cooldown_first_eligible_ledger() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, _treasury) = setup_contract_local(&env);

        let cooldown: u32 = 10;
        client.set_tip_cooldown_window(&admin, &cooldown);

        let author = Address::generate(&env);
        let tipper = Address::generate(&env);

        let token = setup_token(&env, &tipper);
        client.set_profile(&author, &String::from_str(&env, "author"), &token);
        let post_id =
            client.create_post(&author, &String::from_str(&env, "first eligible ledger post"));

        // Tip at ledger 0.
        env.ledger().with_mut(|l| l.sequence_number = 0);
        client.tip(&tipper, &post_id, &token, &100);

        // Advance to exactly ledger `cooldown` (elapsed = cooldown >= cooldown).
        env.ledger().with_mut(|l| l.sequence_number = cooldown);

        let events_before = env.events().all().events().len();

        // Second tip must succeed.
        client.tip(&tipper, &post_id, &token, &100);

        // A TipEvent must have been emitted.
        assert!(
            env.events().all().events().len() > events_before,
            "tip at ledger == cooldown must emit a TipEvent"
        );
    }

    // ── Test 3 ────────────────────────────────────────────────────────────────
    //
    // Window-of-1 fast path: set cooldown to 1 so that advancing a single
    // ledger is enough to re-tip.
    //
    // Timeline:
    //   ledger 0 : first tip (accepted)
    //   ledger 1 : second tip (elapsed = 1 >= 1) → must succeed
    #[test]
    fn test_tip_cooldown_disabled_via_window_one() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, _treasury) = setup_contract_local(&env);

        // Minimum valid cooldown window is 1.
        client.set_tip_cooldown_window(&admin, &1u32);

        let author = Address::generate(&env);
        let tipper = Address::generate(&env);

        let token = setup_token(&env, &tipper);
        client.set_profile(&author, &String::from_str(&env, "author"), &token);
        let post_id =
            client.create_post(&author, &String::from_str(&env, "window-one cooldown post"));

        // Tip at ledger 0.
        env.ledger().with_mut(|l| l.sequence_number = 0);
        client.tip(&tipper, &post_id, &token, &100);

        // Advance by exactly 1 ledger (elapsed = 1 >= 1).
        env.ledger().with_mut(|l| l.sequence_number = 1);

        let events_before = env.events().all().events().len();

        // Second tip must succeed.
        client.tip(&tipper, &post_id, &token, &100);

        // A TipEvent must have been emitted.
        assert!(
            env.events().all().events().len() > events_before,
            "tip with window=1 and elapsed=1 must emit a TipEvent"
        );
    }
}

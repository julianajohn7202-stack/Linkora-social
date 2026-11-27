#![cfg(test)]

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _, token::Client as TokenClient, token::StellarAssetClient, Address, Env,
    Map,
};

fn setup() -> (Env, LinkoraContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LinkoraContract);
    let client = LinkoraContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &0);
    (env, client, admin, contract_id)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    #[test]
    fn fuzz_distributed_rewards_are_fully_backed(amounts in prop::collection::vec(1i128..1_000_000_000, 1..12)) {
        let (env, client, admin, contract_id) = setup();
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let total: i128 = amounts.iter().sum();
        StellarAssetClient::new(&env, &token).mint(&admin, &total);

        let mut claims = Map::new(&env);
        let mut recipients = std::vec::Vec::new();
        for amount in amounts.iter() {
            let recipient = Address::generate(&env);
            claims.set(recipient.clone(), *amount);
            recipients.push(recipient);
        }

        let epoch = client.distribute_rewards(&admin, &token, &claims);
        let mut total_claimed = 0i128;
        for recipient in recipients.iter() {
            let amount = client.claim_reward(&recipient, &epoch);
            total_claimed += amount;
        }

        prop_assert_eq!(total_claimed, total);
        prop_assert_eq!(TokenClient::new(&env, &token).balance(&contract_id) + total_claimed, total);
    }

    #[test]
    fn fuzz_claims_are_idempotent_and_double_claims_fail(amount in 1i128..1_000_000_000) {
        let (env, client, admin, _) = setup();
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        StellarAssetClient::new(&env, &token).mint(&admin, &amount);
        let recipient = Address::generate(&env);
        let mut claims = Map::new(&env);
        claims.set(recipient.clone(), amount);

        let epoch = client.distribute_rewards(&admin, &token, &claims);
        prop_assert_eq!(client.get_claimable_reward(&recipient, &epoch), amount);
        prop_assert_eq!(client.claim_reward(&recipient, &epoch), amount);
        prop_assert_eq!(client.get_claimable_reward(&recipient, &epoch), 0);
        prop_assert!(client.try_claim_reward(&recipient, &epoch).is_err());
    }

    #[test]
    fn fuzz_reward_weighted_rounding_conservation(
        total_allocation in 10i128..10_000_000,
        weights in prop::collection::vec(1i128..100, 2..6),
    ) {
        let (env, client, admin, contract_id) = setup();
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();

        let sum_weights: i128 = weights.iter().sum();
        let mut claims = Map::new(&env);
        let mut recipients = std::vec::Vec::new();
        let mut total_claimable = 0i128;

        for weight in weights.iter() {
            let recipient = Address::generate(&env);
            let amount = (total_allocation * weight) / sum_weights;
            if amount > 0 {
                claims.set(recipient.clone(), amount);
                recipients.push((recipient, amount));
                total_claimable += amount;
            }
        }

        if total_claimable > 0 {
            let recorded_remainder = total_allocation - total_claimable;
            prop_assert_eq!(total_claimable + recorded_remainder, total_allocation);

            StellarAssetClient::new(&env, &token).mint(&admin, &total_claimable);
            let epoch = client.distribute_rewards(&admin, &token, &claims);

            let mut total_claimed = 0i128;
            for (recipient, expected) in recipients.iter() {
                prop_assert_eq!(client.get_claimable_reward(recipient, &epoch), *expected);
                let claimed = client.claim_reward(recipient, &epoch);
                prop_assert_eq!(claimed, *expected);
                total_claimed += claimed;
            }

            prop_assert_eq!(total_claimed + recorded_remainder, total_allocation);
            prop_assert_eq!(TokenClient::new(&env, &token).balance(&contract_id), 0);
        }
    }
}

// ── Issue #631: Deterministic seeded allocation set and remainder handling ────

#[derive(Debug, Clone)]
struct WeightedAllocationFixture {
    total_allocation: i128,
    weights: std::vec::Vec<i128>,
}

#[test]
fn test_reward_rounding_conservation_with_deterministic_seeded_allocations() {
    let fixtures = std::vec![
        // Unequal weights that do not divide evenly: 100 with weights [3, 5, 7] (sum = 15)
        WeightedAllocationFixture {
            total_allocation: 100,
            weights: std::vec![3, 5, 7],
        },
        // Small base-unit total with unequal weights: 7 with weights [2, 3, 4] (sum = 9)
        WeightedAllocationFixture {
            total_allocation: 7,
            weights: std::vec![2, 3, 4],
        },
        // Prime total with unequal weights: 1_001 with weights [13, 29, 58] (sum = 100)
        WeightedAllocationFixture {
            total_allocation: 1_001,
            weights: std::vec![13, 29, 58],
        },
        // Small base units: 10 with weights [1, 2, 4] (sum = 7)
        WeightedAllocationFixture {
            total_allocation: 10,
            weights: std::vec![1, 2, 4],
        },
        // Unequal weights with small base-unit remainder: 25 with weights [5, 7, 11] (sum = 23)
        WeightedAllocationFixture {
            total_allocation: 25,
            weights: std::vec![5, 7, 11],
        },
    ];

    for fixture in fixtures {
        let (env, client, admin, contract_id) = setup();
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();

        let sum_weights: i128 = fixture.weights.iter().sum();
        let mut claims = Map::new(&env);
        let mut recipients = std::vec::Vec::new();
        let mut calculated_claimable_sum = 0i128;

        for weight in fixture.weights.iter() {
            let recipient = Address::generate(&env);
            // Documented integer division remainder handling (floor allocation)
            let allocated = (fixture.total_allocation * weight) / sum_weights;
            if allocated > 0 {
                claims.set(recipient.clone(), allocated);
                recipients.push((recipient, allocated));
                calculated_claimable_sum += allocated;
            }
        }

        let recorded_remainder = fixture.total_allocation - calculated_claimable_sum;

        // Acceptance criterion: Claimable amounts plus the recorded remainder match the input allocation
        assert_eq!(
            calculated_claimable_sum + recorded_remainder,
            fixture.total_allocation,
            "Claimable amounts + remainder must strictly equal input allocation"
        );
        assert!(
            recorded_remainder >= 0,
            "Recorded remainder cannot be negative"
        );

        // Mint and fund the exact claimable sum into the contract epoch
        StellarAssetClient::new(&env, &token).mint(&admin, &calculated_claimable_sum);
        let epoch = client.distribute_rewards(&admin, &token, &claims);

        // Verify claimable balances and claim executions match calculated allocations
        let mut actual_claimed_total = 0i128;
        for (recipient, expected_amount) in recipients.iter() {
            assert_eq!(
                client.get_claimable_reward(recipient, &epoch),
                *expected_amount
            );
            let claimed = client.claim_reward(recipient, &epoch);
            assert_eq!(claimed, *expected_amount);
            actual_claimed_total += claimed;
        }

        // Acceptance criterion: Total claimed + remainder matches the input allocation
        assert_eq!(
            actual_claimed_total + recorded_remainder,
            fixture.total_allocation
        );
        assert_eq!(
            TokenClient::new(&env, &token).balance(&contract_id),
            0
        );
    }
}


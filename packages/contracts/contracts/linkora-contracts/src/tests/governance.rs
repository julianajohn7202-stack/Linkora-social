use super::super::test::*;
use crate::GovParameter;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

#[test]
#[should_panic(expected = "authority_pubkey must not be an all-zero or malformed public key")]
fn test_set_credential_authority_zero_pubkey_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);
    let zero_pubkey = BytesN::from_array(&env, &[0u8; 32]);

    client.set_credential_authority(&admin, &zero_pubkey);
}

#[test]
#[should_panic(expected = "new_root must not be an all-zero or malformed public key")]
fn test_update_credential_root_zero_root_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = Address::generate(&env);
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);
    let dummy_sig = BytesN::from_array(&env, &[1u8; 64]);

    client.update_credential_root(&user, &zero_root, &dummy_sig);
}

#[test]
#[should_panic(expected = "signature must not be an all-zero or malformed signature")]
fn test_update_credential_root_zero_signature_rejected_governance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = Address::generate(&env);
    let new_root = BytesN::from_array(&env, &[9u8; 32]);
    let zero_signature = BytesN::from_array(&env, &[0u8; 64]);

    client.update_credential_root(&user, &new_root, &zero_signature);
}

// ── Issue #115: Governance vote replay prevention and overwrite behavior ──────────

/// Test Issue #115: Governance vote replay prevention and overwrite behavior.
///
/// Specification & Behavior Definition:
/// - Replay / Overwrite Policy: Rejection by Panic ("already voted").
///   When a voter submits a second vote on the same proposal from the same address,
///   the contract strictly REJECTS the vote (panics with "already voted") rather than
///   replacing or updating the previous vote.
/// - Vote Count Consistency:
///   Because the second vote is rejected, the proposal's vote tally (`votes_for`, `votes_against`)
///   remains strictly consistent with the initial valid vote. The second attempt does not alter,
///   increment, or decrement existing counts.
#[test]
fn test_vote_overwrite_behavior() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _) = setup_governance(&env);

    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "proposer_gov_t"), &token);
    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &500, &None);

    let voter1 = Address::generate(&env);

    // Initial state: proposal starts with 0 votes for and 0 votes against
    let initial_proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(initial_proposal.votes_for, 0);
    assert_eq!(initial_proposal.votes_against, 0);

    // 1. Cast first vote: voter1 votes FOR the proposal
    client.gov_vote(&voter1, &proposal_id, &true);

    let proposal_after_first = client.gov_get_proposal(&proposal_id);
    assert_eq!(proposal_after_first.votes_for, 1);
    assert_eq!(proposal_after_first.votes_against, 0);

    // 2. Second vote attempt: voter1 attempts to vote again with support = false.
    // The contract must reject the second vote with a panic ("already voted").
    // With `try_gov_vote`, the error is safely caught and asserted.
    let second_vote_res = client.try_gov_vote(&voter1, &proposal_id, &false);
    assert!(
        second_vote_res.is_err(),
        "Second vote from same address must be rejected with error"
    );

    // 3. Assert vote counts remain strictly consistent and unchanged
    let proposal_after_second = client.gov_get_proposal(&proposal_id);
    assert_eq!(
        proposal_after_second.votes_for, 1,
        "votes_for count must remain 1 after rejected vote replay"
    );
    assert_eq!(
        proposal_after_second.votes_against, 0,
        "votes_against count must remain 0 after rejected vote replay"
    );

    // 4. Verify that another voter can legitimately vote AGAINST
    let voter2 = Address::generate(&env);
    client.gov_vote(&voter2, &proposal_id, &false);

    let proposal_after_voter2 = client.gov_get_proposal(&proposal_id);
    assert_eq!(proposal_after_voter2.votes_for, 1);
    assert_eq!(proposal_after_voter2.votes_against, 1);

    // Voter 2 also cannot replay or overwrite their vote to true
    let voter2_second_vote_res = client.try_gov_vote(&voter2, &proposal_id, &true);
    assert!(
        voter2_second_vote_res.is_err(),
        "Second vote from voter 2 must be rejected"
    );

    let final_proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(final_proposal.votes_for, 1);
    assert_eq!(final_proposal.votes_against, 1);
}

/// Test Issue #115: Voting on a non-existent proposal panics with "proposal not found".
#[test]
#[should_panic(expected = "proposal not found")]
fn test_vote_non_existent_proposal_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _) = setup_governance(&env);

    let voter = Address::generate(&env);
    let non_existent_proposal_id: u64 = 999_999;

    client.gov_vote(&voter, &non_existent_proposal_id, &true);
}

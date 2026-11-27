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

// ── Governance finalization deadline boundary tests ───────────────────────────

/// At `created_ledger + vote_window` the vote window is still open (boundary is
/// inclusive: `current_ledger <= vote_end`), so voting must succeed and
/// finalization must be rejected because the strictly-greater condition
/// (`current_ledger > vote_end`) is not yet satisfied.
#[test]
fn test_gov_finalize_on_last_vote_ledger_is_still_open() {
    use crate::GovStatus;

    let env = Env::default();
    env.mock_all_auths();
    // setup_governance configures vote_window = 200.
    let (client, _admin, _) = setup_governance(&env);

    // Env starts at sequence 0; proposal is created at ledger 0.
    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "proposer_deadline"), &token);
    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &500, &None);

    let proposal = client.gov_get_proposal(&proposal_id);
    let created_ledger = proposal.created_ledger;
    let vote_window = proposal.vote_window_ledgers;

    // Advance to exactly created_ledger + vote_window (the last ledger where
    // voting is still open and finalization is not yet allowed).
    let boundary_ledger = created_ledger + vote_window;
    env.ledger().with_mut(|l| l.sequence_number = boundary_ledger);

    // Voting must still be accepted at the boundary ledger.
    let voter = Address::generate(&env);
    client.gov_vote(&voter, &proposal_id, &true);
    let proposal_after_vote = client.gov_get_proposal(&proposal_id);
    assert_eq!(
        proposal_after_vote.votes_for, 1,
        "vote cast at the boundary ledger must be counted"
    );

    // Finalization must fail because current_ledger == vote_end, which does
    // not satisfy the strictly-greater condition (current_ledger > vote_end).
    let finalize_result = client.try_gov_finalize(&proposal_id);
    assert!(
        finalize_result.is_err(),
        "gov_finalize must return Err when called at created_ledger + vote_window (vote window not yet closed)"
    );

    // Proposal status must remain Active — no premature state change.
    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Active,
        "proposal status must remain Active when finalization is attempted too early"
    );
}

/// At `created_ledger + vote_window + 1` the vote window is closed and
/// `current_ledger > vote_end` is satisfied, so `gov_finalize` must succeed
/// and return `GovStatus::Passed` when the FOR votes exceed quorum.
#[test]
fn test_gov_finalize_on_first_finalizable_ledger_succeeds() {
    use crate::GovStatus;

    let env = Env::default();
    env.mock_all_auths();
    // setup_governance configures quorum=60, vote_window=200.
    let (client, _admin, _) = setup_governance(&env);

    // Env starts at sequence 0; proposal is created at ledger 0.
    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "proposer_first_fin"), &token);
    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &500, &None);

    let proposal = client.gov_get_proposal(&proposal_id);
    let created_ledger = proposal.created_ledger;
    let vote_window = proposal.vote_window_ledgers;

    // Cast 3 FOR votes and 1 AGAINST vote while still within the vote window
    // (ledger 0, the creation ledger, satisfies current_ledger <= vote_end).
    // 3 FOR out of 4 total = 75% approval, which exceeds quorum=60.
    let voter_for_1 = Address::generate(&env);
    let voter_for_2 = Address::generate(&env);
    let voter_for_3 = Address::generate(&env);
    let voter_against = Address::generate(&env);

    client.gov_vote(&voter_for_1, &proposal_id, &true);
    client.gov_vote(&voter_for_2, &proposal_id, &true);
    client.gov_vote(&voter_for_3, &proposal_id, &true);
    client.gov_vote(&voter_against, &proposal_id, &false);

    // Advance to the first ledger where finalization is allowed:
    // current_ledger > vote_end, i.e. created_ledger + vote_window + 1.
    let first_finalizable_ledger = created_ledger + vote_window + 1;
    env.ledger()
        .with_mut(|l| l.sequence_number = first_finalizable_ledger);

    // gov_finalize must succeed and return Passed.
    let status = client.gov_finalize(&proposal_id);
    assert_eq!(
        status,
        GovStatus::Passed,
        "gov_finalize must return GovStatus::Passed when FOR votes exceed quorum at the first finalizable ledger"
    );

    // Reading the proposal back must also reflect the updated status.
    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Passed,
        "proposal status persisted in storage must be GovStatus::Passed after finalization"
    );
}

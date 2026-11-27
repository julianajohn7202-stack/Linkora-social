use super::super::test::*;
use crate::{GovParameter, GovStatus};
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

// ── Issue #622: Typed status fixtures for governance proposal lifecycles ───────

/// A freshly created proposal must carry status Active.
#[test]
fn test_proposal_status_active_on_creation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _) = setup_governance(&env);

    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "prop_622a"), &token);

    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &300, &None);
    let proposal = client.gov_get_proposal(&proposal_id);

    assert_eq!(
        proposal.status,
        GovStatus::Active,
        "proposal status must be Active immediately after creation"
    );
}

/// A proposal that receives insufficient approval (below quorum floor) finalizes
/// as Failed.
#[test]
fn test_proposal_status_failed_below_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    // quorum=60, time_lock=100, vote_window=200, decay=50, floor=30
    let (client, _admin, _) = setup_governance(&env);

    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "prop_622b"), &token);

    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &300, &None);

    // 1 for, 4 against = 20 % approval — below the 30 % floor
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    let v4 = Address::generate(&env);
    let v5 = Address::generate(&env);
    client.gov_vote(&v1, &proposal_id, &true);
    client.gov_vote(&v2, &proposal_id, &false);
    client.gov_vote(&v3, &proposal_id, &false);
    client.gov_vote(&v4, &proposal_id, &false);
    client.gov_vote(&v5, &proposal_id, &false);

    // Advance past vote window so finalization is permitted
    env.ledger()
        .with_mut(|l| l.sequence_number += 201);

    let final_status = client.gov_finalize(&proposal_id);
    assert_eq!(
        final_status,
        GovStatus::Failed,
        "proposal must finalize as Failed when approval is below quorum"
    );

    let proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(proposal.status, GovStatus::Failed);
}

/// A proposal that meets quorum and survives the time-lock executes and reaches
/// status Executed.
#[test]
fn test_proposal_status_executed_after_passage() {
    let env = Env::default();
    env.mock_all_auths();
    // quorum=60, time_lock=100, vote_window=200, decay=50, floor=30
    let (client, admin, _) = setup_governance(&env);

    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "prop_622c"), &token);

    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &400, &None);

    // 3 for, 1 against = 75 % approval — meets quorum
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    let v4 = Address::generate(&env);
    client.gov_vote(&v1, &proposal_id, &true);
    client.gov_vote(&v2, &proposal_id, &true);
    client.gov_vote(&v3, &proposal_id, &true);
    client.gov_vote(&v4, &proposal_id, &false);

    // Advance past vote_window (200) + time_lock (100)
    env.ledger()
        .with_mut(|l| l.sequence_number += 301);

    client.gov_execute(&admin, &proposal_id);

    let proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        GovStatus::Executed,
        "proposal status must be Executed after successful execution"
    );
    // The parameter change must have taken effect
    assert_eq!(client.get_fee_bps(), 400);
}

/// A proposal that is vetoed during the time-lock window reaches status Vetoed
/// and cannot be executed afterward.
#[test]
fn test_proposal_status_vetoed_prevents_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _treasury) = setup_governance(&env);

    // Set up a pool with two admins for vetoing
    let pool_admin1 = Address::generate(&env);
    let pool_admin2 = Address::generate(&env);
    let pool_token = Address::generate(&env);
    let pool_id = soroban_sdk::symbol_short!("vetopool");
    let pool_admins = soroban_sdk::vec![&env, pool_admin1.clone(), pool_admin2.clone()];
    client.create_pool(&admin, &pool_id, &pool_token, &pool_admins, &2);

    let proposer = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&proposer, &String::from_str(&env, "prop_622d"), &token);

    let proposal_id = client.gov_propose(&proposer, &GovParameter::FeeBps, &500, &None);

    // Cast votes so the proposal would otherwise pass
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.gov_vote(&v1, &proposal_id, &true);
    client.gov_vote(&v2, &proposal_id, &true);

    // Advance into the time-lock window (past vote_window=200, before time_lock expires at 300)
    env.ledger()
        .with_mut(|l| l.sequence_number += 250);

    client.gov_veto(&pool_admins, &pool_id, &proposal_id);

    let proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        GovStatus::Vetoed,
        "proposal status must be Vetoed after a successful veto"
    );

    // Execution after a veto must be rejected
    env.ledger()
        .with_mut(|l| l.sequence_number += 100);
    let exec_result = client.try_gov_execute(&admin, &proposal_id);
    assert!(
        exec_result.is_err(),
        "executing a vetoed proposal must return an error"
    );
}

// ── Issue #621: Proposal quorum snapshots across configuration updates ──────────

/// Proposals snapshot the quorum at creation time. A configuration change after
/// proposal creation must not alter the quorum of the existing proposal, while a
/// new proposal created after the change must reflect the updated quorum.
///
/// Setup:
///   - Config A: quorum=60, vote_window=200, time_lock=100, decay=0, floor=0
///   - Proposal P1 is created under Config A  →  P1.quorum == 60
///   - Config is updated to quorum=80 (Config B)
///   - Proposal P2 is created under Config B  →  P2.quorum == 80
///   - Both proposals are voted on with the same fixed fixtures
///   - P1 is finalized: 65 % approval ≥ 60 → Passed
///   - P2 is finalized: 65 % approval < 80 → Failed
#[test]
fn test_quorum_snapshot_isolated_across_config_change() {
    let env = Env::default();
    env.mock_all_auths();

    // Config A: quorum=60, no decay, floor=0
    let (client, admin, _) = setup_contract(&env);
    client.gov_init_config(&admin, &60, &100, &200, &0, &0);

    // Create P1 under Config A — snapshots quorum=60
    let proposer1 = Address::generate(&env);
    let token1 = Address::generate(&env);
    client.set_profile(&proposer1, &String::from_str(&env, "prop_621a"), &token1);
    let p1 = client.gov_propose(&proposer1, &GovParameter::FeeBps, &100, &None);
    let p1_snapshot = client.gov_get_proposal(&p1);
    assert_eq!(
        p1_snapshot.quorum, 60,
        "P1 must snapshot quorum=60 from Config A"
    );

    // Update config to quorum=80 (Config B) — P1 must be unaffected
    client.gov_init_config(&admin, &80, &100, &200, &0, &0);

    // Create P2 under Config B — snapshots quorum=80
    let proposer2 = Address::generate(&env);
    let token2 = Address::generate(&env);
    client.set_profile(&proposer2, &String::from_str(&env, "prop_621b"), &token2);
    let p2 = client.gov_propose(&proposer2, &GovParameter::FeeBps, &200, &None);
    let p2_snapshot = client.gov_get_proposal(&p2);
    assert_eq!(
        p2_snapshot.quorum, 80,
        "P2 must snapshot quorum=80 from Config B"
    );

    // Fixed vote fixture: 13 for, 7 against = 65 % approval
    // 65 % ≥ 60 (P1 quorum) → P1 passes
    // 65 % < 80 (P2 quorum) → P2 fails
    for _ in 0..13 {
        let v = Address::generate(&env);
        client.gov_vote(&v, &p1, &true);
    }
    for _ in 0..7 {
        let v = Address::generate(&env);
        client.gov_vote(&v, &p1, &false);
    }

    for _ in 0..13 {
        let v = Address::generate(&env);
        client.gov_vote(&v, &p2, &true);
    }
    for _ in 0..7 {
        let v = Address::generate(&env);
        client.gov_vote(&v, &p2, &false);
    }

    // Advance past vote_window (200)
    env.ledger()
        .with_mut(|l| l.sequence_number += 201);

    let s1 = client.gov_finalize(&p1);
    let s2 = client.gov_finalize(&p2);

    assert_eq!(
        s1,
        GovStatus::Passed,
        "P1 must pass: 65 % approval meets its snapshotted quorum of 60"
    );
    assert_eq!(
        s2,
        GovStatus::Failed,
        "P2 must fail: 65 % approval does not meet its snapshotted quorum of 80"
    );

    // Verify persisted statuses match what gov_finalize returned
    assert_eq!(client.gov_get_proposal(&p1).status, GovStatus::Passed);
    assert_eq!(client.gov_get_proposal(&p2).status, GovStatus::Failed);
}

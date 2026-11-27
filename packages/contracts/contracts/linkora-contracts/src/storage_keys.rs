use soroban_sdk::{contracttype, Address, BytesN, String, Symbol};

/// Typed contract storage keys. Variant order is part of the deployed storage
/// encoding and must remain stable.
#[contracttype]
#[derive(Clone, PartialEq, Eq)]
pub enum StorageKey {
    Post(u64),
    Profile(Address),
    Following(Address),
    Followers(Address),
    Pool(Symbol),
    Like(u64, Address),
    AuthorPosts(Address),
    Blocks(Address),
    BlockedBy(Address),
    UsernameIndex(String),
    TipCooldown(u64, Address),
    PoolDepositCooldown(Symbol, Address),
    Edge(Address, Address),
    FollowingCount(Address),
    FollowersCount(Address),
    FollowingIdx(Address, u32),
    FollowersIdx(Address, u32),
    FollowingPos(Address, Address),
    FollowersPos(Address, Address),
    GraphMigrated(Address),
    DmPublicKey(Address),
    CredentialRoot(Address),
    NullifierSet(Address, BytesN<32>),
    CredentialAuthority,
    GovProposal(u64),
    GovVote(u64, Address),
    GovConfig,
    GovProposalCount,
    GovOpenProposalCount(Address),
    OracleKey(Symbol),
    AttestationNullifier(BytesN<32>),
    Report(u64, Address),
    ReportCount(u64),
    OpenReports(Address),
    DeletedPost(u64),
    DeletedProfile(Address),
    PostLikersCount(u64),
    PostLikersIdx(u64, u32),
    PostReportersIdx(u64, u32),
    PostTipCooldownsCount(u64),
    PostTipCooldownsIdx(u64, u32),
    UpgradeProposal,
    RewardEpoch,
    RewardClaimable(Address, u64),
    RewardClaimed(Address, u64),
    RewardToken(u64),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test::{setup_contract, setup_token};
    use crate::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Address, Env, String,
    };

    #[test]
    fn test_storage_class_persistent_ttl_advancement_and_renewal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup_contract(&env);
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        let username = String::from_str(&env, "alice_ttl");

        // Write persistent record: Profile
        client.set_profile(&user, &username, &token);
        let key = crate::StorageKey::Profile(user.clone());

        // Assert initial TTL extends to at least LEDGER_THRESHOLD
        let initial_ttl = env.as_contract(&client.address, || {
            env.storage().persistent().get_ttl(&key)
        });
        assert!(
            initial_ttl >= LEDGER_THRESHOLD,
            "initial persistent TTL {initial_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );

        // Advance ledger by named boundary
        const ADVANCE_LEDGERS: u32 = 1_000;
        env.ledger().with_mut(|l| l.sequence_number += ADVANCE_LEDGERS);

        let decayed_ttl = env.as_contract(&client.address, || {
            env.storage().persistent().get_ttl(&key)
        });
        assert_eq!(
            decayed_ttl,
            initial_ttl - ADVANCE_LEDGERS,
            "persistent TTL must decrease by exactly the advanced ledgers"
        );

        // Renew persistent record TTL via lookup / bump
        client.get_address_by_username(&username);
        let renewed_ttl = env.as_contract(&client.address, || {
            env.storage().persistent().get_ttl(&key)
        });
        assert!(
            renewed_ttl >= LEDGER_THRESHOLD,
            "renewed persistent TTL {renewed_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );
        assert!(
            renewed_ttl > decayed_ttl,
            "renewed persistent TTL must exceed decayed TTL"
        );
    }

    #[test]
    fn test_storage_class_instance_ttl_advancement_and_renewal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup_contract(&env);

        // Assert initial instance TTL
        let initial_ttl = env.as_contract(&client.address, || {
            env.storage().instance().get_ttl()
        });
        assert!(
            initial_ttl >= LEDGER_THRESHOLD,
            "initial instance TTL {initial_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );

        // Advance ledger
        const ADVANCE_LEDGERS: u32 = 1_000;
        env.ledger().with_mut(|l| l.sequence_number += ADVANCE_LEDGERS);

        let decayed_ttl = env.as_contract(&client.address, || {
            env.storage().instance().get_ttl()
        });
        assert_eq!(
            decayed_ttl,
            initial_ttl - ADVANCE_LEDGERS,
            "instance TTL must decrease by exactly the advanced ledgers"
        );

        // Mutating operation renews instance TTL via bump_instance
        client.set_fee(&admin, &150);
        let renewed_ttl = env.as_contract(&client.address, || {
            env.storage().instance().get_ttl()
        });
        assert!(
            renewed_ttl >= LEDGER_THRESHOLD,
            "renewed instance TTL {renewed_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );
        assert!(
            renewed_ttl > decayed_ttl,
            "renewed instance TTL must exceed decayed TTL"
        );
    }

    #[test]
    fn test_storage_class_temporary_ttl_advancement_and_renewal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup_contract(&env);
        let author = Address::generate(&env);
        let tipper = Address::generate(&env);
        let token = setup_token(&env, &tipper);

        client.set_profile(&author, &String::from_str(&env, "author_ttl"), &token);
        let post_id = client.create_post(&author, &String::from_str(&env, "post for tip ttl"));

        // Mutate to set temporary cooldown record
        client.tip(&tipper, &post_id, &token, &100);
        let cooldown_key = crate::StorageKey::TipCooldown(post_id, tipper.clone());

        // Assert initial temporary TTL
        let initial_ttl = env.as_contract(&client.address, || {
            env.storage().temporary().get_ttl(&cooldown_key)
        });
        assert!(
            initial_ttl >= LEDGER_THRESHOLD,
            "initial temporary TTL {initial_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );

        // Advance ledger past the cooldown window using existing named constant
        env.ledger().with_mut(|l| l.sequence_number += TIP_COOLDOWN_LEDGERS);

        let decayed_ttl = env.as_contract(&client.address, || {
            env.storage().temporary().get_ttl(&cooldown_key)
        });
        assert_eq!(
            decayed_ttl,
            initial_ttl - TIP_COOLDOWN_LEDGERS,
            "temporary TTL must decrease by TIP_COOLDOWN_LEDGERS"
        );

        // Second tip after cooldown renews temporary cooldown entry TTL via bump_temp
        client.tip(&tipper, &post_id, &token, &50);
        let renewed_ttl = env.as_contract(&client.address, || {
            env.storage().temporary().get_ttl(&cooldown_key)
        });
        assert!(
            renewed_ttl >= LEDGER_THRESHOLD,
            "renewed temporary TTL {renewed_ttl} must be >= LEDGER_THRESHOLD ({LEDGER_THRESHOLD})"
        );
        assert!(
            renewed_ttl > decayed_ttl,
            "renewed temporary TTL must exceed decayed TTL"
        );
    }
}

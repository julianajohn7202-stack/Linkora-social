//! Contract-specific error codes.
//!
//! `RentError` is used by the storage-rent/TTL guard path; `ContractError`
//! enumerates every domain error (profile, post, social graph, pool,
//! governance, moderation) returned across the contract's public API.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RentError {
    Expired = 1,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 100,
    NotInitialized = 101,
    UsernameTaken = 102,
    UsernameTooShort = 103,
    UsernameTooLong = 104,
    ContentTooLong = 105,
    ContentEmpty = 106,
    Blocked = 107,
    NotBlocked = 108,
    Unauthorized = 109,
    PostNotFound = 110,
    ProfileNotFound = 111,
    PoolNotFound = 112,
    PoolExists = 113,
    InvalidThreshold = 114,
    InsufficientSigners = 115,
    UnauthorizedSigner = 116,
    LowBalance = 117,
    WrongToken = 118,
    AlreadyPaused = 119,
    NotPaused = 120,
    ContractPaused = 121,
    AlreadyFollowing = 122,
    NotFollowing = 123,
    SelfInteractionNotAllowed = 124,
    InvalidAmount = 125,
    TipCooldownNotExpired = 126,
    InvalidCooldown = 127,
    GraphEntryExpired = 128,
    RoleRequired = 129,
    PoolAdminNotFound = 130,
    PoolAdminExists = 131,
    ProposalNotFound = 132,
    ProposalNotPassed = 133,
    TimeLockNotExpired = 134,
    QuorumNotMet = 135,
    AlreadyVoted = 136,
    ReportNotFound = 137,
    InvalidVerdict = 138,
    InvalidPostId = 139,
    ZeroAddress = 140,
    CannotRemoveLastAdmin = 141,
    CannotRemoveLastUpgrader = 142,
}

#[cfg(test)]
mod tests {
    extern crate alloc;
    use super::*;

    pub const EXPECTED_ERROR_CODES: &[(&str, u32)] = &[
        ("AlreadyInitialized", 100),
        ("NotInitialized", 101),
        ("UsernameTaken", 102),
        ("UsernameTooShort", 103),
        ("UsernameTooLong", 104),
        ("ContentTooLong", 105),
        ("ContentEmpty", 106),
        ("Blocked", 107),
        ("NotBlocked", 108),
        ("Unauthorized", 109),
        ("PostNotFound", 110),
        ("ProfileNotFound", 111),
        ("PoolNotFound", 112),
        ("PoolExists", 113),
        ("InvalidThreshold", 114),
        ("InsufficientSigners", 115),
        ("UnauthorizedSigner", 116),
        ("LowBalance", 117),
        ("WrongToken", 118),
        ("AlreadyPaused", 119),
        ("NotPaused", 120),
        ("ContractPaused", 121),
        ("AlreadyFollowing", 122),
        ("NotFollowing", 123),
        ("SelfInteractionNotAllowed", 124),
        ("InvalidAmount", 125),
        ("TipCooldownNotExpired", 126),
        ("InvalidCooldown", 127),
        ("GraphEntryExpired", 128),
        ("RoleRequired", 129),
        ("PoolAdminNotFound", 130),
        ("PoolAdminExists", 131),
        ("ProposalNotFound", 132),
        ("ProposalNotPassed", 133),
        ("TimeLockNotExpired", 134),
        ("QuorumNotMet", 135),
        ("AlreadyVoted", 136),
        ("ReportNotFound", 137),
        ("InvalidVerdict", 138),
        ("InvalidPostId", 139),
        ("ZeroAddress", 140),
        ("CannotRemoveLastAdmin", 141),
        ("CannotRemoveLastUpgrader", 142),
    ];

    #[test]
    fn test_contract_error_variants_match_assigned_codes() {
        assert_eq!(RentError::Expired as u32, 1);
        assert_eq!(ContractError::AlreadyInitialized as u32, 100);
        assert_eq!(ContractError::NotInitialized as u32, 101);
        assert_eq!(ContractError::UsernameTaken as u32, 102);
        assert_eq!(ContractError::UsernameTooShort as u32, 103);
        assert_eq!(ContractError::UsernameTooLong as u32, 104);
        assert_eq!(ContractError::ContentTooLong as u32, 105);
        assert_eq!(ContractError::ContentEmpty as u32, 106);
        assert_eq!(ContractError::Blocked as u32, 107);
        assert_eq!(ContractError::NotBlocked as u32, 108);
        assert_eq!(ContractError::Unauthorized as u32, 109);
        assert_eq!(ContractError::PostNotFound as u32, 110);
        assert_eq!(ContractError::ProfileNotFound as u32, 111);
        assert_eq!(ContractError::PoolNotFound as u32, 112);
        assert_eq!(ContractError::PoolExists as u32, 113);
        assert_eq!(ContractError::InvalidThreshold as u32, 114);
        assert_eq!(ContractError::InsufficientSigners as u32, 115);
        assert_eq!(ContractError::UnauthorizedSigner as u32, 116);
        assert_eq!(ContractError::LowBalance as u32, 117);
        assert_eq!(ContractError::WrongToken as u32, 118);
        assert_eq!(ContractError::AlreadyPaused as u32, 119);
        assert_eq!(ContractError::NotPaused as u32, 120);
        assert_eq!(ContractError::ContractPaused as u32, 121);
        assert_eq!(ContractError::AlreadyFollowing as u32, 122);
        assert_eq!(ContractError::NotFollowing as u32, 123);
        assert_eq!(ContractError::SelfInteractionNotAllowed as u32, 124);
        assert_eq!(ContractError::InvalidAmount as u32, 125);
        assert_eq!(ContractError::TipCooldownNotExpired as u32, 126);
        assert_eq!(ContractError::InvalidCooldown as u32, 127);
        assert_eq!(ContractError::GraphEntryExpired as u32, 128);
        assert_eq!(ContractError::RoleRequired as u32, 129);
        assert_eq!(ContractError::PoolAdminNotFound as u32, 130);
        assert_eq!(ContractError::PoolAdminExists as u32, 131);
        assert_eq!(ContractError::ProposalNotFound as u32, 132);
        assert_eq!(ContractError::ProposalNotPassed as u32, 133);
        assert_eq!(ContractError::TimeLockNotExpired as u32, 134);
        assert_eq!(ContractError::QuorumNotMet as u32, 135);
        assert_eq!(ContractError::AlreadyVoted as u32, 136);
        assert_eq!(ContractError::ReportNotFound as u32, 137);
        assert_eq!(ContractError::InvalidVerdict as u32, 138);
        assert_eq!(ContractError::InvalidPostId as u32, 139);
        assert_eq!(ContractError::ZeroAddress as u32, 140);
        assert_eq!(ContractError::CannotRemoveLastAdmin as u32, 141);
        assert_eq!(ContractError::CannotRemoveLastUpgrader as u32, 142);
    }

    #[test]
    fn test_error_codes_match_abi_fixture() {
        let fixture_str = include_str!("../fixtures/contract_errors.json");
        assert!(fixture_str.contains("\"Expired\": 1"));
        assert!(fixture_str.contains("\"AlreadyInitialized\": 100"));
        assert!(fixture_str.contains("\"UsernameTaken\": 102"));
        assert!(fixture_str.contains("\"CannotRemoveLastUpgrader\": 142"));
        for (variant, code) in EXPECTED_ERROR_CODES.iter() {
            let needle = alloc::format!("\"{}\": {}", variant, code);
            assert!(
                fixture_str.contains(&needle),
                "Fixture missing expected variant entry: {}",
                needle
            );
        }
    }
}


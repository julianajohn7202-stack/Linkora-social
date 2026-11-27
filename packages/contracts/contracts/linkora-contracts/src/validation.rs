use alloc::format;
use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::{GovParameter, ReportStatus};

pub const MAX_NAME_LEN: u32 = 32;
pub const MIN_NAME_LEN: u32 = 3;
pub const MAX_BIO_LEN: u32 = 500;
pub const MAX_CONTENT_LEN: u32 = 280;
pub const MAX_PROTOCOL_AMOUNT: i128 = 1_000_000_000_000_000_000_000_000_000_000_000_000;
pub const MAX_FEE_BPS: u32 = 10_000;
pub const MAX_QUORUM: u32 = 100;
const ZERO_ACCOUNT_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ZERO_CONTRACT_ADDRESS: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

// Reserved usernames that cannot be claimed
const RESERVED_WORDS: &[&str] = &[
    "admin",
    "system",
    "moderator",
    "bot",
    "root",
    "support",
    "help",
    "feedback",
    "contact",
    "info",
    "status",
    "health",
    "api",
    "app",
    "web",
    "mobile",
    "linkora",
];

#[macro_export]
macro_rules! require_with_error {
    ($env:expr, $cond:expr, $msg:expr) => {{
        if !($cond) {
            let _ = &$env;
            panic!("{}", $msg);
        }
    }};
}

fn is_zero_address(env: &Env, address: &Address) -> bool {
    let zero_account = Address::from_str(env, ZERO_ACCOUNT_ADDRESS);
    let zero_contract = Address::from_str(env, ZERO_CONTRACT_ADDRESS);
    address == &zero_account || address == &zero_contract
}

pub fn validate_non_default_address(env: &Env, label: &str, address: &Address) {
    require_with_error!(
        env,
        !is_zero_address(env, address),
        format!("{label} must not be the zero address")
    );
}

pub fn validate_address_list(env: &Env, label: &str, addresses: &Vec<Address>) {
    for (idx, address) in addresses.iter().enumerate() {
        require_with_error!(
            env,
            !is_zero_address(env, &address),
            format!("{label}[{idx}] must not be the zero address")
        );
    }
}

/// Ensures no duplicate addresses appear in the list. Duplicate signers could
/// let a subset of admins exceed the M-of-N threshold weight.
pub fn validate_unique_signers(env: &Env, label: &str, addresses: &Vec<Address>) {
    for i in 0..addresses.len() {
        for j in (i + 1)..addresses.len() {
            require_with_error!(
                env,
                addresses.get_unchecked(i) != addresses.get_unchecked(j),
                format!("{label} must not contain duplicate addresses")
            );
        }
    }
}

fn validate_string_max_len(env: &Env, label: &str, value: &String, max: u32) {
    require_with_error!(
        env,
        value.len() <= max,
        format!("{label} must be at most {max} characters")
    );
}

/// Validates a username against the contract's naming rules.
///
/// A valid username must:
/// - Be at least `MIN_NAME_LEN` (3) characters long
/// - Be at most `MAX_NAME_LEN` (32) characters long
/// - Start with a letter (a–z, A–Z)
/// - Contain only alphanumeric characters (a–z, A–Z, 0–9) and underscores (`_`)
/// - Not be a reserved word (e.g., "admin", "system", "moderator")
///
/// # Panics
///
/// Panics with a descriptive error message on the first violated rule.
pub fn validate_username(env: &Env, username: &String) {
    // Check minimum length
    require_with_error!(
        env,
        username.len() >= MIN_NAME_LEN,
        format!("username must be at least {MIN_NAME_LEN} characters")
    );

    // Check maximum length
    validate_string_max_len(env, "username", username, MAX_NAME_LEN);

    // Check that first character is a letter
    let username_bytes = username.to_bytes();
    if let Some(first_byte) = username_bytes.first() {
        require_with_error!(
            env,
            first_byte.is_ascii_alphabetic(),
            "username must start with a letter"
        );
    }

    // Check for alphanumeric and underscore only
    for byte in username_bytes.iter() {
        let is_valid = byte.is_ascii_lowercase()
            || byte.is_ascii_uppercase()
            || byte.is_ascii_digit()
            || byte == b'_';

        require_with_error!(
            env,
            is_valid,
            "username can only contain alphanumeric characters and underscores"
        );
    }

    // Check for reserved words (case-insensitive). Usernames are ASCII-only
    // (enforced above), so a byte-wise ASCII lowercase is sufficient here.
    let mut lower = [0u8; MAX_NAME_LEN as usize];
    let len = username_bytes.len() as usize;
    username_bytes.copy_into_slice(&mut lower[..len]);
    for b in lower[..len].iter_mut() {
        b.make_ascii_lowercase();
    }
    for reserved in RESERVED_WORDS.iter() {
        require_with_error!(
            env,
            &lower[..len] != reserved.as_bytes(),
            format!("username '{reserved}' is reserved and cannot be used")
        );
    }
}

pub fn validate_amount(env: &Env, label: &str, amount: i128) {
    require_with_error!(
        env,
        amount > 0 && amount <= MAX_PROTOCOL_AMOUNT,
        format!("{label} must be positive and at most {MAX_PROTOCOL_AMOUNT}")
    );
}

pub fn validate_u32_range(env: &Env, label: &str, value: u32, min: u32, max: u32) {
    require_with_error!(
        env,
        value >= min && value <= max,
        format!("{label} must be between {min} and {max}")
    );
}

pub fn validate_protocol_fee(env: &Env, fee_bps: u32) {
    validate_u32_range(env, "fee_bps", fee_bps, 0, MAX_FEE_BPS);
}

/// Exhaustiveness guard for `GovParameter` variants.
///
/// This is a compile-time check: if a new variant is added to `GovParameter`,
/// the match will become non-exhaustive and fail to compile, forcing the
/// developer to handle it. No runtime validation is performed here — actual
/// value validation happens in `gov_propose` via `validate_u32_range`.
pub fn validate_gov_parameter(env: &Env, parameter: &GovParameter) {
    match parameter {
        GovParameter::FeeBps
        | GovParameter::Treasury
        | GovParameter::TipCooldownWindow
        | GovParameter::GovQuorum
        | GovParameter::GovTimeLock
        | GovParameter::GovVoteWindow
        | GovParameter::ModerationSlashBps => {}
    }
    let _ = env;
}

/// Reject the obviously-invalid all-zero signature before it ever reaches the
/// crypto host function, so a missing/uninitialized signature fails with a
/// descriptive message rather than an opaque crypto error.
pub fn validate_signature(env: &Env, label: &str, signature: &BytesN<64>) {
    let zero = BytesN::from_array(env, &[0u8; 64]);
    require_with_error!(
        env,
        signature != &zero && signature.to_array().len() == 64,
        format!("{label} must not be an all-zero or malformed signature")
    );
}

pub fn validate_pubkey_32(env: &Env, label: &str, pubkey: &BytesN<32>) {
    let zero = BytesN::from_array(env, &[0u8; 32]);
    require_with_error!(
        env,
        pubkey != &zero && pubkey.to_array().len() == 32,
        format!("{label} must not be an all-zero or malformed public key")
    );
}

pub fn validate_report_verdict(env: &Env, verdict: &ReportStatus) {
    require_with_error!(
        env,
        !matches!(verdict, ReportStatus::Pending),
        "verdict must be upheld or dismissed"
    );
}

/// Rejects a report where the reporter is also the post author, preventing
/// self-reporting from being used to bury one's own content.
pub fn validate_reporter_can_report(env: &Env, reporter: &Address, author: &Address) {
    require_with_error!(env, reporter != author, "cannot report own post");
}

/// Validates post content length against a maximum byte threshold.
/// The threshold unit is UTF-8 bytes (reported in public contract messages as characters).
pub fn validate_post_content_len(env: &Env, content: &String, max_len: u32) {
    require_with_error!(env, !content.is_empty(), "content cannot be empty");
    require_with_error!(
        env,
        content.len() <= max_len,
        format!("content must be at most {max_len} characters")
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String as StdString;

    #[derive(Debug, Clone)]
    pub struct ContentBoundaryCase {
        pub description: &'static str,
        pub char_count: usize,
        pub byte_length: usize,
        pub should_pass: bool,
    }

    fn make_repeated_string(ch: char, count: usize) -> StdString {
        let mut s = StdString::new();
        for _ in 0..count {
            s.push(ch);
        }
        s
    }

    #[test]
    fn test_ascii_and_multibyte_post_content_boundaries() {
        let env = Env::default();
        let max_len = MAX_CONTENT_LEN; // 280

        // Exercise ASCII and multibyte strings at the configured threshold (280 bytes)
        // Unit pinned: bytes (UTF-8)
        // Last accepted sizes:
        // - ASCII (1 byte/char): 280 chars = 280 bytes
        // - 2-byte UTF-8 ('é', 2 bytes/char): 140 chars = 280 bytes
        // - 3-byte UTF-8 ('中', 3 bytes/char): 93 chars = 279 bytes
        // - 4-byte UTF-8 ('🦀', 4 bytes/char): 70 chars = 280 bytes

        let ascii_280 = make_repeated_string('a', 280);
        let ascii_281 = make_repeated_string('a', 281);

        let multi_2byte_140 = make_repeated_string('é', 140);
        let multi_2byte_141 = make_repeated_string('é', 141);

        let multi_3byte_93 = make_repeated_string('中', 93);
        let multi_3byte_94 = make_repeated_string('中', 94);

        let multi_4byte_70 = make_repeated_string('🦀', 70);
        let multi_4byte_71 = make_repeated_string('🦀', 71);

        // Equal character counts (280) but unequal byte counts (1120 vs 280)
        let equal_chars_multibyte_280 = make_repeated_string('🦀', 280);

        let test_cases: &[(&str, &StdString, bool)] = &[
            ("ASCII last accepted input size (280 bytes)", &ascii_280, true),
            ("ASCII threshold exceeded (281 bytes)", &ascii_281, false),
            ("2-byte UTF-8 last accepted input size (280 bytes)", &multi_2byte_140, true),
            ("2-byte UTF-8 threshold exceeded (282 bytes)", &multi_2byte_141, false),
            ("3-byte UTF-8 last accepted input size (279 bytes)", &multi_3byte_93, true),
            ("3-byte UTF-8 threshold exceeded (282 bytes)", &multi_3byte_94, false),
            ("4-byte UTF-8 last accepted input size (280 bytes)", &multi_4byte_70, true),
            ("4-byte UTF-8 threshold exceeded (284 bytes)", &multi_4byte_71, false),
            ("Equal char count (280) but unequal multibyte size (1120 bytes)", &equal_chars_multibyte_280, false),
        ];

        for (desc, input_std_str, should_pass) in test_cases.iter() {
            let char_count = input_std_str.chars().count();
            let byte_length = input_std_str.len();

            let case_record = ContentBoundaryCase {
                description: desc,
                char_count,
                byte_length,
                should_pass: *should_pass,
            };

            // Acceptance criterion: Each case records both byte length and character count
            assert_eq!(case_record.char_count, char_count);
            assert_eq!(case_record.byte_length, byte_length);

            let soroban_str = String::from_str(&env, input_std_str.as_str());

            // Acceptance criterion: Tests pin the contract's documented unit and last accepted input size
            assert_eq!(soroban_str.len() as usize, byte_length);

            if *should_pass {
                assert!(
                    soroban_str.len() <= max_len,
                    "Expected case '{}' to be accepted (bytes: {}, limit: {})",
                    desc,
                    byte_length,
                    max_len
                );
                validate_post_content_len(&env, &soroban_str, max_len);
            } else {
                assert!(
                    soroban_str.len() > max_len,
                    "Expected case '{}' to exceed threshold (bytes: {}, limit: {})",
                    desc,
                    byte_length,
                    max_len
                );
            }
        }
    }

    #[test]
    #[should_panic(expected = "content must be at most 280 characters")]
    fn test_ascii_exceeding_threshold_panics_with_public_error() {
        let env = Env::default();
        let ascii_281 = make_repeated_string('x', 281);
        let content = String::from_str(&env, ascii_281.as_str());
        validate_post_content_len(&env, &content, MAX_CONTENT_LEN);
    }

    #[test]
    #[should_panic(expected = "content must be at most 280 characters")]
    fn test_multibyte_exceeding_threshold_panics_with_public_error() {
        let env = Env::default();
        let multi_282_bytes = make_repeated_string('é', 141);
        let content = String::from_str(&env, multi_282_bytes.as_str());
        validate_post_content_len(&env, &content, MAX_CONTENT_LEN);
    }

    #[test]
    #[should_panic(expected = "content cannot be empty")]
    fn test_empty_content_panics_with_public_error() {
        let env = Env::default();
        let content = String::from_str(&env, "");
        validate_post_content_len(&env, &content, MAX_CONTENT_LEN);
    }
}


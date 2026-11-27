//! Unit tests for `set_profile` username validation.

use super::*;

#[test]
#[should_panic(expected = "username must be at least 3 characters")]
fn test_set_profile_username_too_short_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // 2-character username should panic (MIN_NAME_LEN = 3)
    client.set_profile(&user, &String::from_str(&env, "ab"), &token);
}

#[test]
fn test_set_profile_username_minimum_length_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // 3-character username should succeed (MIN_NAME_LEN = 3)
    client.set_profile(&user, &String::from_str(&env, "abc"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "abc"));
}

#[test]
#[should_panic(expected = "username must start with a letter")]
fn test_set_profile_username_starting_with_number_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username starting with a digit should panic
    client.set_profile(&user, &String::from_str(&env, "1user"), &token);
}

#[test]
#[should_panic(expected = "username must start with a letter")]
fn test_set_profile_username_starting_with_underscore_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username starting with underscore should panic
    client.set_profile(&user, &String::from_str(&env, "_user"), &token);
}

#[test]
#[should_panic(expected = "username can only contain alphanumeric characters and underscores")]
fn test_set_profile_username_with_special_chars_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username with special characters should panic
    client.set_profile(&user, &String::from_str(&env, "user@name"), &token);
}

#[test]
fn test_set_profile_username_with_underscore_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username with underscore should succeed
    client.set_profile(&user, &String::from_str(&env, "user_name"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "user_name"));
}

#[test]
fn test_set_profile_rename_updates_reverse_lookup() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    let old_username = String::from_str(&env, "alice_initial");
    let new_username = String::from_str(&env, "alice_renamed");

    // 1. Initial profile creation
    client.set_profile(&user, &old_username, &token);
    assert_eq!(
        client.get_address_by_username(&old_username),
        Some(user.clone()),
        "initial username should resolve to user address"
    );
    assert_eq!(
        client.get_address_by_username(&new_username),
        None,
        "new username should initially be unassigned"
    );

    // 2. Rename the profile to new_username
    client.set_profile(&user, &new_username, &token);

    // Acceptance criteria 1: The new name resolves to the same address
    assert_eq!(
        client.get_address_by_username(&new_username),
        Some(user.clone()),
        "new username must resolve to the same user address after rename"
    );

    // Acceptance criteria 2: The prior key returns the documented available or retained result (None)
    assert_eq!(
        client.get_address_by_username(&old_username),
        None,
        "prior username lookup key must be freed (return None) after rename"
    );

    // Verify profile record has updated username
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, new_username);

    // Verify the freed old username can be claimed by another profile
    let other_user = Address::generate(&env);
    let other_token = Address::generate(&env);
    client.set_profile(&other_user, &old_username, &other_token);
    assert_eq!(
        client.get_address_by_username(&old_username),
        Some(other_user),
        "freed prior username should be available for registration by another user"
    );
}

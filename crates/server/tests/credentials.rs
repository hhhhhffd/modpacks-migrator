#[allow(dead_code)]
#[path = "../../../build-support/credentials.rs"]
mod credentials;

#[test]
fn bcrypt_style_credentials_remain_literal() {
    let fake = "$2a$10$example.test/credential";
    for value in [fake.to_owned(), format!("'{fake}'"), format!("\"{fake}\"")] {
        let input = format!("UNRELATED=ignored\nCURSEFORGE_API_KEY={value}\n");
        assert_eq!(
            credentials::parse_key(&input).unwrap().as_deref(),
            Some(fake)
        );
    }
}

#[test]
fn dotenv_quotes_comments_and_escaped_dollars() {
    assert_eq!(
        credentials::parse_key("export CURSEFORGE_API_KEY='test$literal' # comment")
            .unwrap()
            .as_deref(),
        Some("test$literal")
    );
    assert_eq!(
        credentials::parse_key("CURSEFORGE_API_KEY=test\\$literal")
            .unwrap()
            .as_deref(),
        Some("test$literal")
    );
    assert!(credentials::parse_key("CURSEFORGE_API_KEY='unterminated").is_err());
    assert_eq!(
        credentials::parse_key("# no key\nOTHER=value").unwrap(),
        None
    );
}

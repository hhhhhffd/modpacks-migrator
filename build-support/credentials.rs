use std::{env, fs, path::PathBuf};

// Credentials are literals, not shell templates. In particular, CurseForge's
// bcrypt-style keys contain dollar signs that dotenv interpolation would erase.
pub fn parse_key(contents: &str) -> Result<Option<String>, &'static str> {
    let mut result = None;
    for line in contents.lines() {
        let line = line.trim().strip_prefix("export ").unwrap_or(line.trim());
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() != "CURSEFORGE_API_KEY" {
            continue;
        }
        let mut safe = String::from("CURSEFORGE_API_KEY=");
        let mut single_quoted = false;
        let mut double_quoted = false;
        let mut escaped = false;
        for ch in value.chars() {
            if ch == '$' && !single_quoted && !escaped {
                safe.push('\\');
            }
            safe.push(ch);
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' if !single_quoted => escaped = true,
                '\'' if !double_quoted => single_quoted = !single_quoted,
                '"' if !single_quoted => double_quoted = !double_quoted,
                _ => (),
            }
        }
        let entry = dotenvy::from_read_iter(safe.as_bytes())
            .next()
            .ok_or("Invalid credential assignment")?
            .map_err(|_| "Invalid credential assignment")?;
        result = Some(entry.1);
    }
    Ok(result)
}

pub fn generate() {
    println!("cargo:rerun-if-env-changed=CURSEFORGE_API_KEY");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_CURSEFORGE");
    let workspace =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("missing manifest directory"))
            .join("../..");
    let dotenv = workspace.join(".env");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    let key = if env::var_os("CARGO_FEATURE_CURSEFORGE").is_some() {
        let value = match env::var("CURSEFORGE_API_KEY") {
            Ok(value) => Some(value),
            Err(env::VarError::NotPresent) => {
                if dotenv.exists() {
                    let contents = fs::read_to_string(&dotenv).expect("Cannot read workspace .env");
                    parse_key(&contents).unwrap_or_else(|_| {
                        panic!("Cannot parse CURSEFORGE_API_KEY in workspace .env")
                    })
                } else {
                    None
                }
            }
            Err(_) => panic!("CURSEFORGE_API_KEY must be valid UTF-8"),
        };
        match value {
            Some(value) if !value.trim().is_empty() => Some(value),
            _ => panic!(
                "CURSEFORGE_API_KEY is required: set it in the build environment or workspace .env, or build with --no-default-features"
            ),
        }
    } else {
        None
    };
    // Generate source rather than emitting the credential in cargo build-script output.
    let source = match key {
        Some(key) => format!("const CURSEFORGE_API_KEY: Option<&str> = Some({key:?});\n"),
        None => "const CURSEFORGE_API_KEY: Option<&str> = None;\n".to_owned(),
    };
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("missing output directory"))
        .join("credentials.rs");
    fs::write(output, source).expect("Cannot write generated build configuration");
}

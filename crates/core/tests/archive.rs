use modpacks_migrator_core::{
    analyze_archive_with_progress, analyze_bytes, curseforge_fingerprint, Error, Limits,
    ResolveRequest,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(
            *name,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn fingerprint_vectors_and_whitespace() {
    assert_eq!(curseforge_fingerprint(b""), 1540447798);
    assert_eq!(curseforge_fingerprint(b"hello"), 2788266382);
    assert_eq!(curseforge_fingerprint(b"abcdefgh"), 1080400154);
    assert_eq!(curseforge_fingerprint(b"a \tb\r\nc"), 1621425345);
}

#[test]
fn scan_hashes_preserves_duplicate_rows_and_ignores_config() {
    let data = archive(&[
        ("mods/a.jar", b"abc"),
        ("mods/b.JAR", b"abc"),
        ("config/a.cfg", b"hello"),
    ]);
    let result = analyze_bytes(&data, &Limits::default()).unwrap();
    assert_eq!(result.ignored_files, 1);
    assert_eq!(result.inputs.len(), 2);
    assert_eq!(
        result.inputs[0].sha1,
        "a9993e364706816aba3e25717850c26c9cd0d89d"
    );
    assert_eq!(result.inputs[0].sha512, result.inputs[1].sha512);
    assert_ne!(result.inputs[0].id, result.inputs[1].id);
    assert_eq!(result.inputs[0].fingerprint, 1621425345);
}

#[test]
fn unsafe_paths_and_duplicates_are_rejected() {
    for path in [
        "../bad.jar",
        "/absolute.jar",
        "mods/../bad.jar",
        "mods\\evil.jar",
        "C:/evil.jar",
        "mods//bad.jar",
    ] {
        assert!(
            matches!(
                analyze_bytes(&archive(&[(path, b"x")]), &Limits::default()),
                Err(Error::UnsafeEntry(_))
            ),
            "{path}"
        );
    }
    let mut duplicate = archive(&[("x.jar", b"x"), ("y.jar", b"x")]);
    for i in 0..duplicate.len() - 5 {
        if &duplicate[i..i + 5] == b"y.jar" {
            duplicate[i] = b'x';
        }
    }
    assert!(analyze_bytes(&duplicate, &Limits::default()).is_err());
}

#[test]
fn limits_apply_to_ignored_entries_too() {
    let data = archive(&[("config/a", b"12345"), ("mods/a.jar", b"12345")]);
    let mut limits = Limits {
        max_entry_bytes: 4,
        ..Limits::default()
    };
    assert!(matches!(
        analyze_bytes(&data, &limits),
        Err(Error::Limit(_))
    ));
    limits.max_entry_bytes = 5;
    limits.max_total_bytes = 9;
    assert!(matches!(
        analyze_bytes(&data, &limits),
        Err(Error::Limit(_))
    ));
    limits.max_total_bytes = 10;
    limits.max_input_bytes = data.len() as u64 - 1;
    assert!(matches!(
        analyze_bytes(&data, &limits),
        Err(Error::Limit(_))
    ));
}

#[test]
fn corrupted_ignored_and_jar_entries_fail_crc() {
    for name in ["config/file", "mods/a.jar"] {
        let mut data = archive(&[(name, b"unique-content-12345")]);
        let offset = data
            .windows(20)
            .position(|part| part == b"unique-content-12345")
            .unwrap();
        data[offset] ^= 1;
        assert!(analyze_bytes(&data, &Limits::default()).is_err());
    }
}

#[test]
fn cancellation_is_propagated() {
    let data = archive(&[("a.jar", b"abc")]);
    assert!(matches!(
        analyze_archive_with_progress(Cursor::new(data), &Limits::default(), &mut |_, _| Err(
            Error::Cancelled
        )),
        Err(Error::Cancelled)
    ));
}

#[test]
fn resolve_defaults_include_all_channels_and_providers() {
    let request: ResolveRequest =
        serde_json::from_str(r#"{"target":{"minecraftVersion":"1.20.1","loader":"fabric"}}"#)
            .unwrap();
    assert_eq!(request.providers.len(), 2);
    assert_eq!(request.allowed_channels.len(), 3);
    assert!(request.include_dependencies);
}

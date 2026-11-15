use crate::fingerprint::{is_whitespace, Murmur2};

use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::collections::HashSet;
use std::io::{self, Cursor, Read, Seek, SeekFrom};
use thiserror::Error;
use zip::ZipArchive;

#[derive(Debug, Error)]
pub enum Error {
    #[error("archive IO error: {0}")]
    Io(#[from] io::Error),
    #[error("invalid or unsupported ZIP archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("archive limit exceeded: {0}")]
    Limit(String),
    #[error("unsafe archive path or entry: {0}")]
    UnsafeEntry(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("operation cancelled")]
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_input_bytes: u64,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    pub max_entries: usize,
    pub max_path_depth: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * 1024 * 1024,
            max_entry_bytes: 128 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            max_entries: 10_000,
            max_path_depth: 16,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub id: String,
    pub path: String,
    pub size: u64,
    pub sha1: String,
    pub sha512: String,
    pub fingerprint: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub inputs: Vec<Input>,
    pub ignored_files: usize,
}

fn central_directory_count<R: Read + Seek>(reader: &mut R, size: u64) -> Result<usize, Error> {
    let length = size.min(65_557) as usize;
    reader.seek(SeekFrom::End(-(length as i64)))?;
    let mut end = vec![0; length];
    reader.read_exact(&mut end)?;
    let position = (0..length.saturating_sub(21))
        .rev()
        .find(|&i| {
            end[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]
                && i + 22 + u16::from_le_bytes([end[i + 20], end[i + 21]]) as usize == length
        })
        .ok_or_else(|| Error::InvalidInput("missing ZIP end record".into()))?;
    let disk = u16::from_le_bytes([end[position + 4], end[position + 5]]);
    let directory_disk = u16::from_le_bytes([end[position + 6], end[position + 7]]);
    let disk_count = u16::from_le_bytes([end[position + 8], end[position + 9]]);
    let count = u16::from_le_bytes([end[position + 10], end[position + 11]]);
    if disk != 0 || directory_disk != 0 || disk_count != count || count == u16::MAX {
        return Err(Error::InvalidInput(
            "multi-disk and ZIP64 archives are unsupported".into(),
        ));
    }
    Ok(count as usize)
}

/// Analyze a ZIP without extracting files to the filesystem.
pub fn analyze_archive<R: Read + Seek>(reader: R, limits: &Limits) -> Result<Analysis, Error> {
    analyze_archive_with_progress(reader, limits, &mut |_, _| Ok(()))
}

/// Like [`analyze_archive`], but allows cancellation between read chunks.
pub fn analyze_archive_with_progress<R: Read + Seek>(
    mut reader: R,
    limits: &Limits,
    progress: &mut dyn FnMut(usize, usize) -> Result<(), Error>,
) -> Result<Analysis, Error> {
    let archive_size = reader.seek(SeekFrom::End(0))?;
    if archive_size > limits.max_input_bytes {
        return Err(Error::Limit("input bytes".into()));
    }
    // zip's name index collapses duplicate central-directory entries. Compare
    // its count with the directory's declared count so no entry is hidden.
    let declared_count = central_directory_count(&mut reader, archive_size)?;
    if declared_count > limits.max_entries {
        return Err(Error::Limit("entry count".into()));
    }
    reader.seek(SeekFrom::Start(0))?;
    let mut archive = ZipArchive::new(reader)?;
    if archive.len() != declared_count {
        return Err(Error::InvalidInput(
            "duplicate or inconsistent ZIP entries".into(),
        ));
    }
    if archive.len() > limits.max_entries {
        return Err(Error::Limit("entry count".into()));
    }
    let mut paths = HashSet::new();
    let mut inputs = Vec::new();
    let mut ignored_files = 0;
    let mut total = 0u64;
    let count = archive.len();
    for index in 0..count {
        progress(index, count)?;
        let mut file = archive.by_index(index)?;
        let path = file.name().to_owned();
        validate_path(&path, file.is_dir(), limits.max_path_depth)?;
        if !paths.insert(path.trim_end_matches('/').to_owned()) {
            return Err(Error::UnsafeEntry(path));
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(Error::UnsafeEntry(path));
        }
        if file.is_dir() {
            if file.size() != 0 {
                return Err(Error::UnsafeEntry(path));
            }
            continue;
        }
        if file.size() > limits.max_entry_bytes {
            return Err(Error::Limit("entry bytes".into()));
        }
        if total
            .checked_add(file.size())
            .is_none_or(|n| n > limits.max_total_bytes)
        {
            return Err(Error::Limit("total uncompressed bytes".into()));
        }
        let jar = path.to_ascii_lowercase().ends_with(".jar");
        let mut sha1 = Sha1::new();
        let mut sha512 = Sha512::new();
        let mut normalized_len = 0u32;
        let mut actual = 0u64;
        let mut buf = [0u8; 32768];
        loop {
            progress(index, count)?;
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            actual = actual
                .checked_add(n as u64)
                .ok_or(Error::Limit("entry bytes".into()))?;
            if actual > limits.max_entry_bytes
                || total
                    .checked_add(actual)
                    .is_none_or(|n| n > limits.max_total_bytes)
            {
                return Err(Error::Limit("uncompressed bytes".into()));
            }
            if jar {
                sha1.update(&buf[..n]);
                sha512.update(&buf[..n]);
                normalized_len = normalized_len
                    .checked_add(buf[..n].iter().filter(|&&b| !is_whitespace(b)).count() as u32)
                    .ok_or(Error::Limit("fingerprint length".into()))?;
            }
        }
        if actual != file.size() {
            return Err(Error::UnsafeEntry(path));
        }
        total += actual;
        drop(file);
        if !jar {
            ignored_files += 1;
            continue;
        }
        let mut file = archive.by_index(index)?;
        let mut murmur = Murmur2::new(normalized_len);
        loop {
            progress(index, count)?;
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                if !is_whitespace(b) {
                    murmur.push(b);
                }
            }
        }
        inputs.push(Input {
            id: format!("input-{index}"),
            path,
            size: actual,
            sha1: format!("{:x}", sha1.finalize()),
            sha512: format!("{:x}", sha512.finalize()),
            fingerprint: murmur.finish(),
        });
    }
    progress(count, count)?;
    Ok(Analysis {
        inputs,
        ignored_files,
    })
}

pub fn analyze_bytes(bytes: &[u8], limits: &Limits) -> Result<Analysis, Error> {
    analyze_archive(Cursor::new(bytes), limits)
}

fn validate_path(path: &str, is_dir: bool, max_depth: usize) -> Result<(), Error> {
    let trimmed = if is_dir {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    if trimmed.is_empty()
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.contains(':'))
        || trimmed.split('/').count() > max_depth
    {
        return Err(Error::UnsafeEntry(path.to_owned()));
    }
    Ok(())
}

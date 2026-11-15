pub(crate) fn is_whitespace(b: u8) -> bool {
    matches!(b, 0x09 | 0x0a | 0x0d | 0x20)
}

pub(crate) struct Murmur2 {
    hash: u32,
    pending: [u8; 4],
    used: usize,
}
impl Murmur2 {
    pub(crate) fn new(len: u32) -> Self {
        Self {
            hash: 1 ^ len,
            pending: [0; 4],
            used: 0,
        }
    }
    pub(crate) fn push(&mut self, b: u8) {
        self.pending[self.used] = b;
        self.used += 1;
        if self.used == 4 {
            let mut k = u32::from_le_bytes(self.pending);
            k = k.wrapping_mul(0x5bd1e995);
            k ^= k >> 24;
            k = k.wrapping_mul(0x5bd1e995);
            self.hash = self.hash.wrapping_mul(0x5bd1e995) ^ k;
            self.used = 0;
        }
    }
    pub(crate) fn finish(mut self) -> u32 {
        for i in 0..self.used {
            self.hash ^= (self.pending[i] as u32) << (8 * i);
        }
        if self.used != 0 {
            self.hash = self.hash.wrapping_mul(0x5bd1e995);
        }
        self.hash ^= self.hash >> 13;
        self.hash = self.hash.wrapping_mul(0x5bd1e995);
        self.hash ^ (self.hash >> 15)
    }
}

/// CurseForge's normalized MurmurHash2 fingerprint.
pub fn curseforge_fingerprint(bytes: &[u8]) -> u32 {
    let len = bytes.iter().filter(|&&b| !is_whitespace(b)).count();
    // A ZIP entry is bounded below u32::MAX by default. This helper follows
    // MurmurHash2's 32-bit length convention for arbitrarily large slices.
    let mut hash = Murmur2::new(len as u32);
    for &b in bytes {
        if !is_whitespace(b) {
            hash.push(b);
        }
    }
    hash.finish()
}

/* BL4 Build Forge 0.8.6 — browser port of the desktop codec, catalog, page parser, and save tools. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BF = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "0.8.6";
  const LEVEL_CAP = 70;
  const THEME_NAMES = ["AMW Violet", "Tacklebox Tide", "Arctic Circuit", "Ember Forge", "Rose Quartz", "Graphite Gold"];
  const THEME_KEYS = ["bg", "panel", "field", "fieldHi", "border", "accent", "accentHi", "accentLo", "magenta", "text", "muted", "faint", "ok", "warn", "select", "onAccent"];
  const PALETTES = [
    ["0b0710", "140d1d", "1b1227", "241834", "35224d", "b26bff", "c98cff", "5b2d8f", "e05cff", "ece3ff", "b7a9ce", "9989b2", "8ef0c4", "ffc06b", "4a2577", "12091c"],
    ["071114", "0d1d22", "12282e", "19373d", "31545b", "42d6bd", "85edda", "236558", "e4b957", "e7f6f2", "a9c7c7", "87aaae", "8ef0c4", "ffd080", "24594f", "061d19"],
    ["080f1c", "101c2d", "17263c", "20334b", "384f6c", "70c9ff", "b4e5ff", "305c89", "9fafff", "edf5ff", "b2c6df", "8fa8c8", "8ef0c4", "ffd080", "2a5077", "09182b"],
    ["140c09", "21150f", "2b1d15", "3c2a1d", "614330", "ffae62", "ffd29a", "814a25", "f36c52", "fff1e5", "d5b9a5", "b99982", "a4e4ba", "ffd785", "704426", "261307"],
    ["130c14", "211422", "2b1c2c", "3a283b", "604460", "ee9dc8", "ffd0e5", "85476a", "b6a5ff", "fff0f8", "d6b6cc", "b998b0", "a4e4cb", "ffcf8c", "6b3e59", "2b1020"],
    ["101112", "1a1c1e", "232629", "303438", "4d5358", "e8c76b", "ffe6a0", "786328", "9fb8cb", "f2f2ee", "bfc3c5", "9ea5a9", "9de1b9", "ffc38d", "61532d", "201b0c"]
  ];

  function hexByte(h) { return parseInt(h, 16); }
  function luminance(hex) {
    const n = hexByte(hex);
    const ch = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const r = hexByte(hex.slice(0, 2)), g = hexByte(hex.slice(2, 4)), b = hexByte(hex.slice(4, 6));
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function themePalette(name) {
    let i = THEME_NAMES.indexOf(name);
    if (i < 0) i = 0;
    const colors = {};
    THEME_KEYS.forEach((k, n) => { colors[k] = "#" + PALETTES[i][n]; });
    colors.name = THEME_NAMES[i];
    return colors;
  }

  // ---------------------------------------------------------------- inflate / deflate
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildTree(lengths) {
    const max = lengths.length ? lengths.reduce((a, b) => Math.max(a, b), 0) : 0;
    const count = new Array(max + 1).fill(0);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) count[lengths[i]]++;
    const next = new Array(max + 1).fill(0);
    let code = 0;
    count[0] = 0;
    for (let bits = 1; bits <= max; bits++) {
      code = (code + count[bits - 1]) << 1;
      next[bits] = code;
    }
    const root = {};
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (!len) continue;
      const bits = next[len]++;
      let node = root;
      for (let b = len - 1; b >= 0; b--) {
        const bit = (bits >> b) & 1;
        if (b === 0) node[bit] = i;
        else {
          if (typeof node[bit] !== "object") node[bit] = {};
          node = node[bit];
        }
      }
    }
    return root;
  }

  function fixedTrees() {
    const lit = new Array(288), dist = new Array(32);
    for (let i = 0; i <= 143; i++) lit[i] = 8;
    for (let i = 144; i <= 255; i++) lit[i] = 9;
    for (let i = 256; i <= 279; i++) lit[i] = 7;
    for (let i = 280; i <= 287; i++) lit[i] = 8;
    for (let i = 0; i < 32; i++) dist[i] = 5;
    return [buildTree(lit), buildTree(dist)];
  }
  const FIXED = fixedTrees();

  function BitIn(bytes) {
    this.b = bytes;
    this.i = 0;
    this.bit = 0;
    this.acc = 0;
  }
  BitIn.prototype.read = function (n) {
    while (this.bit < n) {
      if (this.i >= this.b.length) throw new Error("truncated deflate");
      this.acc |= this.b[this.i++] << this.bit;
      this.bit += 8;
    }
    const v = this.acc & ((1 << n) - 1);
    this.acc >>>= n;
    this.bit -= n;
    return v;
  };
  BitIn.prototype.align = function () { this.acc = 0; this.bit = 0; };

  function decodeSym(br, tree) {
    let node = tree;
    while (typeof node === "object" && node !== null) node = node[br.read(1)];
    if (typeof node !== "number") throw new Error("bad huffman code");
    return node;
  }

  function inflateRaw(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const br = new BitIn(src);
    let out = new Uint8Array(1024);
    let n = 0;
    function push(v) {
      if (n >= out.length) {
        const g = new Uint8Array(out.length * 2);
        g.set(out);
        out = g;
      }
      out[n++] = v & 255;
    }
    function copy(len, dist) {
      if (dist <= 0 || dist > n) throw new Error("bad distance");
      for (let i = 0; i < len; i++) push(out[n - dist]);
    }
    let bfinal = 0;
    while (!bfinal) {
      bfinal = br.read(1);
      const btype = br.read(2);
      if (btype === 0) {
        br.align();
        if (br.i + 4 > src.length) throw new Error("truncated stored block");
        const len = src[br.i] | (src[br.i + 1] << 8);
        const nlen = src[br.i + 2] | (src[br.i + 3] << 8);
        br.i += 4;
        if ((len ^ nlen) !== 0xffff) throw new Error("bad stored block");
        if (br.i + len > src.length) throw new Error("truncated stored block");
        for (let i = 0; i < len; i++) push(src[br.i++]);
      } else if (btype === 1 || btype === 2) {
        let lit, dist;
        if (btype === 1) { lit = FIXED[0]; dist = FIXED[1]; }
        else {
          const hlit = br.read(5) + 257;
          const hdist = br.read(5) + 1;
          const hclen = br.read(4) + 4;
          const cl = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = br.read(3);
          const clTree = buildTree(cl);
          const lengths = [];
          while (lengths.length < hlit + hdist) {
            const s = decodeSym(br, clTree);
            if (s < 16) lengths.push(s);
            else if (s === 16) {
              const rep = br.read(2) + 3;
              const prev = lengths.length ? lengths[lengths.length - 1] : 0;
              for (let k = 0; k < rep; k++) lengths.push(prev);
            } else if (s === 17) {
              const rep = br.read(3) + 3;
              for (let k = 0; k < rep; k++) lengths.push(0);
            } else {
              const rep = br.read(7) + 11;
              for (let k = 0; k < rep; k++) lengths.push(0);
            }
          }
          lit = buildTree(lengths.slice(0, hlit));
          dist = buildTree(lengths.slice(hlit, hlit + hdist));
        }
        while (true) {
          const sym = decodeSym(br, lit);
          if (sym < 256) push(sym);
          else if (sym === 256) break;
          else {
            const li = sym - 257;
            if (li < 0 || li >= LEN_BASE.length) throw new Error("bad length code");
            const len = LEN_BASE[li] + (LEN_EXTRA[li] ? br.read(LEN_EXTRA[li]) : 0);
            const ds = decodeSym(br, dist);
            if (ds >= DIST_BASE.length) throw new Error("bad distance code");
            const d = DIST_BASE[ds] + (DIST_EXTRA[ds] ? br.read(DIST_EXTRA[ds]) : 0);
            copy(len, d);
          }
        }
      } else throw new Error("bad deflate block");
    }
    return out.subarray(0, n);
  }

  function deflateRaw(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length === 0) return new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);
    const parts = [];
    let off = 0;
    while (off < u.length) {
      const len = Math.min(65535, u.length - off);
      const final = off + len >= u.length;
      const block = new Uint8Array(5 + len);
      block[0] = final ? 0x01 : 0x00;
      block[1] = len & 255;
      block[2] = (len >> 8) & 255;
      const nlen = (~len) & 0xffff;
      block[3] = nlen & 255;
      block[4] = (nlen >> 8) & 255;
      block.set(u.subarray(off, off + len), 5);
      parts.push(block);
      off += len;
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function adler32(d) {
    let a = 1, b = 0;
    for (let i = 0; i < d.length; i++) {
      a = (a + d[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function zlibWrap(data) {
    const raw = deflateRaw(data);
    const ad = adler32(data);
    const o = new Uint8Array(raw.length + 6);
    o[0] = 0x78;
    o[1] = 0x9c;
    o.set(raw, 2);
    o[o.length - 4] = (ad >>> 24) & 255;
    o[o.length - 3] = (ad >>> 16) & 255;
    o[o.length - 2] = (ad >>> 8) & 255;
    o[o.length - 1] = ad & 255;
    return o;
  }

  // ---------------------------------------------------------------- AES-256-ECB
  const SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ]);
  const INV_SBOX = new Uint8Array(256);
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
  const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 255; }
  function gmul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      a = xtime(a);
      b >>= 1;
    }
    return p;
  }
  function subWord(w) {
    return ((SBOX[w >>> 24] << 24) | (SBOX[(w >>> 16) & 255] << 16) | (SBOX[(w >>> 8) & 255] << 8) | SBOX[w & 255]) >>> 0;
  }
  function rotWord(w) { return (((w << 8) | (w >>> 24)) >>> 0); }
  function expandKey(key) {
    const w = new Uint32Array(60);
    for (let i = 0; i < 8; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
    for (let i = 8; i < 60; i++) {
      let t = w[i - 1];
      if (i % 8 === 0) t = (subWord(rotWord(t)) ^ (RCON[(i / 8) | 0] << 24)) >>> 0;
      else if (i % 8 === 4) t = subWord(t);
      w[i] = (w[i - 8] ^ t) >>> 0;
    }
    return w;
  }
  function addRound(s, w, round) {
    for (let c = 0; c < 4; c++) {
      const word = w[round * 4 + c];
      s[4 * c] ^= (word >>> 24) & 255;
      s[4 * c + 1] ^= (word >>> 16) & 255;
      s[4 * c + 2] ^= (word >>> 8) & 255;
      s[4 * c + 3] ^= word & 255;
    }
  }
  function subBytes(s, box) { for (let i = 0; i < 16; i++) s[i] = box[s[i]]; }
  function shiftRows(s) {
    const t = s.slice();
    for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c + r) % 4)];
  }
  function invShiftRows(s) {
    const t = s.slice();
    for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c - r + 4) % 4)];
  }
  function mixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
      s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
      s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
      s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
    }
  }
  function invMixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
      s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
      s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
      s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
    }
  }
  function aesEncryptBlock(block, w) {
    const s = new Uint8Array(block);
    addRound(s, w, 0);
    for (let r = 1; r < 14; r++) { subBytes(s, SBOX); shiftRows(s); mixColumns(s); addRound(s, w, r); }
    subBytes(s, SBOX); shiftRows(s); addRound(s, w, 14);
    return s;
  }
  function aesDecryptBlock(block, w) {
    const s = new Uint8Array(block);
    addRound(s, w, 14);
    for (let r = 13; r >= 1; r--) { invShiftRows(s); subBytes(s, INV_SBOX); addRound(s, w, r); invMixColumns(s); }
    invShiftRows(s); subBytes(s, INV_SBOX); addRound(s, w, 0);
    return s;
  }
  function aesEcb(key, data, encrypt) {
    if (data.length === 0 || data.length % 16 !== 0) throw new Error("Invalid save block size.");
    const w = expandKey(key);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      const block = data.subarray(i, i + 16);
      out.set(encrypt ? aesEncryptBlock(block, w) : aesDecryptBlock(block, w), i);
    }
    return out;
  }

  // ---------------------------------------------------------------- item serial codec
  const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{/}~";
  const B85_REV = new Int16Array(128).fill(-1);
  for (let i = 0; i < B85.length; i++) B85_REV[B85.charCodeAt(i)] = i;
  function mirrorBits(v, n) {
    let o = 0;
    for (let b = 0; b < n; b++) if ((v & (1 << b)) !== 0) o |= 1 << (n - 1 - b);
    return o;
  }
  const MIRROR8 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) MIRROR8[i] = mirrorBits(i, 8);
  function bitLength(v) { let n = 0; while (v > 0) { n++; v = Math.floor(v / 2); } return n; }

  function b85Decode(serial) {
    let s = String(serial).trim().replace(/^['"]|['"]$/g, "");
    if (s.length >= 2 && s.slice(0, 2).toLowerCase() === "@u") s = s.slice(2);
    const out = [];
    let i = 0;
    while (i < s.length) {
      let v = 0n, n = 0;
      while (i < s.length && n < 5) {
        const ch = s.charCodeAt(i++);
        const c = ch < 128 ? B85_REV[ch] : -1;
        if (c >= 0) { v = v * 85n + BigInt(c); n++; }
      }
      if (n === 0) break;
      if (n < 5) for (let k = 0; k < 5 - n; k++) v = v * 85n + 126n;
      v &= 0xffffffffn;
      const nbytes = n < 5 ? n - 1 : 4;
      for (let k = 0; k < nbytes; k++) out.push(Number((v >> BigInt(24 - 8 * k)) & 0xffn));
    }
    const res = new Uint8Array(out.length);
    for (let k = 0; k < out.length; k++) res[k] = MIRROR8[out[k]];
    return res;
  }
  function b85Encode(data) {
    const b = new Uint8Array(data.length);
    for (let k = 0; k < data.length; k++) b[k] = MIRROR8[data[k]];
    let sb = "@U";
    const full = Math.floor(b.length / 4), extra = b.length % 4;
    let i = 0;
    const digs = [0, 0, 0, 0, 0];
    for (let f = 0; f < full; f++) {
      let v = (BigInt(b[i]) << 24n) | (BigInt(b[i + 1]) << 16n) | (BigInt(b[i + 2]) << 8n) | BigInt(b[i + 3]);
      i += 4;
      for (let d = 4; d >= 0; d--) { digs[d] = Number(v % 85n); v /= 85n; }
      for (let d = 0; d < 5; d++) sb += B85[digs[d]];
    }
    if (extra > 0) {
      let v = 0n;
      for (let k = 0; k < extra; k++) v = (v << 8n) | BigInt(b[i + k]);
      v <<= BigInt(8 * (4 - extra));
      for (let d = 4; d >= 0; d--) { digs[d] = Number(v % 85n); v /= 85n; }
      for (let d = 0; d < extra + 1; d++) sb += B85[digs[d]];
    }
    return sb;
  }

  function BitWriter() { this.bits = []; }
  BitWriter.prototype.bit = function (b) { this.bits.push(b & 1); };
  BitWriter.prototype.bitsOf = function () { for (let i = 0; i < arguments.length; i++) this.bit(arguments[i]); };
  BitWriter.prototype.writeN = function (v, n) { for (let k = n - 1; k >= 0; k--) this.bit((v >> k) & 1); };
  BitWriter.prototype.data = function () {
    const o = new Uint8Array((this.bits.length + 7) >> 3);
    for (let k = 0; k < this.bits.length; k++) if (this.bits[k]) o[k >> 3] |= 1 << (7 - (k & 7));
    return o;
  };

  function BitReader(data) { this.d = data; this.pos = 0; this.len = data.length * 8; }
  BitReader.prototype.read = function () {
    if (this.pos >= this.len) return -1;
    const b = (this.d[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  };
  BitReader.prototype.readN = function (n) {
    if (this.pos + n > this.len) return -1;
    let v = 0;
    for (let k = 0; k < n; k++) v = (v << 1) | this.read();
    return v;
  };

  function varintRead(br) {
    let got = 0, o = 0;
    for (let k = 0; k < 4; k++) {
      const blk = br.readN(4);
      if (blk < 0) throw new Error("truncated varint");
      o |= mirrorBits(blk, 4) << got;
      got += 4;
      if (br.read() === 0) break;
    }
    return o;
  }
  function varintWrite(bw, value) {
    let n = Math.max(1, Math.min(16, bitLength(value)));
    let v = value;
    while (n > 4) {
      for (let k = 0; k < 4; k++) { bw.bit(v & 1); v = Math.floor(v / 2); n--; }
      bw.bit(1);
    }
    for (let k = 0; k < 4; k++) {
      if (n > 0) { bw.bit(v & 1); v = Math.floor(v / 2); n--; }
      else bw.bit(0);
    }
    bw.bit(0);
  }
  function varbitRead(br) {
    const ln = mirrorBits(br.readN(5), 5);
    let v = 0;
    for (let k = 0; k < ln; k++) v |= br.read() << k;
    return v;
  }
  function varbitWrite(bw, value) {
    const n = Math.min(31, bitLength(value));
    let l = n;
    for (let k = 0; k < 5; k++) { bw.bit(l & 1); l >>= 1; }
    let v = value;
    for (let k = 0; k < n; k++) { bw.bit(v & 1); v = Math.floor(v / 2); }
  }
  function useVarbit(v) {
    const a = new BitWriter(); varintWrite(a, v);
    const b = new BitWriter(); varbitWrite(b, v);
    return a.bits.length > b.bits.length;
  }

  const SEP1 = 0, SEP2 = 1, VARINT = 2, VARBIT = 3, PART = 4, STRING = 5;
  function nextToken(br) {
    const b1 = br.read(), b2 = br.read();
    if (b1 < 0 || b2 < 0) return -1;
    let t = (b1 << 1) | b2;
    if (t === 0) return SEP1;
    if (t === 1) return SEP2;
    const b3 = br.read();
    if (b3 < 0) return -1;
    t = (t << 1) | b3;
    if (t === 4) return VARINT;
    if (t === 6) return VARBIT;
    if (t === 5) return PART;
    if (t === 7) return STRING;
    return -1;
  }
  function partRead(br) {
    const idx = varintRead(br);
    if (br.read() === 1) {
      const val = varintRead(br);
      br.readN(3);
      return { kind: "int", idx: idx, val: val };
    }
    const f2 = br.readN(2);
    if (f2 === 2) return { kind: "none", idx: idx };
    if (f2 === 1) {
      if (nextToken(br) !== SEP2) throw new Error("bad list opener");
      const vals = [];
      while (true) {
        const tk = nextToken(br);
        if (tk === SEP1 || tk === -1) return { kind: "list", idx: idx, list: vals };
        vals.push(tk === VARINT ? varintRead(br) : varbitRead(br));
      }
    }
    throw new Error("unknown part subtype");
  }
  function partWrite(bw, p) {
    varintWrite(bw, p.idx);
    if (p.kind === "none") bw.bitsOf(0, 1, 0);
    else if (p.kind === "int") { bw.bit(1); varintWrite(bw, p.val); bw.bitsOf(0, 0, 0); }
    else {
      bw.bitsOf(0, 0, 1); bw.bitsOf(0, 1);
      for (const v of p.list) {
        if (useVarbit(v)) { bw.bitsOf(1, 1, 0); varbitWrite(bw, v); }
        else { bw.bitsOf(1, 0, 0); varintWrite(bw, v); }
      }
      bw.bitsOf(0, 0);
    }
  }

  function decode(serial) {
    const br = new BitReader(b85Decode(String(serial).trim()));
    const magic = [0, 0, 1, 0, 0, 0, 0];
    for (const m of magic) if (br.read() !== m) throw new Error("Not an item serial (bad header)");
    const blocks = [];
    let trailing = 0;
    while (true) {
      let tk;
      try { tk = nextToken(br); } catch (e) { break; }
      if (tk === -1) break;
      trailing = tk === SEP1 ? trailing + 1 : 0;
      try {
        if (tk === VARINT) blocks.push([tk, varintRead(br)]);
        else if (tk === VARBIT) blocks.push([tk, varbitRead(br)]);
        else if (tk === PART) blocks.push([tk, partRead(br)]);
        else if (tk === STRING) {
          const len = varintRead(br);
          let s = "";
          for (let k = 0; k < len; k++) s += String.fromCharCode(mirrorBits(br.readN(7), 7));
          blocks.push([tk, s]);
        } else blocks.push([tk, null]);
      } catch (e) { break; }
    }
    if (trailing > 1) blocks.splice(blocks.length - (trailing - 1), trailing - 1);
    let o = "";
    for (let i = 0; i < blocks.length; i++) {
      const sp = i > 0 ? " " : "";
      const t = blocks[i][0], v = blocks[i][1];
      if (t === SEP1) o += "|";
      else if (t === SEP2) o += ",";
      else if (t === VARINT || t === VARBIT) o += sp + v;
      else if (t === STRING) o += sp + '"' + v + '"';
      else if (v.kind === "none") o += sp + "{" + v.idx + "}";
      else if (v.kind === "int") o += sp + "{" + v.idx + ":" + v.val + "}";
      else o += sp + "{" + v.idx + ":[" + v.list.join(" ") + "]}";
    }
    return o;
  }

  function encode(text) {
    const bw = new BitWriter();
    bw.bitsOf(0, 0, 1, 0, 0, 0, 0);
    const re = /\s*(\||,|\{[^}]*\}|\d+|"(?:[^"\\]|\\.)*")/g;
    let m;
    while ((m = re.exec(text))) {
      const tok = m[1];
      if (tok === "|") bw.bitsOf(0, 0);
      else if (tok === ",") bw.bitsOf(0, 1);
      else if (tok.startsWith('"')) {
        const s = tok.slice(1, -1);
        bw.bitsOf(1, 1, 1);
        varintWrite(bw, s.length);
        for (let i = 0; i < s.length; i++) bw.writeN(mirrorBits(s.charCodeAt(i), 7), 7);
      } else if (tok.startsWith("{")) {
        const inner = tok.slice(1, -1).trim();
        let p;
        const colon = inner.indexOf(":");
        if (colon < 0) p = { kind: "none", idx: parseInt(inner, 10) };
        else {
          const a = parseInt(inner.slice(0, colon).trim(), 10);
          const b = inner.slice(colon + 1).trim();
          if (b.startsWith("[")) {
            const vals = b.replace(/^\[|\]$/g, "").split(/[ \t]+/).filter(Boolean).map((x) => parseInt(x, 10));
            p = { kind: "list", idx: a, list: vals };
          } else p = { kind: "int", idx: a, val: parseInt(b, 10) };
        }
        bw.bitsOf(1, 0, 1);
        partWrite(bw, p);
      } else {
        const v = parseInt(tok, 10);
        if (useVarbit(v)) { bw.bitsOf(1, 1, 0); varbitWrite(bw, v); }
        else { bw.bitsOf(1, 0, 0); varintWrite(bw, v); }
      }
    }
    return b85Encode(bw.data());
  }

  function tryParse(serialOrText) {
    try {
      const s = String(serialOrText).trim();
      const text = s.toLowerCase().startsWith("@u") ? decode(s) : s;
      const m = /^\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*\|/.exec(text);
      if (!m) return null;
      return { family: parseInt(m[1], 10), level: parseInt(m[2], 10), text: text };
    } catch (e) { return null; }
  }
  function patchLevel(text, level) {
    return String(text).replace(/^(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*)\d+/, (full, a) => a + level);
  }

  // ---------------------------------------------------------------- game data + matching
  const GD = {
    items: [], catalog: [], families: new Map(), supported: new Set(), forbidden: new Set(),
    labels: new Map(), source: ""
  };
  const SLOT_WORDS = new Set(["shotgun", "smg", "pistol", "sniper", "rifle", "assault", "ar", "hybrid", "heavy", "ordnance", "gun", "weapon", "repkit", "repair", "kit", "shield", "grenade", "classmod", "class", "mod", "enhancement", "legendary", "pearlescent", "pearl"]);
  const GLUE = new Set(["and", "the", "of", "a", "an", "to", "for", "in", "on"]);

  function loadData(d) {
    if (GD.items.length) return;
    GD.source = d.source == null ? "" : String(d.source);
    for (const x of d.items || []) {
      const it = {
        Family: num(x.f), Sub: num(x.s), Comp: str(x.c), Maker: str(x.mk), Type: str(x.t),
        WhatItDoes: str(x.w), Human: str(x.h), MinLevel: x.ml == null ? 1 : num(x.ml),
        Names: (x.n || []).map(str), Variants: [], VarAlts: [], VarBad: []
      };
      for (const v of x.v || []) {
        it.Variants.push([num(v[0]), str(v[1])]);
        const alts = [], bad = [];
        if (v.length > 2) for (const a of v[2] || []) alts.push({ at: num(a[0]), replace: num(a[1]) === 1, key: str(a[2]) });
        if (v.length > 3) for (const b of v[3] || []) bad.push([num(b[0]), num(b[1])]);
        it.VarAlts.push(alts);
        it.VarBad.push(bad);
      }
      if (!it.Variants.length) {
        it.Variants.push([it.MinLevel, it.Human]);
        it.VarAlts.push([]);
        it.VarBad.push([]);
      }
      GD.items.push(it);
    }
    const fam = d.families || {};
    for (const k of Object.keys(fam)) GD.families.set(parseInt(k, 10), str(fam[k]));
    for (const v of d.supported || []) GD.supported.add(num(v));
    for (const v of d.forbidden || []) GD.forbidden.add(num(v));
    const lab = d.labels || {};
    for (const k of Object.keys(lab)) {
      const a = lab[k];
      GD.labels.set(k, { name: str(a[0]), effects: str(a[1]), ncs: str(a[2]), partType: str(a[3]), slot: str(a[4]) });
    }
    for (const x of d.catalog || []) {
      GD.catalog.push({
        code: str(x.c), family: num(x.f), label: str(x.l), name: str(x.nm), ncs: str(x.nl),
        text: str(x.t), what: str(x.w), aliases: (x.al || []).map(str)
      });
    }
  }

  function str(v) { return v == null ? "" : String(v); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? (n < 0 ? Math.ceil(n) : Math.floor(n)) : 0; }
  function wordSet(s) {
    return new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean));
  }
  function letters(w) { let n = 0; for (const x of w) n += x.length; return n; }
  function core(s, dropGlue) {
    const o = new Set();
    for (const w of wordSet(s)) if (!SLOT_WORDS.has(w) && !(dropGlue && GLUE.has(w))) o.add(w);
    return o;
  }
  function setEquals(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }
  function isSubset(a, b) { for (const x of a) if (!b.has(x)) return false; return true; }
  function typeHints(query, section) {
    const h = new Set();
    const q = String(query || "").toLowerCase() + " " + (section || "");
    const on = (word, types) => { if (new RegExp("\\b" + word + "\\b").test(q)) types.forEach((t) => h.add(t)); };
    on("class ?mods?|classmod|com", ["Class Mod"]);
    on("shields?", ["Shield"]);
    on("repkits?|repair kits?|repkit", ["Repkit"]);
    on("enhancements?", ["Enhancement"]);
    on("grenades?", ["Grenade"]);
    on("ordnance", ["Grenade", "Heavy Weapon"]);
    on("heavy", ["Heavy Weapon"]);
    on("weapons?|guns?", ["Pistol", "Shotgun", "Assault Rifle", "SMG", "Sniper", "Heavy Weapon"]);
    on("pistols?", ["Pistol"]);
    on("shotguns?", ["Shotgun"]);
    on("smgs?", ["SMG"]);
    on("snipers?|sniper rifles?", ["Sniper"]);
    on("assault rifles?|ar", ["Assault Rifle"]);
    return h;
  }
  function isExactName(text) {
    const q = core(text, false);
    if (!q.size || letters(q) < 3) return false;
    for (const it of GD.items) for (const n of it.Names) {
      const nn = core(n, false);
      if (nn.size && setEquals(nn, q)) return true;
    }
    return false;
  }
  function isClassMod(it) { return it.Type === "Class Mod"; }
  function distinct(arr) {
    const seen = new Set(), out = [];
    for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  }
  function findNamed(query, section, character) {
    const qFull = core(query, false);
    let q = core(query, true);
    if (!q.size) q = qFull;
    const exact = [], partial = [];
    if (q.size && letters(q) >= 3) {
      for (const it of GD.items) {
        for (const n of it.Names) {
          const nnFull = core(n, false);
          if (!nnFull.size || letters(nnFull) < 3) continue;
          if (setEquals(nnFull, qFull)) { exact.push(it); break; }
          const nn = core(n, true);
          if (!nn.size || letters(nn) < 3) continue;
          if (setEquals(nn, q)) { exact.push(it); break; }
          let common = 0;
          for (const w of nn) if (q.has(w)) common++;
          if (!common) continue;
          if (isSubset(nn, q) && q.size - nn.size <= 3) { partial.push([2 + letters(nn) / 100, it]); break; }
          if (isSubset(q, nn) && letters(q) / letters(nn) >= 0.5) { partial.push([1 + letters(q) / letters(nn), it]); break; }
        }
      }
      if (!exact.length && !partial.length) {
        const order = String(query || "").toLowerCase();
        const words = [...q].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const squashed = words.join("");
        if (squashed.length >= 5) {
          for (const it of GD.items) {
            const suffix = it.Comp.toLowerCase().replace(/^comp_\d\d_(?:legendary|pearl(?:escent)?)?_?/, "");
            if (suffix.replace(/[^a-z0-9]/g, "") === squashed) exact.push(it);
          }
        }
      }
    }
    let all = exact.length ? exact.slice() : partial.sort((a, b) => b[0] - a[0]).map((p) => p[1]);
    all = distinct(all);
    const hints = typeHints(query, section);
    if (hints.size) all = all.filter((i) => hints.has(i.Type)).concat(all.filter((i) => !hints.has(i.Type)));
    if (character) {
      const eq = (i) => i.Maker.toLowerCase() === character.toLowerCase();
      all = all.filter((i) => !isClassMod(i) || eq(i)).concat(all.filter((i) => isClassMod(i) && !eq(i)));
    }
    return all;
  }
  function pickVariant(it, level) {
    let used = Math.max(1, Math.min(LEVEL_CAP, level));
    for (let i = 0; i < it.Variants.length; i++) if (it.Variants[i][0] <= used) return { index: i, used: used };
    const low = it.Variants.length - 1;
    return { index: low, used: it.Variants[low][0] };
  }
  function describe(it) {
    let w = it.WhatItDoes || "";
    const dash = w.indexOf(" - ");
    if (dash >= 0) w = w.slice(dash + 3);
    w = w.trim();
    if (!w || w.toLowerCase() === "can be used for skin") return "";
    if (it.Names.some((n) => n.toLowerCase() === w.toLowerCase())) return "";
    return "  ·  " + w;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[_-]/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
  function ratio(a, b) {
    if (!a.length && !b.length) return 1;
    return 2 * matches(a, 0, a.length, b, 0, b.length) / (a.length + b.length);
  }
  function matches(a, alo, ahi, b, blo, bhi) {
    if (alo >= ahi || blo >= bhi) return 0;
    let besti = alo, bestj = blo, bestk = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (let j = blo; j < bhi; j++) {
        if (a.charCodeAt(i) !== b.charCodeAt(j)) continue;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bestk) { besti = i - k + 1; bestj = j - k + 1; bestk = k; }
      }
      j2len = next;
    }
    if (!bestk) return 0;
    return bestk + matches(a, alo, besti, b, blo, bestj) + matches(a, besti + bestk, ahi, b, bestj + bestk, bhi);
  }
  function searchCatalog(query, limit) {
    const q = norm(query);
    const out = [];
    if (!q) return out;
    const qset = new Set(q.split(" "));
    for (const r of GD.catalog) {
      let score, reason;
      if (q === r.name || q === r.ncs || r.aliases.indexOf(q) >= 0) { score = 1; reason = "exact name"; }
      else if (r.text.indexOf(q) >= 0) { score = q.length > 4 ? 0.92 : 0.82; reason = "substring"; }
      else {
        const tset = new Set(r.text.split(" "));
        let overlapN = 0;
        for (const w of qset) if (tset.has(w)) overlapN++;
        const overlap = overlapN / Math.max(1, qset.size);
        const head = r.text.slice(0, Math.min(r.text.length, Math.max(q.length * 3, 80)));
        const fuzzy = ratio(q, head);
        score = Math.max(overlap * 0.88, fuzzy * 0.75);
        reason = "fuzzy";
      }
      if (score >= 0.42) out.push({ score: score, row: r, reason: reason });
    }
    out.sort((a, b) => (b.score - a.score) || (b.row.label.length - a.row.label.length));
    const seen = new Set(), uniq = [];
    for (const c of out) {
      if (seen.has(c.row.code)) continue;
      seen.add(c.row.code);
      uniq.push(c);
      if (uniq.length >= (limit || 3)) break;
    }
    return uniq;
  }

  function blankResolution() {
    return {
      Query: "", Section: "", Label: "", Serial: null, Human: null, Code: null, Reason: "", Info: "", Note: "",
      Confidence: 0, FamilyId: null, Item: null, ManualCode: false, Alternatives: []
    };
  }
  function isSerial(r) { return !!(r && r.Serial); }
  function setManualCode(r, value) {
    const code = String(value == null ? "" : value).trim();
    if (code.length) {
      if (/\s/.test(code) || !tryParse(code)) throw new Error("Paste one complete @U item code. Part tokens and multiple codes are not accepted here.");
      const parsed = tryParse(code);
      if (GD.forbidden.has(parsed.family)) throw new Error("This item family is excluded by Build Forge.");
    }
    r.Serial = code.length ? code : null;
    r.Code = null;
    r.Item = null;
    r.Human = null;
    r.Alternatives = [];
    r.ManualCode = code.length > 0;
    r.Note = r.ManualCode ? "Manual code - decoded successfully; exact item/roll has not been verified." : "";
  }

  const SPEC_START = /^(?:barrel|grip|mag|magazine|scope|sight|body|stock|foregrip|underbarrel|element|firmware|augment|payload|class mod firmware|shield firmware|weapon firmware|repkit firmware|enhancement firmware|ordnance firmware)\b/i;
  const FILLER = new Set(["use", "the", "a", "an", "with", "part", "parts", "on", "it", "your", "equip", "get"]);
  function scorePart(spec, label) {
    const words = norm(spec).split(" ").filter((w) => w && !FILLER.has(w));
    if (!words.length) return 0;
    let joined = words.join(" ").replace(/^(?:class mod|shield|weapon|repkit|enhancement|ordnance|grenade)?\s*firmware\s+/, "");
    const name = norm(label.name), eff = norm(label.effects), ncs = norm(label.ncs), type = norm(label.partType);
    if (joined && (joined === name || joined === eff || joined === type)) return 1;
    const m = /^(barrel|grip|mag|magazine|scope|sight|body|foregrip|underbarrel|stock)\s*(\d+)?\s*([a-d])?$/.exec(joined);
    if (m && (m[2] || m[3])) {
      const kind = m[1] === "magazine" ? "mag" : m[1] === "sight" ? "scope" : m[1];
      const nw = ncs.split(" ").filter((w) => w.length);
      const ki = nw.indexOf(kind);
      if (ki < 0) return 0;
      const rest = nw.slice(ki + 1);
      const num = m[2] ? m[2].replace(/^0+/, "") : null;
      const let_ = m[3] || null;
      const isNum = rest.length > 0 && /^\d+$/.test(rest[0]);
      const rn = isNum ? rest[0].replace(/^0+/, "") : null;
      const rl = rest.length > 0 && /^[a-d]$/.test(rest[rest.length - 1]) && rest.length - (isNum ? 1 : 0) === 1 ? rest[rest.length - 1] : null;
      if (num != null && let_ != null) return rn === num && rl === let_ ? 0.95 : 0;
      if (let_ != null) return rl === let_ ? 0.9 : 0;
      return rn === num && rl == null && rest.length === (isNum ? 1 : 0) ? 0.9 : 0;
    }
    const spw = joined.split(" ").filter(Boolean);
    const hay = new Set((name + " " + eff + " " + ncs + " " + type).split(" ").filter(Boolean));
    if (spw.length && spw.every((w) => hay.has(w))) {
      const nameLen = Math.max(1, (name + " " + eff).split(" ").filter(Boolean).length);
      return 0.6 + 0.3 * Math.min(1, spw.length / nameLen);
    }
    return 0;
  }
  function parseTokens(text) {
    const i = text.indexOf("||");
    const header = text.slice(0, i + 2);
    const toks = [];
    const re = /\{(\d+)(?::(\d+|\[[\d\s]+\]))?\}/g;
    let m;
    const body = text.slice(i + 2);
    while ((m = re.exec(body))) {
      if (!m[2]) { toks.push({ fam: -1, sub: parseInt(m[1], 10) }); continue; }
      const v = m[2];
      if (v[0] === "[") for (const x of v.slice(1, -1).split(" ").filter(Boolean)) toks.push({ fam: parseInt(m[1], 10), sub: parseInt(x, 10) });
      else toks.push({ fam: parseInt(m[1], 10), sub: parseInt(v, 10) });
    }
    return { header: header, toks: toks };
  }
  function tokKey(fam, t) { return (t.fam < 0 ? fam : t.fam) + ":" + t.sub; }
  function applyMods(it, vi, specs) {
    const applied = [], skipped = [];
    const text = it.Variants[vi][1];
    if (!specs || !specs.length) return { text: text, applied: applied, skipped: skipped };
    const parsed = parseTokens(text);
    const alts = it.VarAlts[vi], bad = it.VarBad[vi];
    const comp = parsed.toks[0], body = parsed.toks.slice(1);
    const chosen = [], bySlot = new Map();
    for (const spec of specs) {
      let best = 0, bestAlt = -1, onItem = false;
      for (const t of body) {
        const l = GD.labels.get(tokKey(it.Family, t));
        if (!l) continue;
        const sc = scorePart(spec, l);
        if (sc > best) { best = sc; bestAlt = -1; onItem = true; }
      }
      for (let i = 0; i < alts.length; i++) {
        const l = GD.labels.get(alts[i].key);
        if (!l) continue;
        const sc = scorePart(spec, l);
        if (sc > best + 1e-9) { best = sc; bestAlt = i; onItem = false; }
      }
      if (best < 0.6) { skipped.push(spec + " (not a legit part for this item)"); continue; }
      if (onItem) { applied.push(spec + " (already on it)"); continue; }
      const a = alts[bestAlt], lab = GD.labels.get(a.key);
      const slot = lab.slot;
      if (bySlot.has(slot)) {
        const old = bySlot.get(slot);
        const idx = chosen.indexOf(old);
        if (idx >= 0) chosen.splice(idx, 1);
      }
      const clash = chosen.some((c) => bad.some((b) => (b[0] === c && b[1] === bestAlt) || (b[1] === c && b[0] === bestAlt)));
      if (clash) { skipped.push(spec + " (doesn't fit together with the other parts asked for)"); continue; }
      chosen.push(bestAlt);
      bySlot.set(slot, bestAlt);
      applied.push(spec + " -> " + (lab.name ? lab.name : lab.ncs));
    }
    if (!chosen.length) return { text: text, applied: applied, skipped: skipped };
    const rep = new Map(), ins = new Map();
    for (const c of chosen) {
      const a = alts[c];
      const p = a.key.split(":");
      const t = { fam: parseInt(p[0], 10), sub: parseInt(p[1], 10) };
      if (a.replace) rep.set(a.at, t);
      else {
        if (!ins.has(a.at)) ins.set(a.at, []);
        ins.get(a.at).push(t);
      }
    }
    const outToks = [comp];
    for (let i = 0; i <= body.length; i++) {
      if (ins.has(i)) outToks.push.apply(outToks, ins.get(i));
      if (i < body.length) outToks.push(rep.has(i) ? rep.get(i) : body[i]);
    }
    let sb = parsed.header;
    for (const t of outToks) {
      const fam = t.fam < 0 ? it.Family : t.fam;
      sb += " " + (fam === it.Family ? "{" + t.sub + "}" : "{" + fam + ":" + t.sub + "}");
    }
    sb += "|";
    return { text: sb, applied: applied, skipped: skipped };
  }

  function resolve(req, threshold) {
    if (threshold == null) threshold = 0.72;
    const out = [];
    const seen = new Set();
    const level = req.Level != null ? req.Level : LEVEL_CAP;
    for (const q of req.Queries || []) {
      const matches = findNamed(q.Text, q.Section, req.Character);
      if (matches.length) {
        const it = matches[0];
        if (seen.has(it)) continue;
        seen.add(it);
        const picked = pickVariant(it, level);
        const mod = applyMods(it, picked.index, q.Mods);
        const human = patchLevel(mod.text, picked.used);
        const r = blankResolution();
        r.Query = q.Text;
        r.Section = q.Section || "";
        r.Item = it;
        r.Label = it.Names.length ? it.Names[0] : it.Comp;
        r.Human = human;
        r.Serial = encode(human);
        r.Confidence = 1;
        r.FamilyId = it.Family;
        r.Reason = "named legendary (legit, complete)";
        r.Info = it.Maker + " " + it.Type + describe(it);
        r.Alternatives = matches.slice(1);
        const notes = [];
        if (picked.used !== Math.min(level, LEVEL_CAP)) notes.push("level raised to " + picked.used + " (lowest this item drops at)");
        if (mod.applied.length) notes.push("parts: " + mod.applied.join(", "));
        if (mod.skipped.length) notes.push("NOT applied: " + mod.skipped.join(", "));
        if (isClassMod(it) && req.Character && it.Maker.toLowerCase() !== req.Character.toLowerCase()) notes.push("page says " + req.Character + " but this is a " + it.Maker + " class mod");
        r.Note = notes.join("; ");
        out.push(r);
        continue;
      }
      const cands = searchCatalog(q.Text, 3);
      if (!cands.length) {
        const miss = blankResolution();
        miss.Query = q.Text;
        miss.Section = q.Section || "";
        miss.Reason = "no match";
        out.push(miss);
        continue;
      }
      const c = cands[0];
      const r = blankResolution();
      r.Query = q.Text;
      r.Section = q.Section || "";
      r.Code = c.score >= threshold ? c.row.code : null;
      r.Confidence = c.score;
      r.Label = c.row.label;
      r.FamilyId = c.row.family;
      r.Reason = c.reason;
      r.Info = c.row.what;
      out.push(r);
    }
    return out;
  }

  // ---------------------------------------------------------------- build page parser
  const CHARACTERS = ["Vex", "Rafa", "Amon", "Harlowe", "C4SH", "Loveless"];
  const SECTIONS = [
    ["classmod", ["class mod", "class mods", "classmod", "classmods", "com", "coms"]],
    ["shield", ["shield", "shields"]],
    ["enhancement", ["enhancement", "enhancements"]],
    ["repkit", ["repkit", "repkits", "repair kit", "repair kits"]],
    ["weapon", ["weapon", "weapons", "gun", "guns"]],
    ["ordnance", ["heavy ordnance", "ordnance"]],
    ["grenade", ["grenade", "grenades"]],
    ["firmware", ["firmware"]],
    ["specialization", ["specialization", "specializations"]]
  ];
  const STOP_WORDS = new Set(["gameplay", "notes", "changelog", "comments", "video guide", "strengths and weaknesses"]);
  const NAME_SEP = /\s*(?:,|;|&|\+| \/ |\band\b|\bplus\b)\s*/i;
  function cleanLine(s) {
    s = String(s || "").replace(/\s+/g, " ").replace(/^[ \t\-•|]+|[ \t\-•|]+$/g, "");
    s = s.replace(/^Image:\s*(?:presentation)?\s*/i, "").trim();
    return s;
  }
  function hostOf(source) { try { return new URL(source).host.toLowerCase(); } catch (e) { return ""; } }
  function detectAdapter(text, source) {
    const h = hostOf(source), low = text.toLowerCase();
    if (h.indexOf("mobalytics.gg") >= 0 || (low.indexOf("borderlands 4 build") >= 0 && low.indexOf("build variants") >= 0 && low.indexOf("firmware") >= 0)) return "mobalytics";
    if (h.indexOf("icy-veins.com") >= 0 || (low.indexOf("quick navigation") >= 0 && low.indexOf("skill trees") >= 0 && low.indexOf("build guide") >= 0)) return "icy-veins";
    if (h.indexOf("lootlemon.com") >= 0 || (low.indexOf("borderlands 4 skill tree calculator") >= 0 && low.indexOf("share build") >= 0)) return "lootlemon";
    if (h.indexOf("bl4tools.com") >= 0 || (low.indexOf("borderlands 4 build planner") >= 0 && low.indexOf("copy share link") >= 0)) return "bl4tools";
    if (h.indexOf("eridiyum.com") >= 0 || (low.indexOf("borderlands 4 planner") >= 0 && low.indexOf("community builds") >= 0)) return "eridiyum";
    return "generic";
  }
  function countRe(text, re) { const m = text.match(re); return m ? m.length : 0; }
  function extractCharacter(text, source) {
    const score = {}, firstPos = {};
    const url = String(source || "").toLowerCase();
    const head = text.split("\n").slice(0, 25).join("\n");
    for (const c of CHARACTERS) {
      let sc = 0;
      const e = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (url && new RegExp("(?<![a-z0-9])" + e.toLowerCase() + "(?![a-z0-9])").test(url)) sc += 5;
      if (new RegExp("\\bpresentation\\s*" + e + "\\b", "i").test(text)) sc += 6;
      sc += 3 * Math.min(2, countRe(text, new RegExp("(?:^|\\n)\\s*#*\\s*" + e + "\\b", "gi")));
      sc += Math.min(2, countRe(head, new RegExp("\\b" + e + "\\b", "gi")));
      sc += Math.min(2, 0.1 * countRe(text, new RegExp("\\b" + e + "\\b", "gi")));
      const m = new RegExp("\\b" + e + "\\b", "i").exec(text);
      if (m) firstPos[c] = m.index;
      score[c] = sc;
    }
    let best = "", bs = 0;
    for (const c of CHARACTERS) {
      const sc = score[c];
      if (sc > bs || (sc === bs && sc > 0 && firstPos[c] != null && best && firstPos[best] != null && firstPos[c] < firstPos[best])) { bs = sc; best = c; }
    }
    return best;
  }
  function extractLevel(text) {
    for (const p of [/\b(?:level|lvl)\s*[:#-]?\s*(\d{1,3})\b/i, /\b(\d{1,3})\s*(?:level|lvl)\b/i]) {
      const m = p.exec(text);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v >= 1 && v <= 100) return v;
      }
    }
    return null;
  }
  function sectionKey(line) {
    let s = cleanLine(line).toLowerCase().replace(/:$/, "");
    s = s.replace(/^#+\s*/, "").trim();
    if ((" " + s + " ").indexOf(" firmware ") >= 0 && s !== "firmware") return null;
    for (const pair of SECTIONS) if (pair[1].indexOf(s) >= 0) return pair[0];
    return null;
  }
  function isStopHeading(line) {
    const raw = cleanLine(line);
    const s = raw.replace(/^#+\s*/, "").trim().toLowerCase().replace(/:$/, "");
    if (STOP_WORDS.has(s)) return true;
    if (raw.startsWith("#") && sectionKey(raw) == null) return true;
    return false;
  }
  function addQ(qs, text, section) {
    if (!text || !String(text).trim()) return;
    if (qs.some((q) => q.Text.toLowerCase() === text.toLowerCase())) return;
    qs.push({ Text: text, Section: section, Mods: [] });
  }
  function splitNames(line) {
    if (isExactName(line)) return [line];
    const pieces = [];
    let pos = 0;
    const re = new RegExp(NAME_SEP.source, "gi");
    let m;
    while ((m = re.exec(line))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      pieces.push([pos, m.index]);
      pos = m.index + m[0].length;
    }
    pieces.push([pos, line.length]);
    if (pieces.length < 2) return [line];
    const out = [];
    let anyKnown = false, i = 0;
    while (i < pieces.length) {
      let take = i;
      for (let j = pieces.length - 1; j > i; j--) {
        if (isExactName(line.slice(pieces[i][0], pieces[j][1]))) { take = j; break; }
      }
      const t = line.slice(pieces[i][0], pieces[take][1]).trim();
      if (t) { out.push(t); if (isExactName(t)) anyKnown = true; }
      i = take + 1;
    }
    return anyKnown && out.length > 1 ? out : [line];
  }
  function takeInlineMods(line, mods) {
    let name = line.replace(/\(([^)]*)\)/g, (full, inner) => {
      const keep = [];
      for (const piece of inner.split(NAME_SEP)) {
        const p = piece.trim();
        if (!p) continue;
        if (SPEC_START.test(p)) mods.push(p);
        else keep.push(p);
      }
      return keep.length ? "(" + keep.join(", ") + ")" : "";
    });
    const wm = /\s+(?:with|w\/)\s+(.+)$/i.exec(name);
    if (wm && SPEC_START.test(wm[1].trim())) {
      for (const piece of wm[1].split(NAME_SEP)) if (piece.trim()) mods.push(piece.trim());
      name = name.slice(0, wm.index);
    }
    return name.replace(/\s+/g, " ").replace(/^[ \-:]+|[ \-:]+$/g, "");
  }
  function addGearLine(req, line, section) {
    if (SPEC_START.test(line)) {
      let last = null;
      for (let i = req.Queries.length - 1; i >= 0; i--) if (req.Queries[i].Section !== "firmware") { last = req.Queries[i]; break; }
      if (last) {
        for (const piece of line.split(NAME_SEP)) if (piece.trim()) last.Mods.push(piece.trim());
        return;
      }
    }
    for (const part of splitNames(line)) {
      const mods = [];
      const name = takeInlineMods(part, mods);
      if (name.length < 2) continue;
      addQ(req.Queries, name, section);
      const q = req.Queries.find((x) => x.Text.toLowerCase() === name.toLowerCase());
      if (q) for (const mod of mods) if (q.Mods.indexOf(mod) < 0) q.Mods.push(mod);
    }
  }
  const FIRMWARE_TARGETS = {
    "class mod": ["classmod"], shield: ["shield"], enhancement: ["enhancement"], repkit: ["repkit"],
    weapon: ["weapon"], ordnance: ["ordnance", "grenade"], grenade: ["grenade", "ordnance"]
  };
  function addFirmware(req, kind, val) {
    const secs = FIRMWARE_TARGETS[kind.toLowerCase()];
    if (secs) {
      let target = null;
      for (let i = req.Queries.length - 1; i >= 0; i--) if (secs.indexOf(req.Queries[i].Section) >= 0) { target = req.Queries[i]; break; }
      if (target) { target.Mods.push("firmware " + val); return; }
    }
    addQ(req.Queries, val, "firmware");
  }
  function addS(list, s) {
    if (!s || !String(s).trim()) return;
    if (!list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s);
  }
  function extractSafeSections(text, req) {
    let active = null;
    const gear = new Set(["classmod", "shield", "enhancement", "repkit", "weapon", "ordnance", "grenade"]);
    for (const raw of text.split("\n")) {
      const line = cleanLine(raw);
      if (!line) continue;
      const key = sectionKey(line);
      if (key) { active = key; continue; }
      if (/^(repkit\s*&\s*ordnance|utilities)$/i.test(line)) { active = null; continue; }
      if (isStopHeading(raw)) { active = null; continue; }
      let m = /^(Class Mod|Shield|Enhancement|Repkit|Weapon|Ordnance|Grenade)\s+Firmware\s+(.+)$/i.exec(line);
      if (m) {
        const val = cleanLine(m[2]);
        if (val && val.toLowerCase() !== "empty") addFirmware(req, m[1], val);
        continue;
      }
      m = /^Specialization\s+\d+\s+(.+)$/i.exec(line);
      if (m) {
        const val = cleanLine(m[1]);
        if (val && val.toLowerCase() !== "empty") addS(req.Specializations, val);
        continue;
      }
      if (active && gear.has(active)) {
        if (line.length >= 2 && line.length <= 80 && !/[.!?]$/.test(line) && !/^(try|get|use|main|best|great|good|stat|roll|with|for|the|a\s)/i.test(line)) addGearLine(req, line, active);
      } else if (active === "firmware") {
        if (line.length >= 2 && line.length <= 60 && !/[.!?]$/.test(line) && !/^(repkit|ordnance|utilities)$/i.test(line) && !/^(class mod|shield|enhancement|repkit|ordnance) firmware(?: empty)?$/i.test(line)) addQ(req.Queries, line, "firmware");
      } else if (active === "specialization") {
        if (line.length >= 2 && line.length <= 80 && !/[.!?]$/.test(line)) addS(req.Specializations, line);
      }
    }
  }
  function jsonName(x) {
    if (typeof x === "string") return x;
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    for (const k of ["name", "item", "title"]) if (x[k] != null) return str(x[k]);
    return null;
  }
  function blankRequest(source) {
    return { Source: source || "", Character: "", Adapter: "generic", Author: "", Level: null, Queries: [], Skills: [], Specializations: [] };
  }
  function parseBuild(blob, source) {
    let text = String(blob || "").trim();
    const req = blankRequest(source || "");
    const author = /(?:^|\n)\s*By\s+(?:\r?\n\s*)?([^\r\n]{1,100})/i.exec(text);
    if (author) req.Author = author[1].trim();
    if (!text) return req;
    if (text.startsWith("{")) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          req.Adapter = "json";
          req.Character = str(obj.character || obj.vault_hunter || obj.class);
          if (obj.level != null) req.Level = num(obj.level);
          const gearMap = { class_mod: "classmod", classmod: "classmod", shield: "shield", enhancement: "enhancement", repkit: "repkit", repair_kit: "repkit" };
          for (const k of Object.keys(gearMap)) { const n = jsonName(obj[k]); if (n) addQ(req.Queries, n, gearMap[k]); }
          const gear = obj.gear || obj.equipment;
          if (gear && typeof gear === "object") {
            for (const key of Object.keys(gear)) {
              const kl = key.toLowerCase().replace(/[-\s]/g, "_");
              const sec = kl.indexOf("class") >= 0 ? "classmod" : kl.indexOf("shield") >= 0 ? "shield" : kl.indexOf("enhancement") >= 0 ? "enhancement"
                : (kl.indexOf("repkit") >= 0 || kl.indexOf("repair") >= 0) ? "repkit" : kl.indexOf("grenade") >= 0 ? "grenade"
                  : (kl.indexOf("weapon") >= 0 || kl.indexOf("gun") >= 0) ? "weapon" : null;
              if (!sec) continue;
              const n = jsonName(gear[key]);
              if (n) addQ(req.Queries, n, sec);
            }
          }
          for (const s of obj.skills || []) addS(req.Skills, str(s));
          const sp = obj.specializations != null ? obj.specializations : obj.specialization;
          if (typeof sp === "string") addS(req.Specializations, sp);
          else if (Array.isArray(sp)) for (const s of sp) addS(req.Specializations, str(s));
          return req;
        }
      } catch (e) { /* fall through to text */ }
    }
    const low = text.toLowerCase();
    if (low.indexOf("<html") >= 0 || low.indexOf("<body") >= 0) text = htmlToText(text, true);
    req.Adapter = detectAdapter(text, source || "");
    req.Character = extractCharacter(text, source || "");
    req.Level = extractLevel(text);
    extractSafeSections(text, req);
    if (req.Adapter === "icy-veins") {
      for (const raw of text.split("\n")) {
        const m = /^(?:Action Skill|Augment|Capstone|\d+(?:-\d+)?)\s*\|\s*([^|]+?)\s*\|/i.exec(cleanLine(raw));
        if (m) {
          const v = cleanLine(m[1]);
          if (v && v.toLowerCase() !== "skill" && v.toLowerCase() !== "skill tree") addS(req.Skills, v);
        }
      }
    } else if (req.Adapter === "lootlemon" || req.Adapter === "bl4tools" || req.Adapter === "eridiyum") {
      for (const raw of text.split("\n")) {
        const re = /([A-Za-z][A-Za-z'’\- ]{1,50}?)\s+([1-9]\d*)\/(\d+)\s*(?:passive|active|capstone|augment)?/ig;
        let m;
        const line = cleanLine(raw);
        while ((m = re.exec(line))) addS(req.Skills, cleanLine(m[1]));
      }
    }
    for (const raw of text.split("\n")) {
      const m = /^(Class Mod|Classmod|Shield|Enhancement|Repkit|Repair Kit|Weapon|Heavy Ordnance|Ordnance|Grenade)\s*:\s*(.+)$/i.exec(cleanLine(raw));
      if (!m) continue;
      const lab = m[1].toLowerCase();
      const sec = lab.startsWith("class") ? "classmod" : lab === "shield" ? "shield" : lab === "enhancement" ? "enhancement"
        : lab.startsWith("rep") ? "repkit" : lab === "weapon" ? "weapon" : lab === "grenade" ? "grenade" : "ordnance";
      addGearLine(req, cleanLine(m[2]), sec);
    }
    return req;
  }

  // ---------------------------------------------------------------- HTML ingest
  function htmlDecode(s) {
    return String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, ent) => {
      const e = ent.toLowerCase();
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      if (e === "nbsp") return " ";
      if (e[0] === "#") {
        const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCharCode(n) : full;
      }
      return full;
    });
  }
  function cleanText(s) {
    const lines = [];
    for (const l of htmlDecode(s).split("\n")) {
      const t = l.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }
    return lines.join("\n");
  }
  function htmlToText(html, includeAlts) {
    const max = 16 * 1024 * 1024;
    let body = String(html).replace(/<(script|style|noscript|svg|template)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi, "\n");
    const alts = [];
    if (includeAlts) {
      const re = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let m;
      while ((m = re.exec(body))) {
        const a = htmlDecode(m[1] || m[2] || m[3] || "").trim();
        if (a.length > 1 && a.length <= 200 && !/^presentation$/i.test(a)) alts.push(a);
        if (alts.length >= 5000) break;
      }
    }
    let text = cleanText(body.replace(/<[^>]{0,8192}>/g, "\n"));
    if (alts.length) text += "\n" + alts.join("\n");
    return text.length > max ? text.slice(0, max) : text;
  }
  function providerOf(url) {
    let h = "";
    try { h = new URL(url).host.toLowerCase(); } catch (e) { return ""; }
    if (h.indexOf("drive.google.com") >= 0 || h.indexOf("drive.usercontent.google.com") >= 0) return "google-drive";
    if (h.indexOf("dropbox.com") >= 0) return "dropbox";
    if (h.indexOf("github.com") >= 0 || h.indexOf("githubusercontent.com") >= 0) return "github";
    return h;
  }
  function isHttp(u) { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch (e) { return false; } }
  const SAVE_WORD = /\b(save\s*file|savefile|pc\s*save|download\s*save|creator\s*save)\b/i;
  function candidate(url, label, baseUrl) {
    url = htmlDecode(String(url || "").trim());
    if (url.startsWith("#")) return null;
    if (baseUrl && url && !isHttp(url)) {
      try { url = new URL(url, baseUrl).toString(); } catch (e) { return null; }
    }
    if (!isHttp(url)) return null;
    label = htmlDecode(String(label || "").trim());
    const comb = (label + " " + url).toLowerCase();
    let path = "";
    try { path = new URL(url).pathname.toLowerCase(); } catch (e) { return null; }
    const ext = [".yaml", ".yml", ".sav", ".txt", ".zip"].some((e) => path.endsWith(e));
    const ctx = SAVE_WORD.test(comb);
    const prov = providerOf(url);
    const known = prov === "google-drive" || prov === "dropbox" || prov === "github";
    if (!(ext || ctx || (known && comb.indexOf("save") >= 0))) return null;
    return { Url: url, Label: label.length > 160 ? label.slice(0, 160) : label, Provider: prov, Score: (ctx ? 5 : 0) + (ext ? 4 : 0) + (known ? 2 : 0) };
  }
  function addIds(text, ids) {
    const re = /(?<!\d)(7\d{16})(?!\d)/g;
    let m;
    while ((m = re.exec(text))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  }
  function addUrlCandidates(text, baseUrl, list, seen) {
    const re = /https?:\/\/[^\s<>"']+/g;
    let m;
    while ((m = re.exec(text))) {
      const c = candidate(m[0].replace(/[).,;\]]+$/g, ""), "", baseUrl);
      if (c && !seen.has(c.Url)) { seen.add(c.Url); list.push(c); }
    }
  }
  function scanHtml(html, baseUrl) {
    const list = [], ids = [], seen = new Set();
    const noScript = String(html).replace(/<(script|style|noscript|svg|template)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi, "\n");
    const anchorHrefs = new Set();
    const are = /<a\b([^>]{0,4096})>([\s\S]{0,2048}?)<\/a\s*>/gi;
    let am;
    while ((am = are.exec(noScript))) {
      const hm = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(am[1]);
      if (!hm) continue;
      const href = hm[1] || hm[2] || hm[3] || "";
      const label = htmlDecode(am[2].replace(/<[^>]{0,8192}>/g, " ")).replace(/\s+/g, " ").trim();
      anchorHrefs.add(href);
      const c = candidate(href, label, baseUrl || "");
      if (c && !seen.has(c.Url)) { seen.add(c.Url); list.push(c); }
    }
    const hrefRe = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let hm;
    while ((hm = hrefRe.exec(noScript))) {
      const href = hm[1] || hm[2] || hm[3] || "";
      if (anchorHrefs.has(href)) continue;
      const c = candidate(href, "", baseUrl || "");
      if (c && !seen.has(c.Url)) { seen.add(c.Url); list.push(c); }
    }
    const text = htmlToText(html, true);
    addIds(html, ids);
    addUrlCandidates(text, baseUrl || "", list, seen);
    list.sort((a, b) => b.Score - a.Score);
    return { SourceUrl: "", Text: text, SaveCandidates: list, AccountIds: ids, Mode: "html" };
  }
  function scanText(text, baseUrl) {
    text = String(text || "");
    if (text.length > 16 * 1024 * 1024) text = text.slice(0, 16 * 1024 * 1024);
    const list = [], ids = [], seen = new Set();
    if (text.indexOf("<") >= 0 && text.toLowerCase().indexOf("href") >= 0) {
      const hrefRe = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let m;
      while ((m = hrefRe.exec(text))) {
        const c = candidate(m[1] || m[2] || m[3] || "", "", baseUrl || "");
        if (c && !seen.has(c.Url)) { seen.add(c.Url); list.push(c); }
      }
    }
    addUrlCandidates(text, baseUrl || "", list, seen);
    addIds(text, ids);
    list.sort((a, b) => b.Score - a.Score);
    return { SourceUrl: "", Text: text, SaveCandidates: list, AccountIds: ids, Mode: "clipboard" };
  }
  function driveId(url) {
    let m = /\/file\/d\/([^/?#]+)/.exec(url);
    if (m) return m[1];
    m = /[?&](?:id|file_id)=([^&#]+)/.exec(url);
    return m ? m[1] : null;
  }
  function directDownloadUrl(url) {
    let host = "";
    try { host = new URL(url).host.toLowerCase(); } catch (e) { return url; }
    if (host.indexOf("drive.google.com") >= 0) {
      const id = driveId(url);
      if (id) return "https://drive.usercontent.google.com/download?id=" + id + "&export=download&confirm=t";
    }
    if (host.indexOf("dropbox.com") >= 0) {
      if (/([?&])dl=/.test(url)) return url.replace(/([?&])dl=0\b/, "$1dl=1");
      return url + (url.indexOf("?") >= 0 ? "&" : "?") + "dl=1";
    }
    return url;
  }
  function looksLikeTextSave(data) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray ? data.subarray(0, Math.min(8192, data.length)) : data);
    return /(^|\n)\s*(state|domains|profile|unlockables)\s*:/i.test(head);
  }
  function looksYaml(data) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    const s = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, Math.min(8000, b.length)));
    return /^\s*(%YAML|state\s*:|domains\s*:|profile\s*:)|profile_guid\s*:/im.test(s);
  }
  class BrowserCheckError extends Error {
    constructor() { super("This site requires browser verification. Use Open in browser, then Paste page text."); this.name = "BrowserCheckError"; }
  }
  function checkBody(body, status, ctype, kind) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body || []);
    if (!bytes.length) throw new Error("empty response (HTTP " + (status || "?") + ")");
    const low = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(65536, bytes.length))).toLowerCase();
    const challenge = low.indexOf("cf-browser-verification") >= 0 || low.indexOf("challenge-platform") >= 0 || low.indexOf("<title>just a moment") >= 0 || low.indexOf("attention required! | cloudflare") >= 0;
    if (challenge && (status === "403" || status === "429" || status === "503" || bytes.length < 200000)) throw new BrowserCheckError();
    if (status && String(status).charAt(0) !== "2") throw new Error("HTTP " + status);
    if (kind === "html") {
      const looks = low.indexOf("<html") >= 0 || low.indexOf("<!doctype") >= 0 || low.indexOf("<body") >= 0 || low.indexOf("<div") >= 0;
      const c = String(ctype || "").toLowerCase();
      if (c && c.indexOf("html") < 0 && c.indexOf("xml") < 0 && !looks) throw new Error("URL returned " + c.split(";")[0] + ", not a web page");
    }
  }
  function failureSummary(error) {
    let message = (error && error.message) || "Unknown connection error";
    if (/clixml/i.test(message) || message.indexOf("<Objs") >= 0) return "Windows PowerShell could not download the page. Details are in the import log.";
    message = message.replace(/\r/g, " ").replace(/\n/g, " ").trim();
    return message.length > 220 ? message.slice(0, 220) + "..." : message;
  }
  function unzip(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let eocd = -1;
    const start = Math.max(0, u.length - 22 - 65536);
    for (let i = u.length - 22; i >= start; i--) {
      if (u[i] === 0x50 && u[i + 1] === 0x4b && u[i + 2] === 0x05 && u[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Archive contained no .sav/.yaml/.yml/.txt save.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count && p + 46 <= u.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nameLen));
      entries.push({ method: method, compSize: compSize, name: name, localOff: localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const order = { ".yaml": 0, ".yml": 1, ".txt": 2, ".sav": 3 };
    const found = entries.filter((e) => {
      const base = e.name.split("/").pop();
      const dot = base.lastIndexOf(".");
      const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
      return order[ext] != null && e.compSize < 64 * 1024 * 1024 && !e.name.endsWith("/");
    }).sort((a, b) => {
      const ea = a.name.slice(a.name.lastIndexOf(".")).toLowerCase();
      const eb = b.name.slice(b.name.lastIndexOf(".")).toLowerCase();
      return (order[ea] - order[eb]) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }).slice(0, 20);
    if (!found.length) throw new Error("Archive contained no .sav/.yaml/.yml/.txt save.");
    return found.map((e) => {
      if (e.localOff + 30 > u.length || dv.getUint32(e.localOff, true) !== 0x04034b50) throw new Error("Archive contained no .sav/.yaml/.yml/.txt save.");
      const nameLen = dv.getUint16(e.localOff + 26, true);
      const extraLen = dv.getUint16(e.localOff + 28, true);
      const dataOff = e.localOff + 30 + nameLen + extraLen;
      const slice = u.subarray(dataOff, dataOff + e.compSize);
      let data;
      if (e.method === 0) data = slice;
      else if (e.method === 8) data = inflateRaw(slice);
      else throw new Error("This zip uses a compression method the page cannot open. Unzip it, then load the save file.");
      return { name: e.name.split("/").pop(), bytes: data };
    });
  }

  // ---------------------------------------------------------------- saves
  const BASE_KEY = new Uint8Array([
    0x35, 0xec, 0x33, 0x77, 0xf3, 0x5d, 0xb0, 0xea, 0xbe, 0x6b, 0x83, 0x11, 0x54, 0x03, 0xeb, 0xfb,
    0x27, 0x25, 0x64, 0x2e, 0xd5, 0x49, 0x06, 0x29, 0x05, 0x78, 0xbd, 0x60, 0xba, 0x4a, 0xa7, 0x87
  ]);
  const STEAM_BASE = 76561197960265728n;
  function normalizeId(raw) {
    const s = String(raw || "").trim();
    const digits = s.replace(/\D/g, "");
    if (/^\d{10,20}$/.test(digits)) return digits;
    const h = s.toLowerCase().startsWith("0x") ? s.slice(2).toLowerCase() : s.toLowerCase();
    if (/^[0-9a-f]{16}$/.test(h)) return BigInt("0x" + h).toString(10);
    return "";
  }
  function keyCandidates(id) {
    const n = normalizeId(id);
    if (!n) throw new Error("Account ID required (your SteamID64, the 17-digit number starting with 765).");
    const p = BigInt(n);
    const vals = [p];
    if (p >= STEAM_BASE && vals.indexOf(p - STEAM_BASE) < 0) vals.push(p - STEAM_BASE);
    const low = p & 0xffffffffn;
    if (vals.indexOf(low) < 0) vals.push(low);
    return vals.filter((v) => v > 0n);
  }
  function saveKey(account) {
    const k = new Uint8Array(BASE_KEY);
    let v = account;
    for (let i = 0; i < 8; i++) { k[i] ^= Number(v & 0xffn); v >>= 8n; }
    return k;
  }
  function u32le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function detectTrailer(pt, yaml) {
    const len = u32le(yaml.length);
    for (let p = pt.length - 4; p >= Math.max(0, pt.length - 40); p--) {
      if (pt[p] !== len[0] || pt[p + 1] !== len[1] || pt[p + 2] !== len[2] || pt[p + 3] !== len[3]) continue;
      if (p >= 4) {
        const prev = (pt[p - 4] | (pt[p - 3] << 8) | (pt[p - 2] << 16) | (pt[p - 1] << 24)) >>> 0;
        if (prev === adler32(yaml)) return "adler";
      }
      return "plain";
    }
    return "plain";
  }
  function decryptSave(raw, accountId) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (looksYaml(bytes)) return { text: new TextDecoder("utf-8").decode(bytes), format: "yaml" };
    const variants = [];
    for (let trim = 0; trim < 16; trim++) {
      const n = bytes.length - trim;
      if (n >= 16 && n % 16 === 0) variants.push(bytes.subarray(0, n));
    }
    let last = null;
    for (const acct of keyCandidates(accountId)) {
      const key = saveKey(acct);
      for (const c of variants) {
        let pt;
        try { pt = aesEcb(key, c, false); } catch (e) { last = e; continue; }
        for (let off = 0; off < Math.min(4096, pt.length - 2); off++) {
          if (pt[off] !== 0x78 || (((pt[off] << 8) | pt[off + 1]) % 31) !== 0) continue;
          let yaml;
          try { yaml = inflateRaw(pt.subarray(off + 2)); } catch (e) { last = e; continue; }
          if (!looksYaml(yaml)) continue;
          return { text: new TextDecoder("utf-8").decode(yaml), format: detectTrailer(pt, yaml) };
        }
      }
    }
    throw new Error("Could not decrypt this save - wrong account ID, or not a BL4 save." + (last ? " (" + last.message + ")" : ""));
  }
  function concatBytes(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const o = new Uint8Array(n);
    let i = 0;
    for (const p of parts) { o.set(p, i); i += p.length; }
    return o;
  }
  function encryptSave(yaml, accountId, format) {
    const data = new TextEncoder().encode(yaml);
    const body = [zlibWrap(data)];
    if (format === "adler") {
      body.push(u32le(adler32(data)));
      body.push(u32le(data.length));
      let joined = concatBytes(body);
      const n = 16 - (joined.length % 16);
      const pad = new Uint8Array(n);
      pad.fill(n);
      joined = concatBytes([joined, pad]);
      return aesEcb(saveKey(keyCandidates(accountId)[0]), joined, true);
    }
    body.push(u32le(data.length));
    let joined = concatBytes(body);
    const n = (16 - (joined.length % 16)) % 16;
    if (n) {
      const pad = new Uint8Array(n);
      pad.fill(n);
      joined = concatBytes([joined, pad]);
    }
    return aesEcb(saveKey(keyCandidates(accountId)[0]), joined, true);
  }

  function SaveDoc(text) {
    const src = String(text || "");
    this.Newline = src.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
    this.Lines = src.replace(/\r\n/g, "\n").split("\n");
    this.Format = "plain";
    this.Path = "";
  }
  SaveDoc.prototype.text = function () { return this.Lines.join(this.Newline); };
  SaveDoc.prototype.kind = function () {
    for (const l of this.Lines) {
      if (l.startsWith("state:")) return "character";
      if (l.startsWith("domains:") || l.startsWith("profile:")) return "profile";
    }
    return "unknown";
  };
  function indentOf(l) { let i = 0; while (i < l.length && l[i] === " ") i++; return i; }
  const KEY_RE = /^(\s*)([A-Za-z0-9_]+|'[^']*'|"[^"]*"):(?:\s+(.*))?\s*$/;
  const SERIAL_RE = /^(\s*(?:-\s+)?serial:\s*)(['"]?)(@U[^'"\s]*)(['"]?)\s*$/;
  SaveDoc.prototype.serials = function () {
    const o = [];
    for (let i = 0; i < this.Lines.length; i++) {
      const m = SERIAL_RE.exec(this.Lines[i]);
      if (!m) continue;
      const s = { line: i, prefix: m[1], quote: m[2], serial: m[3], family: 0, level: 0 };
      const parsed = tryParse(s.serial);
      if (parsed) { s.family = parsed.family; s.level = parsed.level; }
      o.push(s);
    }
    return o;
  };
  SaveDoc.prototype.findPath = function (path) {
    const stack = [];
    for (let i = 0; i < this.Lines.length; i++) {
      const l = this.Lines[i];
      const trim = l.trim();
      if (!trim || trim.startsWith("#") || trim.startsWith("- ")) continue;
      const m = KEY_RE.exec(l);
      if (!m) continue;
      const ind = m[1].length;
      while (stack.length && stack[stack.length - 1][0] >= ind) stack.pop();
      stack.push([ind, m[2].replace(/^['"]|['"]$/g, "")]);
      if (stack.length === path.length && stack.every((x, n) => x[1] === path[n])) return i;
    }
    return -1;
  };
  SaveDoc.prototype.blockEnd = function (keyLine) {
    const ind = indentOf(this.Lines[keyLine]);
    let i = keyLine + 1;
    while (i < this.Lines.length && (!this.Lines[i].trim() || indentOf(this.Lines[i]) > ind || (indentOf(this.Lines[i]) === ind && this.Lines[i].trim().startsWith("- ")))) i++;
    while (i - 1 > keyLine && !this.Lines[i - 1].trim()) i--;
    return i;
  };
  SaveDoc.prototype.inventoryCodes = function (equipped, backpack, dedupe) {
    const ranges = [];
    if (equipped) {
      const key = this.findPath(["state", "inventory", "equipped_inventory", "equipped"]);
      if (key >= 0) ranges.push([key, this.blockEnd(key)]);
    }
    if (backpack) {
      const key = this.findPath(["state", "inventory", "items", "backpack"]);
      if (key >= 0) ranges.push([key, this.blockEnd(key)]);
    }
    let codes = this.serials().filter((s) => ranges.some((r) => s.line > r[0] && s.line < r[1])).map((s) => s.serial);
    if (dedupe) codes = distinct(codes);
    return codes;
  };
  SaveDoc.prototype.characterLevel = function (set) {
    const exp = this.findPath(["state", "experience"]);
    if (exp < 0) return null;
    const end = this.blockEnd(exp);
    let i = exp + 1;
    while (i < end) {
      if (!this.Lines[i].trim().startsWith("- ")) { i++; continue; }
      const dash = indentOf(this.Lines[i]);
      let j = i + 1;
      while (j < end && !(indentOf(this.Lines[j]) === dash && this.Lines[j].trim().startsWith("- "))) j++;
      let isChar = false, levelLine = -1;
      for (let k = i; k < j; k++) {
        const t = this.Lines[k].trim().replace(/^-+\s*/, "");
        const m = /^type:\s*['"]?([A-Za-z_]+)/.exec(t);
        if (m && m[1].toLowerCase() === "character") isChar = true;
        if (/^level:\s*\d+/.test(t)) levelLine = k;
      }
      if (isChar && levelLine >= 0) {
        const lm = /^(.*level:\s*)(\d+)(.*)$/.exec(this.Lines[levelLine]);
        if (set != null) { this.Lines[levelLine] = lm[1] + set + lm[3]; return set; }
        return parseInt(lm[2], 10);
      }
      i = j;
    }
    return null;
  };
  SaveDoc.prototype.setSerial = function (s, serial) {
    const q = s.quote ? s.quote : "'";
    const nl = s.prefix + q + serial + q;
    if (this.Lines[s.line] === nl) return false;
    this.Lines[s.line] = nl;
    return true;
  };
  SaveDoc.prototype.addItem = function (serial) {
    if (this.serials().some((s) => s.serial === serial)) return "already in save";
    let key = this.findPath(["state", "inventory", "items", "backpack"]);
    let where = "backpack";
    if (key < 0) { key = this.findPath(["domains", "local", "shared", "inventory", "items", "bank"]); where = "bank"; }
    if (key < 0) throw new Error("No backpack/bank found in this save.");
    const ind = indentOf(this.Lines[key]);
    if (/:\s*\{\s*\}\s*$/.test(this.Lines[key])) this.Lines[key] = this.Lines[key].replace(/:\s*\{\s*\}\s*$/, ":");
    const end = this.blockEnd(key);
    let childInd = ind + 2;
    for (let i = key + 1; i < end; i++) if (this.Lines[i].trim()) { childInd = indentOf(this.Lines[i]); break; }
    const used = new Set();
    for (let i = key + 1; i < end; i++) {
      const m = /^\s*slot_(\d+):/.exec(this.Lines[i]);
      if (m && indentOf(this.Lines[i]) === childInd) used.add(parseInt(m[1], 10));
    }
    let slot = 0;
    while (used.has(slot)) slot++;
    const block = [new Array(childInd + 1).join(" ") + "slot_" + slot + ":", new Array(childInd + 3).join(" ") + "serial: '" + serial + "'"];
    this.Lines.splice(end, 0, block[0], block[1]);
    return where + " slot_" + slot;
  };

  // ---------------------------------------------------------------- build files
  function packItem(it) {
    if (!it) return null;
    return {
      Family: it.Family, Sub: it.Sub, MinLevel: it.MinLevel, Comp: it.Comp, Maker: it.Maker,
      Type: it.Type, WhatItDoes: it.WhatItDoes || "", Human: it.Human || "", Names: it.Names || []
    };
  }
  function packResolution(r) {
    return {
      Query: r.Query, Section: r.Section || "", Label: r.Label || "", Serial: r.Serial || null, Human: r.Human || null,
      Code: r.Code || null, Reason: r.Reason || "", Info: r.Info || "", Note: r.Note || "", Confidence: r.Confidence || 0,
      FamilyId: r.FamilyId == null ? null : r.FamilyId, Item: packItem(r.Item), ManualCode: !!r.ManualCode,
      Alternatives: (r.Alternatives || []).map(packItem)
    };
  }
  function serializeBuild(saved) {
    const build = saved.Build ? {
      Source: saved.Build.Source || "", Character: saved.Build.Character || "", Adapter: saved.Build.Adapter || "",
      Author: saved.Build.Author || "", Level: saved.Build.Level == null ? null : saved.Build.Level,
      Queries: (saved.Build.Queries || []).map((q) => ({ Text: q.Text, Section: q.Section, Mods: q.Mods || [] })),
      Skills: saved.Build.Skills || [], Specializations: saved.Build.Specializations || []
    } : null;
    return JSON.stringify({
      format: "BL4BuildForge-build",
      version: 1,
      build: {
        Url: saved.Url || "", PageText: saved.PageText || "", SaveUrl: saved.SaveUrl || "", ItemsOnly: saved.ItemsOnly !== false,
        Name: saved.Name || "", Description: saved.Description || "", Notes: saved.Notes || "",
        Build: build, Results: (saved.Results || []).map(packResolution),
        Links: (saved.Links || []).map((l) => ({ Url: l.Url, Label: l.Label || "", Provider: l.Provider || "", Score: l.Score || 0 }))
      }
    }, null, 2);
  }
  function asObject(v, message) {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(message || "Invalid build field.");
    return v;
  }
  function unpackItem(data) {
    if (data == null) return null;
    const d = asObject(data, "Build file contains invalid catalog details.");
    const it = {
      Family: num(d.Family), Sub: num(d.Sub), MinLevel: d.MinLevel == null ? 1 : num(d.MinLevel),
      Comp: d.Comp == null ? "" : mustString(d.Comp), Maker: d.Maker == null ? "" : mustString(d.Maker),
      Type: d.Type == null ? "" : mustString(d.Type), WhatItDoes: d.WhatItDoes == null ? "" : mustString(d.WhatItDoes),
      Human: d.Human == null ? "" : mustString(d.Human), Names: d.Names == null ? [] : mustStringList(d.Names),
      Variants: [], VarAlts: [], VarBad: []
    };
    if (d.Names === null) it.Names = null;
    return it;
  }
  function mustString(v) { if (typeof v !== "string") throw new Error("Invalid text field."); return v; }
  function mustStringList(v) {
    if (!Array.isArray(v)) throw new Error("Invalid list field.");
    return v.map(mustString);
  }
  function deserializeBuild(text) {
    let root;
    try { root = JSON.parse(String(text).replace(/^\uFEFF/, "")); }
    catch (e) { throw new Error(/unexpected/i.test(e.message) ? "Unexpected data after JSON." : e.message); }
    root = asObject(root, "This is not a supported Build Forge build file.");
    if (root.format !== "BL4BuildForge-build" || Number(root.version) !== 1) throw new Error("This is not a supported Build Forge build file.");
    const data = asObject(root.build, "Build file is missing required content.");
    const saved = {
      Url: data.Url == null ? "" : data.Url,
      PageText: data.PageText == null ? "" : data.PageText,
      SaveUrl: data.SaveUrl == null ? "" : data.SaveUrl,
      ItemsOnly: data.ItemsOnly == null ? true : data.ItemsOnly,
      Name: data.Name == null ? "" : data.Name,
      Description: data.Description == null ? "" : data.Description,
      Notes: data.Notes == null ? "" : data.Notes,
      Build: null,
      Results: data.Results == null ? [] : data.Results,
      Links: data.Links == null ? [] : data.Links
    };
    if (saved.Results == null || saved.Links == null || saved.Url == null || saved.PageText == null || saved.SaveUrl == null) throw new Error("Build file is missing required content.");
    if (typeof saved.Url !== "string" || typeof saved.PageText !== "string" || typeof saved.SaveUrl !== "string" || typeof saved.ItemsOnly !== "boolean" || !Array.isArray(saved.Results) || !Array.isArray(saved.Links)) throw new Error("Build file is missing required content.");
    if (typeof saved.Name !== "string" || typeof saved.Description !== "string" || typeof saved.Notes !== "string") throw new Error("Invalid text field.");
    if (data.Build != null) {
      const b = asObject(data.Build, "Build metadata is incomplete.");
      saved.Build = {
        Source: b.Source == null ? "" : b.Source,
        Character: b.Character == null ? "" : b.Character,
        Adapter: b.Adapter == null ? "" : b.Adapter,
        Author: b.Author == null ? "" : b.Author,
        Level: b.Level == null ? null : num(b.Level),
        Queries: b.Queries == null ? [] : b.Queries,
        Skills: b.Skills == null ? [] : b.Skills,
        Specializations: b.Specializations == null ? [] : b.Specializations
      };
      const meta = saved.Build;
      if (meta.Character == null || meta.Author == null || meta.Source == null || meta.Adapter == null || meta.Queries == null || meta.Skills == null || meta.Specializations == null) throw new Error("Build metadata is incomplete.");
      if ([meta.Character, meta.Author, meta.Source, meta.Adapter].some((x) => typeof x !== "string") || !Array.isArray(meta.Queries) || !Array.isArray(meta.Skills) || !Array.isArray(meta.Specializations)) throw new Error("Build metadata is incomplete.");
      meta.Skills = mustStringList(meta.Skills);
      meta.Specializations = mustStringList(meta.Specializations);
      meta.Queries = meta.Queries.map((q) => {
        const o = asObject(q, "Invalid build field.");
        return { Text: o.Text == null ? "" : mustString(o.Text), Section: o.Section == null ? "" : mustString(o.Section), Mods: o.Mods == null ? [] : mustStringList(o.Mods) };
      });
    }
    saved.Links = saved.Links.map((link) => {
      if (!link || link.Url == null || link.Label == null || link.Provider == null) throw new Error("Build file contains an invalid save link.");
      return { Url: mustString(link.Url), Label: mustString(link.Label), Provider: mustString(link.Provider), Score: num(link.Score) };
    });
    saved.Results = saved.Results.map((row) => {
      if (!row || row.Label == null || row.Query == null || row.Alternatives == null || row.Note == null || row.Info == null) throw new Error("Build file contains an invalid item row.");
      const r = blankResolution();
      r.Query = mustString(row.Query);
      r.Section = row.Section == null ? "" : mustString(row.Section);
      r.Label = mustString(row.Label);
      r.Serial = row.Serial == null ? null : mustString(row.Serial);
      r.Human = row.Human == null ? null : mustString(row.Human);
      r.Code = row.Code == null ? null : mustString(row.Code);
      r.Reason = row.Reason == null ? "" : mustString(row.Reason);
      r.Info = mustString(row.Info);
      r.Note = mustString(row.Note);
      r.Confidence = row.Confidence == null ? 0 : Number(row.Confidence);
      r.FamilyId = row.FamilyId == null ? null : num(row.FamilyId);
      r.ManualCode = !!row.ManualCode;
      r.Item = unpackItem(row.Item);
      r.Alternatives = row.Alternatives.map(unpackItem);
      if (r.Alternatives.some((item) => item == null || item.Names == null) || (r.Item && r.Item.Names == null)) throw new Error("Build file contains invalid catalog details.");
      if (isSerial(r)) {
        const parsed = tryParse(r.Serial);
        if (!parsed || GD.forbidden.has(parsed.family)) throw new Error("Build file contains an unreadable or excluded item code.");
      }
      return r;
    });
    return saved;
  }

  return {
    version: VERSION,
    levelCap: LEVEL_CAP,
    themeNames: THEME_NAMES,
    themePalette: themePalette,
    contrast: contrast,
    loadData: loadData,
    itemCount: function () { return GD.items.length; },
    familyName: function (f) { return GD.families.get(f) || ("family " + f); },
    source: function () { return GD.source; },
    forbidden: GD.forbidden,
    encode: encode,
    decode: decode,
    tryParse: tryParse,
    patchLevel: patchLevel,
    isExactName: isExactName,
    findNamed: findNamed,
    resolve: resolve,
    parse: parseBuild,
    isSerial: isSerial,
    setManualCode: setManualCode,
    blankResolution: blankResolution,
    scanHtml: scanHtml,
    scanText: scanText,
    htmlToText: htmlToText,
    directDownloadUrl: directDownloadUrl,
    looksLikeTextSave: looksLikeTextSave,
    looksYaml: looksYaml,
    checkBody: checkBody,
    failureSummary: failureSummary,
    BrowserCheckError: BrowserCheckError,
    unzip: unzip,
    decryptSave: decryptSave,
    encryptSave: encryptSave,
    normalizeId: normalizeId,
    SaveDoc: SaveDoc,
    serializeBuild: serializeBuild,
    deserializeBuild: deserializeBuild,
    inflateRaw: inflateRaw,
    deflateRaw: deflateRaw,
    aesEcb: aesEcb
  };
});

// rpacore.js - Lõi xử lý chạy hoàn toàn trong trình duyệt (ESM, không DOM).
// Gồm: giải mã RPG Maker MV/MZ, đọc Ren'Py RPA (inflate + pickle + XOR),
//       và đóng gói ZIP (store). Dùng chung cho trang web lẫn test Node.

// ===========================================================================
// Tiện ích chung
// ===========================================================================

export const IMAGE_EXT = new Set(["png","jpg","jpeg","gif","webp","bmp","svg","ico","avif"]);
export const VIDEO_EXT = new Set(["webm","mp4","ogv","mkv","avi","mov","m4v"]);
export const AUDIO_EXT = new Set(["ogg","mp3","opus","wav","flac","m4a","aac"]);
export const TEXT_EXT  = new Set(["rpy","txt","json","py","md","xml","csv","ini",
  "yaml","yml","cfg","log","gui","sh","bat","js","css","html"]);

export function extOf(name){
  const m = /\.([^.\/\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}
export function kindOf(name){
  const e = extOf(name);
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  if (TEXT_EXT.has(e))  return "text";
  return "binary";
}
export function mimeOf(name){
  const e = extOf(name);
  const map = {
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif",
    webp:"image/webp", bmp:"image/bmp", svg:"image/svg+xml", ico:"image/x-icon",
    avif:"image/avif", webm:"video/webm", mp4:"video/mp4", ogv:"video/ogg",
    m4v:"video/mp4", mov:"video/quicktime", ogg:"audio/ogg", opus:"audio/ogg",
    mp3:"audio/mpeg", wav:"audio/wav", flac:"audio/flac", m4a:"audio/mp4",
    aac:"audio/aac", rpy:"text/plain", txt:"text/plain", json:"application/json",
  };
  return map[e] || "application/octet-stream";
}

// ===========================================================================
// RPG Maker MV/MZ
// ===========================================================================

export const RPGMV_HEADER_LEN = 16;
export const PNG_SIGNATURE = new Uint8Array([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52]);
const RPGMV_ENC = [".rpgmvp",".rpgmvo",".rpgmvm",".png_",".ogg_",".m4a_"];
const RPGMV_REAL = {
  ".rpgmvp":".png", ".png_":".png",
  ".rpgmvo":".ogg", ".ogg_":".ogg",
  ".rpgmvm":".m4a", ".m4a_":".m4a",
};

export function isEncrypted(name){
  const low = name.toLowerCase();
  return RPGMV_ENC.some(e => low.endsWith(e));
}
export function realName(name){
  const low = name.toLowerCase();
  for (const [enc, real] of Object.entries(RPGMV_REAL)){
    if (low.endsWith(enc)) return name.slice(0, name.length - enc.length) + real;
  }
  return name;
}
export function decryptBytes(data, key){
  if (data.length < RPGMV_HEADER_LEN) return data;
  const body = data.slice(RPGMV_HEADER_LEN);
  const n = Math.min(RPGMV_HEADER_LEN, body.length, key.length);
  for (let i = 0; i < n; i++) body[i] ^= key[i];
  return body;
}
export function keyFromPng(data){
  if (data.length < RPGMV_HEADER_LEN + 16) return null;
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = data[RPGMV_HEADER_LEN + i] ^ PNG_SIGNATURE[i];
  return key;
}
export function parseKeyHex(hex){
  const h = hex.trim().replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length !== 32)
    throw new Error("Key phải là 32 ký tự hex (16 byte)");
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(h.substr(i*2, 2), 16);
  return key;
}
export function keyToHex(key){
  return [...key].map(b => b.toString(16).padStart(2, "0")).join("");
}
// Tìm encryptionKey trong nội dung System.json
export function keyFromSystemJson(text){
  try {
    const obj = JSON.parse(text);
    if (obj && obj.encryptionKey) return parseKeyHex(obj.encryptionKey);
  } catch { /* bỏ qua */ }
  return null;
}

// ===========================================================================
// Ren'Py RPA — inflate (zlib) + pickle + XOR
// ===========================================================================

export async function inflateZlib(u8){
  // .rpa dùng zlib.compress => định dạng zlib => DecompressionStream('deflate')
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// Đại diện cho 1 tham chiếu global (module.name) trong pickle
class PickleGlobal { constructor(m, n){ this.module = m; this.name = n; } }

// Thực thi REDUCE: chỉ hỗ trợ cách CPython proto-2 mã hóa bytes
function applyReduce(func, args){
  if (func instanceof PickleGlobal){
    // _codecs.encode(str, 'latin1') -> bytes
    if (func.module === "_codecs" && func.name === "encode"){
      const s = args[0] || "";
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
    // bytes()/bytearray() -> b"" hoặc từ list int
    if (func.name === "bytes" || func.name === "bytearray"){
      const a = args[0];
      if (a == null) return new Uint8Array(0);
      if (Array.isArray(a)) return new Uint8Array(a);
      if (typeof a === "number") return new Uint8Array(a);
      if (a instanceof Uint8Array) return a;
      return new Uint8Array(0);
    }
  }
  throw new Error("Pickle REDUCE không hỗ trợ: " +
    (func && func.module ? func.module + "." + func.name : String(func)));
}

// --- Mini pickle reader: chỉ hỗ trợ dict/list/tuple/str/bytes/int cần cho index ---
class Pickle {
  constructor(buf){ this.b = buf; this.p = 0; this.stack = []; this.marks = []; this.memo = []; }
  u8(){ return this.b[this.p++]; }
  bytes(n){ const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  int32(){ const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getInt32(0, true); this.p += 4; return v; }
  uint(n){ let v = 0; for (let i = 0; i < n; i++) v += this.b[this.p++] * 2**(8*i); return v; }
  long(n){ // little-endian, có dấu -> Number (đủ cho offset/length thực tế)
    let v = 0n; for (let i = 0; i < n; i++) v += BigInt(this.b[this.p++]) << BigInt(8*i);
    if (n > 0 && (this.b[this.p-1] & 0x80)) v -= 1n << BigInt(8*n); // bù 2
    return Number(v);
  }
  str(n){ return new TextDecoder("utf-8").decode(this.bytes(n)); }
  line(){ let s = ""; for (;;){ const c = this.u8(); if (c === 0x0a) break; s += String.fromCharCode(c); } return s; }
  popMark(){ const i = this.marks.pop(); return this.stack.splice(i); }

  load(){
    const S = this.stack;
    for (;;){
      const op = this.u8();
      switch (op){
        case 0x80: this.p++; break;                 // PROTO
        case 0x95: this.p += 8; break;              // FRAME
        case 0x2e: return S.pop();                  // STOP '.'
        case 0x28: this.marks.push(S.length); break;// MARK '('
        case 0x7d: S.push(new Map()); break;        // EMPTY_DICT '}'
        case 0x5d: S.push([]); break;               // EMPTY_LIST ']'
        case 0x29: S.push([]); break;               // EMPTY_TUPLE ')'
        case 0x4e: S.push(null); break;             // NONE 'N'
        case 0x88: S.push(true); break;             // NEWTRUE
        case 0x89: S.push(false); break;            // NEWFALSE
        // --- số nguyên ---
        case 0x4a: S.push(this.int32()); break;                 // BININT 'J'
        case 0x4b: S.push(this.u8()); break;                    // BININT1 'K'
        case 0x4d: S.push(this.uint(2)); break;                 // BININT2 'M'
        case 0x8a: S.push(this.long(this.u8())); break;         // LONG1
        case 0x8b: S.push(this.long(this.int32()>>>0)); break;  // LONG4
        // --- chuỗi unicode ---
        case 0x58: S.push(this.str(this.uint(4))); break;       // BINUNICODE 'X'
        case 0x8c: S.push(this.str(this.u8())); break;          // SHORT_BINUNICODE
        case 0x8d: S.push(this.str(this.uint(8))); break;       // BINUNICODE8
        // --- chuỗi/bytes (py2 str) ---
        case 0x55: S.push(this.str(this.u8())); break;          // SHORT_BINSTRING 'U'
        case 0x54: S.push(this.str(this.uint(4))); break;       // BINSTRING 'T'
        case 0x43: S.push(this.bytes(this.u8()).slice()); break;// SHORT_BINBYTES 'C'
        case 0x42: S.push(this.bytes(this.uint(4)).slice()); break; // BINBYTES 'B'
        case 0x8e: S.push(this.bytes(this.uint(8)).slice()); break; // BINBYTES8
        // --- tuple ---
        case 0x85: { const a=S.pop(); S.push([a]); break; }         // TUPLE1
        case 0x86: { const b=S.pop(),a=S.pop(); S.push([a,b]); break; } // TUPLE2
        case 0x87: { const c=S.pop(),b=S.pop(),a=S.pop(); S.push([a,b,c]); break; } // TUPLE3
        case 0x74: S.push(this.popMark()); break;               // TUPLE 't'
        // --- list/dict build ---
        case 0x61: { const v=S.pop(); S[S.length-1].push(v); break; } // APPEND 'a'
        case 0x65: { const items=this.popMark(); const l=S[S.length-1]; for(const it of items) l.push(it); break; } // APPENDS 'e'
        case 0x73: { const v=S.pop(),k=S.pop(); S[S.length-1].set(k,v); break; } // SETITEM 's'
        case 0x75: { const items=this.popMark(); const d=S[S.length-1];         // SETITEMS 'u'
                     for(let i=0;i<items.length;i+=2) d.set(items[i],items[i+1]); break; }
        // --- memo ---
        case 0x94: this.memo.push(S[S.length-1]); break;        // MEMOIZE
        case 0x71: this.memo[this.u8()] = S[S.length-1]; break; // BINPUT 'q'
        case 0x72: this.memo[this.uint(4)] = S[S.length-1]; break; // LONG_BINPUT 'r'
        case 0x68: S.push(this.memo[this.u8()]); break;         // BINGET 'h'
        case 0x6a: S.push(this.memo[this.uint(4)]); break;      // LONG_BINGET 'j'
        case 0x30: S.pop(); break;                              // POP '0'
        // --- global + reduce (dùng cho bytes ở pickle proto 2) ---
        case 0x63: { const m = this.line(), n = this.line(); S.push(new PickleGlobal(m, n)); break; } // GLOBAL 'c'
        case 0x93: { const n = S.pop(), m = S.pop(); S.push(new PickleGlobal(m, n)); break; }         // STACK_GLOBAL
        case 0x52: { const args = S.pop(), func = S.pop(); S.push(applyReduce(func, args)); break; }  // REDUCE 'R'
        default:
          throw new Error("Pickle: opcode chưa hỗ trợ 0x" + op.toString(16) +
            " tại vị trí " + (this.p-1));
      }
    }
  }
}

function parseHeader(headBytes){
  const line = new TextDecoder("latin1").decode(headBytes);
  const nl = line.indexOf("\n");
  if (nl < 0) throw new Error("Header RPA không hợp lệ");
  const parts = line.slice(0, nl).trim().split(/\s+/);
  const magic = parts[0];
  if (magic === "RPA-3.0" || magic === "RPA-3.2" || magic === "ZiX-12A" || magic === "ZiX-12B"){
    const offset = BigInt("0x" + parts[1]);
    let key = 0n;
    for (let i = 2; i < parts.length; i++){
      if (/^[0-9a-fA-F]{8}$/.test(parts[i])) key ^= BigInt("0x" + parts[i]);
    }
    if (key === 0n && parts.length >= 3) key = BigInt("0x" + parts[parts.length-1]);
    return { version: magic, offset, key };
  }
  if (magic === "RPA-2.0") return { version: "RPA-2.0", offset: BigInt("0x"+parts[1]), key: 0n };
  if (magic === "RPA-1.0") return { version: "RPA-1.0", offset: BigInt("0x"+parts[1]), key: 0n };
  throw new Error("Không nhận dạng được header: " + parts[0]);
}

// Đọc index của RPA. `slice(start,end)->Promise<Uint8Array>` để đọc lười.
// Trả về { version, keyLabel, entries: [{name,offset,length,prefix}] }
export async function readRpaIndex(fileSize, sliceFn){
  const head = await sliceFn(0, Math.min(fileSize, 128));
  const { version, offset, key } = parseHeader(head);
  const raw = await sliceFn(Number(offset), fileSize);
  const idxBytes = await inflateZlib(raw);
  const index = new Pickle(idxBytes).load();
  if (!(index instanceof Map)) throw new Error("Index RPA không phải dictionary");

  const entries = [];
  for (const [name, values] of index){
    for (const item of values){
      let off = item[0], length = item[1];
      let prefix = item.length >= 3 && item[2] instanceof Uint8Array ? item[2] : new Uint8Array(0);
      if (key !== 0n){
        off = Number(BigInt(off) ^ key);
        length = Number(BigInt(length) ^ key);
      }
      entries.push({ name: String(name), offset: off, length, prefix });
    }
  }
  entries.sort((a,b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
  const keyLabel = "0x" + (key & 0xffffffffn).toString(16).padStart(8,"0");
  return { version, keyLabel, entries };
}

export async function readRpaEntry(entry, sliceFn){
  const dataLen = Math.max(entry.length - entry.prefix.length, 0);
  const data = await sliceFn(entry.offset, entry.offset + dataLen);
  if (entry.prefix.length === 0) return data;
  const out = new Uint8Array(entry.prefix.length + data.length);
  out.set(entry.prefix, 0); out.set(data, entry.prefix.length);
  return out;
}

// ===========================================================================
// ZIP (phương thức store, không nén) — gói nhiều file thành 1 Blob
// ===========================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(u8, crc = 0){
  crc = crc ^ 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// files: [{name, data:Uint8Array}] -> Blob (.zip)
export function makeZip(files){
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const LIMIT = 0xFFFFFFFF;

  const u16 = v => new Uint8Array([v & 255, (v>>>8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v>>>8)&255, (v>>>16)&255, (v>>>24)&255]);
  const push = arr => { chunks.push(arr); offset += arr.length; };

  for (const f of files){
    const nameBytes = enc.encode(f.name.replace(/\\/g, "/"));
    const data = f.data;
    if (data.length > LIMIT) throw new Error("File quá lớn cho ZIP tiêu chuẩn (>4GB): " + f.name);
    const crc = crc32(data);
    const localOffset = offset;

    // local file header
    push(u32(0x04034b50)); push(u16(20)); push(u16(0x0800)); // ver, flag(UTF-8)
    push(u16(0)); push(u16(0)); push(u16(0));                // method=store, time, date
    push(u32(crc)); push(u32(data.length)); push(u32(data.length));
    push(u16(nameBytes.length)); push(u16(0));
    push(nameBytes);
    push(data);

    // central directory record (lưu lại, ghi sau)
    const c = [];
    const cp = a => c.push(a);
    cp(u32(0x02014b50)); cp(u16(20)); cp(u16(20)); cp(u16(0x0800));
    cp(u16(0)); cp(u16(0)); cp(u16(0));
    cp(u32(crc)); cp(u32(data.length)); cp(u32(data.length));
    cp(u16(nameBytes.length)); cp(u16(0)); cp(u16(0));
    cp(u16(0)); cp(u16(0)); cp(u32(0)); cp(u32(localOffset));
    cp(nameBytes);
    central.push({ parts: c });
  }

  const cdStart = offset;
  for (const rec of central) for (const part of rec.parts) push(part);
  const cdSize = offset - cdStart;

  // End of central directory
  push(u32(0x06054b50)); push(u16(0)); push(u16(0));
  push(u16(files.length)); push(u16(files.length));
  push(u32(cdSize)); push(u32(cdStart)); push(u16(0));

  return new Blob(chunks, { type: "application/zip" });
}

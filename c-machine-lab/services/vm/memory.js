export class TeachingMemory {
  constructor(config) {
    this.config = config;
    this.bytes = new Uint8Array(config.memorySize);
  }

  cloneBytes() {
    return new Uint8Array(this.bytes);
  }

  inBounds(address, size = 1) {
    return Number.isInteger(address) && address >= 0 && address + size <= this.bytes.length;
  }

  readByte(address) {
    this.assertBounds(address, 1);
    return this.bytes[address];
  }

  writeByte(address, value) {
    this.assertBounds(address, 1);
    this.bytes[address] = value & 0xff;
  }

  readInt(address) {
    this.assertBounds(address, 4);
    return (
      this.bytes[address] |
      (this.bytes[address + 1] << 8) |
      (this.bytes[address + 2] << 16) |
      (this.bytes[address + 3] << 24)
    ) | 0;
  }

  writeInt(address, value) {
    this.assertBounds(address, 4);
    const v = value | 0;
    this.bytes[address] = v & 0xff;
    this.bytes[address + 1] = (v >>> 8) & 0xff;
    this.bytes[address + 2] = (v >>> 16) & 0xff;
    this.bytes[address + 3] = (v >>> 24) & 0xff;
  }

  readValue(address, size = 4) {
    if (size === 1) return this.readByte(address);
    return this.readInt(address);
  }

  writeValue(address, value, size = 4) {
    if (size === 1) this.writeByte(address, value);
    else this.writeInt(address, value);
  }

  writeBytes(address, bytes) {
    this.assertBounds(address, bytes.length);
    this.bytes.set(bytes.map(v => v & 0xff), address);
  }

  readBytes(address, length) {
    this.assertBounds(address, length);
    return Array.from(this.bytes.slice(address, address + length));
  }

  writeCString(address, value, maxBytes = Infinity) {
    const bytes = [...String(value)].map(ch => ch.charCodeAt(0) & 0xff).concat(0);
    const clipped = bytes.slice(0, Math.max(0, maxBytes));
    if (clipped.length && clipped[clipped.length - 1] !== 0 && clipped.length === maxBytes) {
      clipped[clipped.length - 1] = 0;
    }
    this.writeBytes(address, clipped);
    return clipped.length;
  }

  readCString(address, maxBytes = 4096) {
    if (!this.inBounds(address, 1)) return '';
    const chars = [];
    for (let i = 0; i < maxBytes && this.inBounds(address + i, 1); i += 1) {
      const byte = this.bytes[address + i];
      if (byte === 0) break;
      chars.push(String.fromCharCode(byte));
    }
    return chars.join('');
  }

  segmentOf(address) {
    for (const [name, segment] of Object.entries(this.config.segments)) {
      if (address >= segment.start && address <= segment.end) return name;
    }
    return 'invalid';
  }

  dump(address, length = 64) {
    const start = Math.max(0, Math.min(address, this.bytes.length - 1));
    const end = Math.min(this.bytes.length, start + length);
    return Array.from(this.bytes.slice(start, end)).map((value, offset) => ({
      address: start + offset,
      value,
      segment: this.segmentOf(start + offset),
      char: value >= 32 && value <= 126 ? String.fromCharCode(value) : '.',
    }));
  }

  assertBounds(address, size) {
    if (!this.inBounds(address, size)) {
      throw new Error(`memory access out of bounds at 0x${(address >>> 0).toString(16)}`);
    }
  }
}

export function hex(value, width = 4) {
  return `0x${((value || 0) >>> 0).toString(16).padStart(width, '0')}`;
}

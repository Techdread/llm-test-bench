export class TeachingHeap {
  constructor(config) {
    this.config = config;
    this.start = config.segments.heap.start;
    this.end = config.segments.heap.end + 1;
    this.headerSize = config.enableBlockHeaders ? 8 : 0;
    this.blocks = [];
    this.nextId = 1;
  }

  allocate(size) {
    const requestedSize = Math.max(1, size | 0);
    const totalSize = requestedSize + this.headerSize;
    let cursor = this.start;
    const sorted = [...this.blocks].sort((a, b) => a.start - b.start);
    for (const block of sorted) {
      if (block.free) continue;
      if (cursor + totalSize <= block.start) break;
      cursor = Math.max(cursor, block.start + block.totalSize);
    }
    if (cursor + totalSize > this.end) {
      return { ok: false, error: `malloc(${requestedSize}) cannot fit in the heap segment` };
    }
    const block = {
      id: this.nextId++,
      start: cursor,
      payload: cursor + this.headerSize,
      requestedSize,
      totalSize,
      free: false,
      freedAtStep: null,
    };
    this.blocks.push(block);
    return { ok: true, address: block.payload, block };
  }

  free(address, step) {
    const block = this.blocks.find(item => item.payload === address);
    if (!block) return { ok: false, error: `free(${hex(address)}) does not point to a heap allocation` };
    if (block.free) return { ok: false, error: `double free of heap block #${block.id}` };
    block.free = true;
    block.freedAtStep = step;
    return { ok: true, block };
  }

  blockFor(address) {
    return this.blocks.find(block => address >= block.payload && address < block.payload + block.requestedSize) || null;
  }

  validateAccess(address, size, mode) {
    if (address === 0) return { ok: false, error: `${mode} through a null pointer` };
    const segment = segmentOf(this.config, address);
    if (segment !== 'heap') return { ok: true };
    const block = this.blockFor(address);
    if (!block) return { ok: false, error: `${mode} outside a heap allocation at ${hex(address)}` };
    if (block.free) return { ok: false, error: `${mode} after free of heap block #${block.id}` };
    if (address + size > block.payload + block.requestedSize) {
      return { ok: false, error: `${mode} overruns heap block #${block.id}` };
    }
    return { ok: true, block };
  }

  describePointer(address) {
    if (address === 0) return { status: 'null pointer', segment: 'invalid', valid: false };
    const segment = segmentOf(this.config, address);
    if (segment === 'heap') {
      const block = this.blockFor(address) || this.blocks.find(item => item.payload === address);
      if (!block) return { status: 'not inside a heap block', segment, valid: false };
      if (block.free) return { status: `freed heap block #${block.id}`, segment, valid: false, block };
      return { status: `heap block #${block.id}`, segment, valid: true, block };
    }
    if (segment === 'stack' || segment === 'data' || segment === 'io' || segment === 'text') {
      return { status: `${segment} segment`, segment, valid: true };
    }
    return { status: 'out-of-bounds pointer', segment, valid: false };
  }
}

function segmentOf(config, address) {
  for (const [name, segment] of Object.entries(config.segments)) {
    if (address >= segment.start && address <= segment.end) return name;
  }
  return 'invalid';
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(4, '0')}`;
}

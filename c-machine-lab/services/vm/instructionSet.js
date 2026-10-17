export const INTERRUPT_VECTORS = [
  { vector: 0x10, name: 'stdout write', description: 'printf, puts, and putchar write visible output' },
  { vector: 0x11, name: 'stdin read', description: 'reserved for virtual input buffers' },
  { vector: 0x20, name: 'malloc', description: 'allocate a heap block' },
  { vector: 0x21, name: 'free', description: 'release a heap block' },
  { vector: 0x30, name: 'fopen', description: 'open a virtual file' },
  { vector: 0x31, name: 'fclose', description: 'close a virtual file handle' },
  { vector: 0x32, name: 'fread', description: 'read bytes from a virtual file' },
  { vector: 0x33, name: 'fwrite/fprintf', description: 'write bytes or formatted text to a virtual file' },
  { vector: 0x34, name: 'fgetc', description: 'read one byte and advance file offset' },
  { vector: 0x35, name: 'fputc', description: 'write one byte and advance file offset' },
  { vector: 0x36, name: 'rewind', description: 'reset a virtual file handle offset' },
  { vector: 0x40, name: 'timer interrupt', description: 'optional teaching timer' },
  { vector: 0x41, name: 'keyboard/input interrupt', description: 'optional virtual input event' },
  { vector: 0x50, name: 'strlen', description: 'count bytes until null terminator' },
  { vector: 0x51, name: 'strcpy', description: 'copy null-terminated bytes' },
  { vector: 0x52, name: 'strcmp', description: 'compare strings byte by byte' },
  { vector: 0x53, name: 'memcpy', description: 'copy raw bytes' },
  { vector: 0xff, name: 'runtime error', description: 'trap for invalid memory, heap, or file operations' },
];

export function vectorInfo(vector) {
  return INTERRUPT_VECTORS.find(item => item.vector === vector) || {
    vector,
    name: `INT 0x${vector.toString(16)}`,
    description: 'custom teaching interrupt',
  };
}

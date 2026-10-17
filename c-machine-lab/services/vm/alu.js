export function runAlu(op, a, b = 0) {
  const left = a | 0;
  const right = b | 0;
  let result = 0;
  let carry = false;
  let overflow = false;

  if (op === 'ADD') {
    const unsigned = (left >>> 0) + (right >>> 0);
    result = unsigned | 0;
    carry = unsigned > 0xffffffff;
    overflow = ((left ^ result) & (right ^ result) & 0x80000000) !== 0;
  } else if (op === 'SUB' || op === 'CMP') {
    result = (left - right) | 0;
    carry = (left >>> 0) < (right >>> 0);
    overflow = ((left ^ right) & (left ^ result) & 0x80000000) !== 0;
  } else if (op === 'MUL') {
    result = Math.imul(left, right) | 0;
    overflow = Math.trunc(left * right) !== result;
  } else if (op === 'DIV') {
    result = right === 0 ? 0 : (left / right) | 0;
  } else if (op === 'MOD') {
    result = right === 0 ? 0 : (left % right) | 0;
  } else {
    result = left | 0;
  }

  return {
    op,
    a: left,
    b: right,
    result: result | 0,
    flags: {
      Z: (result | 0) === 0,
      N: (result | 0) < 0,
      C: carry,
      V: overflow,
    },
  };
}

export function comparisonFromFlags(flags, operator) {
  if (operator === '==') return flags.Z;
  if (operator === '!=') return !flags.Z;
  if (operator === '<') return flags.N !== flags.V;
  if (operator === '<=') return flags.Z || flags.N !== flags.V;
  if (operator === '>') return !flags.Z && flags.N === flags.V;
  if (operator === '>=') return flags.N === flags.V;
  return false;
}

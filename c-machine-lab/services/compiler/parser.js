import { node, cloneType, typeDisplay } from './ast.js';
import { diagnostic, unsupported } from './diagnostics.js';

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parse(tokens) {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.diagnostics = [];
  }

  parseProgram() {
    const declarations = [];
    while (!this.is('eof')) {
      if (this.peek().value === 'struct') {
        this.diagnostics.push(unsupported('structs are available in Phase 2 examples', this.peek()));
        this.recoverTo(';', '}');
        this.match(';');
        continue;
      }
      const type = this.parseType();
      if (!type) {
        this.diagnostics.push(diagnostic(`expected a declaration, found "${this.peek().value}"`, this.peek()));
        this.advance();
        continue;
      }
      const name = this.expectIdentifier('expected a name after type');
      if (!name) {
        this.recoverTo(';', '}');
        this.match(';');
        continue;
      }
      if (this.match('(')) {
        declarations.push(this.parseFunction(type, name));
      } else {
        declarations.push(this.parseVariableDeclaration(type, name, true));
      }
    }
    return { ast: node('Program', { declarations }), diagnostics: this.diagnostics };
  }

  parseFunction(returnType, nameToken) {
    const params = [];
    if (!this.match(')')) {
      do {
        if (this.peek().value === 'void' && this.peek(1).value === ')') {
          this.advance();
          break;
        }
        const type = this.parseType();
        if (!type) {
          this.diagnostics.push(diagnostic('expected parameter type', this.peek()));
          this.recoverTo(',', ')');
          continue;
        }
        const name = this.expectIdentifier('expected parameter name');
        if (name) params.push(node('Param', { name: name.value, type: cloneType(type) }, name));
      } while (this.match(','));
      this.expect(')', 'expected ) after parameters');
    }
    const body = this.parseBlock();
    return node('FunctionDeclaration', {
      name: nameToken.value,
      returnType: cloneType(returnType),
      params,
      body,
    }, nameToken);
  }

  parseVariableDeclaration(type, nameToken, global = false) {
    const declarations = [];
    let currentType = cloneType(type);
    let currentName = nameToken;
    while (currentName) {
      const declaredType = cloneType(currentType);
      if (this.match('[')) {
        const sizeToken = this.expect('number', 'array length must be a number');
        declaredType.arrayLength = sizeToken ? sizeToken.numberValue : 1;
        declaredType.display = typeDisplay(declaredType);
        this.expect(']', 'expected ] after array length');
      }
      let init = null;
      if (this.match('=')) init = this.parseExpression();
      declarations.push(node('VariableDeclarator', {
        name: currentName.value,
        type: declaredType,
        init,
        global,
      }, currentName));
      if (!this.match(',')) break;
      const nextType = cloneType(type);
      while (this.match('*')) nextType.pointerDepth += 1;
      nextType.display = typeDisplay(nextType);
      currentType = nextType;
      currentName = this.expectIdentifier('expected name after comma in declaration');
    }
    this.expect(';', 'expected ; after declaration');
    return node(global ? 'GlobalDeclaration' : 'VariableDeclaration', { declarations }, nameToken);
  }

  parseBlock() {
    const start = this.expect('{', 'expected { to start function or block');
    const statements = [];
    while (!this.is('eof') && !this.match('}')) {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }
    return node('BlockStatement', { statements }, start);
  }

  parseStatement() {
    if (this.peek().value === '{') return this.parseBlock();
    if (this.matchKeyword('if')) return this.parseIf(this.previous());
    if (this.matchKeyword('while')) return this.parseWhile(this.previous());
    if (this.matchKeyword('for')) return this.parseFor(this.previous());
    if (this.matchKeyword('return')) return this.parseReturn(this.previous());
    if (this.matchKeyword('break')) {
      const token = this.previous();
      this.expect(';', 'expected ; after break');
      return node('BreakStatement', {}, token);
    }
    if (this.matchKeyword('continue')) {
      const token = this.previous();
      this.expect(';', 'expected ; after continue');
      return node('ContinueStatement', {}, token);
    }
    const type = this.tryParseType();
    if (type) {
      const name = this.expectIdentifier('expected name in declaration');
      if (!name) {
        this.recoverTo(';', '}');
        this.match(';');
        return null;
      }
      return this.parseVariableDeclaration(type, name, false);
    }
    const expr = this.parseExpression();
    this.expect(';', 'expected ; after expression');
    return node('ExpressionStatement', { expression: expr }, expr?.loc || this.previous());
  }

  parseIf(token) {
    this.expect('(', 'expected ( after if');
    const test = this.parseExpression();
    this.expect(')', 'expected ) after if condition');
    const consequent = this.parseStatement();
    const alternate = this.matchKeyword('else') ? this.parseStatement() : null;
    return node('IfStatement', { test, consequent, alternate }, token);
  }

  parseWhile(token) {
    this.expect('(', 'expected ( after while');
    const test = this.parseExpression();
    this.expect(')', 'expected ) after while condition');
    const body = this.parseStatement();
    return node('WhileStatement', { test, body }, token);
  }

  parseFor(token) {
    this.expect('(', 'expected ( after for');
    let init = null;
    const type = this.tryParseType();
    if (type) {
      const name = this.expectIdentifier('expected name in for initializer');
      init = name ? this.parseVariableDeclaration(type, name, false) : null;
    } else if (!this.match(';')) {
      const expr = this.parseExpression();
      this.expect(';', 'expected ; after for initializer');
      init = node('ExpressionStatement', { expression: expr }, expr);
    }
    let test = null;
    if (!this.match(';')) {
      test = this.parseExpression();
      this.expect(';', 'expected ; after for condition');
    }
    let update = null;
    if (!this.match(')')) {
      update = this.parseExpression();
      this.expect(')', 'expected ) after for update');
    }
    const body = this.parseStatement();
    return node('ForStatement', { init, test, update, body }, token);
  }

  parseReturn(token) {
    const argument = this.peek().value === ';' ? null : this.parseExpression();
    this.expect(';', 'expected ; after return');
    return node('ReturnStatement', { argument }, token);
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseBinary(1);
    if (this.match('=')) {
      const op = this.previous();
      const right = this.parseAssignment();
      return node('AssignmentExpression', { left, right, operator: '=' }, op);
    }
    return left;
  }

  parseBinary(minPrecedence) {
    let left = this.parseUnary();
    while (true) {
      const op = this.peek().value;
      const precedence = BINARY_PRECEDENCE[op] || 0;
      if (precedence < minPrecedence) break;
      const token = this.advance();
      const right = this.parseBinary(precedence + 1);
      left = node('BinaryExpression', { left, operator: op, right }, token);
    }
    return left;
  }

  parseUnary() {
    if (['!', '-', '+', '&', '*'].includes(this.peek().value)) {
      const token = this.advance();
      const argument = this.parseUnary();
      return node('UnaryExpression', { operator: token.value, argument }, token);
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.match('(')) {
        const args = [];
        if (!this.match(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.match(','));
          this.expect(')', 'expected ) after arguments');
        }
        expr = node('CallExpression', { callee: expr, arguments: args }, expr);
      } else if (this.match('[')) {
        const index = this.parseExpression();
        this.expect(']', 'expected ] after array index');
        expr = node('SubscriptExpression', { object: expr, index }, expr);
      } else {
        break;
      }
    }
    return expr;
  }

  parsePrimary() {
    if (this.match('number')) {
      const token = this.previous();
      return node('Literal', { value: token.numberValue, raw: token.value, valueType: 'int' }, token);
    }
    if (this.match('string')) {
      const token = this.previous();
      return node('Literal', { value: token.value, raw: `"${token.value}"`, valueType: 'string' }, token);
    }
    if (this.match('identifier') || this.peek().value === 'EOF' || this.peek().value === 'NULL') {
      const token = this.previous().type === 'identifier' ? this.previous() : this.advance();
      return node('Identifier', { name: token.value }, token);
    }
    if (this.match('(')) {
      const expr = this.parseExpression();
      this.expect(')', 'expected ) after expression');
      return expr;
    }
    const token = this.peek();
    this.diagnostics.push(diagnostic(`expected expression, found "${token.value}"`, token));
    this.advance();
    return node('Literal', { value: 0, raw: '0', valueType: 'int' }, token);
  }

  parseType() {
    const type = this.tryParseType();
    if (!type) return null;
    return type;
  }

  tryParseType() {
    const token = this.peek();
    if (!this.isTypeStart(token)) return null;
    this.advance();
    const type = { base: token.value, pointerDepth: 0, arrayLength: null };
    while (this.match('*')) type.pointerDepth += 1;
    type.display = typeDisplay(type);
    return type;
  }

  isTypeStart(token) {
    return token && (
      (token.type === 'keyword' && ['int', 'char', 'void'].includes(token.value)) ||
      (token.type === 'identifier' && token.value === 'FILE')
    );
  }

  expectIdentifier(message) {
    if (this.match('identifier')) return this.previous();
    this.diagnostics.push(diagnostic(message, this.peek()));
    return null;
  }

  expect(valueOrType, message) {
    if (this.match(valueOrType)) return this.previous();
    this.diagnostics.push(diagnostic(message, this.peek()));
    return null;
  }

  matchKeyword(value) {
    if (this.peek().type === 'keyword' && this.peek().value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  match(valueOrType) {
    if (this.is(valueOrType)) {
      this.advance();
      return true;
    }
    return false;
  }

  is(valueOrType) {
    const token = this.peek();
    return token.type === valueOrType || token.value === valueOrType;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  previous() {
    return this.tokens[this.pos - 1] || this.tokens[0];
  }

  advance() {
    if (!this.is('eof')) this.pos += 1;
    return this.previous();
  }

  recoverTo(...values) {
    while (!this.is('eof') && !values.includes(this.peek().value)) this.advance();
  }
}

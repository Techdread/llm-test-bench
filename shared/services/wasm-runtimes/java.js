// Shared Java runner — compiles + runs with the real OpenJDK (javac/java) in the
// Debian guest (spec 278), the same backend the Polyglot Forge `java` module uses.
// Returns the runtimeManager RunResult shape so Notebook Lab can run `java` cells.

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

export async function runJava(code, options = {}) {
  const stdin = options.stdin || '';
  // javac wants the file named after the public type; `java` runs the class with
  // main. Prefer the public type (the single-file convention); fall back to the
  // class that declares main, then a default.
  const publicType = matchPublicType(code);
  const mainClass = publicType || findMainClass(code) || 'Main';
  const fileBase = publicType || mainClass;
  const r = await compileAndRun({
    source: code, stdin, srcName: `${fileBase}.java`,
    compileCmd: `rm -f *.class; javac -J-Xmx256m -encoding UTF-8 ${fileBase}.java`,
    runCmd: `java -Xmx256m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UsePerfData ${mainClass}`,
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  return toRunResult(r, 'native (OpenJDK, Debian/v86)', stdin);
}

const TYPE = '(?:class|interface|enum|record)';
function matchPublicType(src) {
  const m = src.match(new RegExp(`\\bpublic\\s+(?:final\\s+|abstract\\s+|sealed\\s+|non-sealed\\s+|strictfp\\s+)*${TYPE}\\s+(\\w+)`));
  return m ? m[1] : undefined;
}
function findMainClass(src) {
  const i = src.search(/\bstatic\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String\b/);
  if (i === -1) return undefined;
  const re = new RegExp(`\\b${TYPE}\\s+(\\w+)`, 'g');
  let last, m;
  while ((m = re.exec(src.slice(0, i))) !== null) last = m[1];
  return last;
}

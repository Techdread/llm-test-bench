const vf = (name, content) => ({ id: name, name, content, readonly: false, createdByLesson: true });

export const LESSONS = [
  {
    id: 'hello-machine',
    title: 'Hello machine',
    topic: 'Basics',
    difficulty: 'Starter',
    lessonGoals: ['See printf become an INT 0x10 stdout trap', 'Find source, assembly, registers, and output changing together'],
    code: `#include <stdio.h>

int main() {
  printf("hello, machine\\n");
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [4],
    walkthrough: ['Compile the program.', 'Step until INT 0x10.', 'Watch stdout update.'],
    challenge: 'Change the message and confirm only the string data changes.',
    expectedStdout: 'hello, machine\n',
    expectedWarnings: [],
  },
  {
    id: 'integer-variables',
    title: 'Integer variables',
    topic: 'Basics',
    difficulty: 'Starter',
    lessonGoals: ['Compare immediate values with stack slots', 'Watch STORE write local variables'],
    code: `#include <stdio.h>

int main() {
  int a = 7;
  int b = 5;
  int total = a + b;
  printf("total=%d\\n", total);
  return total;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Step over the declarations.', 'Open the stack panel and inspect a, b, and total.'],
    challenge: 'Change one literal and predict the ALU result before stepping.',
    expectedStdout: 'total=12\n',
    expectedWarnings: [],
  },
  {
    id: 'alu-arithmetic',
    title: 'Arithmetic through the ALU',
    topic: 'ALU',
    difficulty: 'Starter',
    lessonGoals: ['See ADD, MUL, SUB, DIV, and MOD update the ALU panel', 'Read Z/N/C/V flags after operations'],
    code: `#include <stdio.h>

int main() {
  int x = 6;
  int y = 4;
  int value = (x * y) - (x / 2) + (y % 3);
  printf("value=%d\\n", value);
  return value;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Step through each arithmetic instruction.', 'Switch the ALU view between decimal and binary.'],
    challenge: 'Make the result zero and watch the Z flag turn on.',
    expectedStdout: 'value=22\n',
    expectedWarnings: [],
  },
  {
    id: 'comparisons-flags',
    title: 'Comparisons and flags',
    topic: 'Control flow',
    difficulty: 'Starter',
    lessonGoals: ['Watch CMP set Z/N/V flags', 'See JG choose the if branch'],
    code: `#include <stdio.h>

int main() {
  int temperature = 31;
  if (temperature > 30) {
    printf("hot\\n");
  } else {
    printf("mild\\n");
  }
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [5],
    walkthrough: ['Step onto CMP.', 'Compare PC movement for JG when the condition is true.'],
    challenge: 'Change temperature to 24 and watch the branch switch.',
    expectedStdout: 'hot\n',
    expectedWarnings: [],
  },
  {
    id: 'while-loop',
    title: 'While loop counter',
    topic: 'Control flow',
    difficulty: 'Starter',
    lessonGoals: ['Follow JMP back to a loop label', 'Watch a stack variable change every iteration'],
    code: `#include <stdio.h>

int main() {
  int i = 0;
  int sum = 0;
  while (i < 4) {
    sum = sum + i;
    i = i + 1;
  }
  printf("sum=%d\\n", sum);
  return sum;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6, 10],
    walkthrough: ['Run until the loop.', 'Step through one full iteration and inspect i and sum.'],
    challenge: 'Change the loop bound to 6 and predict the output.',
    expectedStdout: 'sum=6\n',
    expectedWarnings: [],
  },
  {
    id: 'for-loop',
    title: 'For loop lowering',
    topic: 'Control flow',
    difficulty: 'Starter',
    lessonGoals: ['See for(init; condition; update) lower to labels and jumps', 'Track one induction variable'],
    code: `#include <stdio.h>

int main() {
  int sum = 0;
  int i;
  for (i = 1; i <= 4; i = i + 1) {
    sum = sum + i;
  }
  printf("sum=%d\\n", sum);
  return sum;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Compare the source for-loop with the assembly labels.', 'Step over the update expression.'],
    challenge: 'Start at 0 and explain why the answer changes.',
    expectedStdout: 'sum=10\n',
    expectedWarnings: [],
  },
  {
    id: 'address-of-local',
    title: 'Address of a local',
    topic: 'Pointers',
    difficulty: 'Intro',
    lessonGoals: ['See &value become LEA', 'Inspect a pointer that targets the stack segment'],
    code: `#include <stdio.h>

int main() {
  int value = 42;
  int *p = &value;
  printf("value=%d\\n", *p);
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [5],
    walkthrough: ['Step onto LEA.', 'Select p in the pointer inspector.'],
    challenge: 'Assign through *p and observe value change.',
    expectedStdout: 'value=42\n',
    expectedWarnings: [],
  },
  {
    id: 'dereference-write',
    title: 'Write through a pointer',
    topic: 'Pointers',
    difficulty: 'Intro',
    lessonGoals: ['Store through an address held in a register', 'Watch memory writes target another variable'],
    code: `#include <stdio.h>

int main() {
  int x = 10;
  int *p = &x;
  *p = 99;
  printf("x=%d\\n", x);
  return x;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Step over *p = 99.', 'Check x in the stack panel.'],
    challenge: 'Make p point to a different local and repeat.',
    expectedStdout: 'x=99\n',
    expectedWarnings: [],
  },
  {
    id: 'array-pointer-arithmetic',
    title: 'Array indexing as pointer arithmetic',
    topic: 'Pointers',
    difficulty: 'Intro',
    lessonGoals: ['See arr[i] compute base + i * sizeof(int)', 'Inspect contiguous stack memory'],
    code: `#include <stdio.h>

int main() {
  int values[4];
  values[0] = 3;
  values[1] = 5;
  values[2] = values[0] + values[1];
  printf("v2=%d\\n", values[2]);
  return values[2];
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Step through values[2].', 'Inspect the stack byte grid near values.'],
    challenge: 'Add values[3] and point the inspector at it.',
    expectedStdout: 'v2=8\n',
    expectedWarnings: [],
  },
  {
    id: 'function-call',
    title: 'Function call and return',
    topic: 'Stack',
    difficulty: 'Intro',
    lessonGoals: ['Watch CALL push a new frame', 'See RET restore control flow'],
    code: `#include <stdio.h>

int add(int a, int b) {
  int total = a + b;
  return total;
}

int main() {
  int result = add(11, 31);
  printf("result=%d\\n", result);
  return result;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [9],
    walkthrough: ['Step into add.', 'Compare the add frame with the main frame.'],
    challenge: 'Add a third parameter and track where it lands.',
    expectedStdout: 'result=42\n',
    expectedWarnings: [],
  },
  {
    id: 'recursive-factorial',
    title: 'Recursive factorial',
    topic: 'Stack',
    difficulty: 'Intermediate',
    lessonGoals: ['Watch repeated CALL instructions grow the stack', 'See return values flow through R0'],
    code: `#include <stdio.h>

int fact(int n) {
  if (n <= 1) {
    return 1;
  }
  return n * fact(n - 1);
}

int main() {
  int result = fact(4);
  printf("fact=%d\\n", result);
  return result;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [4, 11],
    walkthrough: ['Step into fact until three frames are visible.', 'Run until the first RET.'],
    challenge: 'Try fact(5) and inspect stack growth.',
    expectedStdout: 'fact=24\n',
    expectedWarnings: [],
  },
  {
    id: 'first-malloc',
    title: 'First malloc',
    topic: 'Heap',
    difficulty: 'Intro',
    lessonGoals: ['See malloc become INT 0x20', 'Track a heap block from allocation to free'],
    code: `#include <stdio.h>
#include <stdlib.h>

int main() {
  int *p = malloc(4);
  *p = 123;
  printf("heap=%d\\n", *p);
  free(p);
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [5, 8],
    walkthrough: ['Step onto INT 0x20.', 'Open the heap panel and then free the block.'],
    challenge: 'Remove free(p) and run to HALT to see the leak warning.',
    expectedStdout: 'heap=123\n',
    expectedWarnings: [],
  },
  {
    id: 'double-free-bug',
    title: 'Double free trap',
    topic: 'Bug labs',
    difficulty: 'Intermediate',
    lessonGoals: ['Trigger a runtime error trap', 'Understand heap block state after free'],
    code: `#include <stdio.h>
#include <stdlib.h>

int main() {
  int *p = malloc(4);
  free(p);
  free(p);
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [7],
    walkthrough: ['Run to the second free.', 'Read the interrupt/runtime error panel.'],
    challenge: 'Set p to 0 after free and explain how the error changes.',
    expectedStdout: '',
    expectedWarnings: ['double free'],
  },
  {
    id: 'use-after-free-bug',
    title: 'Use-after-free trap',
    topic: 'Bug labs',
    difficulty: 'Intermediate',
    lessonGoals: ['See a freed heap pointer flagged by the pointer inspector', 'Connect a STORE to a runtime trap'],
    code: `#include <stdio.h>
#include <stdlib.h>

int main() {
  int *p = malloc(4);
  free(p);
  *p = 7;
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [7],
    walkthrough: ['Step after free.', 'Inspect p before the STORE runs.'],
    challenge: 'Move the write before free and compare the trace.',
    expectedStdout: '',
    expectedWarnings: ['use after free'],
  },
  {
    id: 'strlen-string',
    title: 'String length',
    topic: 'Strings and memory',
    difficulty: 'Intro',
    lessonGoals: ['See string literals stored as null-terminated bytes', 'Run strlen through a visible runtime helper'],
    code: `#include <stdio.h>
#include <string.h>

int main() {
  char *name = "Ada";
  int n = strlen(name);
  printf("len=%d\\n", n);
  return n;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Inspect the data segment at the string address.', 'Step over strlen.'],
    challenge: 'Change the string and verify the null terminator.',
    expectedStdout: 'len=3\n',
    expectedWarnings: [],
  },
  {
    id: 'strcpy-buffer',
    title: 'Copy a string into a buffer',
    topic: 'Strings and memory',
    difficulty: 'Intermediate',
    lessonGoals: ['Watch strcpy write several bytes', 'Inspect char array storage on the stack'],
    code: `#include <stdio.h>
#include <string.h>

int main() {
  char name[8];
  strcpy(name, "Linus");
  printf("%s\\n", name);
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [6],
    walkthrough: ['Step through the strcpy interrupt.', 'Decode name as chars in memory view.'],
    challenge: 'Shrink the buffer and observe the bounds warning.',
    expectedStdout: 'Linus\n',
    expectedWarnings: [],
  },
  {
    id: 'file-read-count',
    title: 'Read a virtual file',
    topic: 'File I/O',
    difficulty: 'Intermediate',
    lessonGoals: ['Open a virtual file with INT 0x30', 'See fgetc advance the handle offset'],
    code: `#include <stdio.h>

int main() {
  FILE *fp = fopen("notes.txt", "r");
  int count = 0;
  int ch = fgetc(fp);
  while (ch != -1) {
    count = count + 1;
    ch = fgetc(fp);
  }
  fclose(fp);
  printf("chars=%d\\n", count);
  return count;
}
`,
    virtualFiles: [vf('notes.txt', 'abcde')],
    suggestedBreakpoints: [4, 7],
    walkthrough: ['Step over fopen.', 'Watch fgetc return each byte and update offset.'],
    challenge: 'Edit notes.txt in the file drawer and rerun.',
    expectedStdout: 'chars=5\n',
    expectedWarnings: [],
  },
  {
    id: 'file-write-report',
    title: 'Write a virtual report',
    topic: 'File I/O',
    difficulty: 'Intermediate',
    lessonGoals: ['Open a writable virtual file', 'See fputc and fprintf update file buffers'],
    code: `#include <stdio.h>

int main() {
  FILE *fp = fopen("report.txt", "w");
  fputc(65, fp);
  fprintf(fp, "=%d\\n", 42);
  fclose(fp);
  printf("done\\n");
  return 0;
}
`,
    virtualFiles: [vf('report.txt', '')],
    suggestedBreakpoints: [4, 5],
    walkthrough: ['Step across fputc and fprintf.', 'Open the File I/O panel buffer.'],
    challenge: 'Add another fputc for a newline and compare offsets.',
    expectedStdout: 'done\n',
    expectedWarnings: [],
  },
  {
    id: 'rewind-file',
    title: 'File offset and rewind',
    topic: 'File I/O',
    difficulty: 'Intermediate',
    lessonGoals: ['Watch file offsets move', 'Reset an offset with rewind'],
    code: `#include <stdio.h>

int main() {
  FILE *fp = fopen("input.txt", "r");
  int first = fgetc(fp);
  int second = fgetc(fp);
  rewind(fp);
  int again = fgetc(fp);
  fclose(fp);
  printf("%c%c%c\\n", first, second, again);
  return 0;
}
`,
    virtualFiles: [vf('input.txt', 'xyz')],
    suggestedBreakpoints: [6],
    walkthrough: ['Step until rewind.', 'Watch the offset return to zero.'],
    challenge: 'Remove rewind and explain the output.',
    expectedStdout: 'xyx\n',
    expectedWarnings: [],
  },
  {
    id: 'runtime-error-trap',
    title: 'Runtime error trap',
    topic: 'Interrupts',
    difficulty: 'Intro',
    lessonGoals: ['See INT 0xff explain a null pointer write', 'Connect pointer validity to runtime traps'],
    code: `#include <stdio.h>

int main() {
  int *p = 0;
  *p = 3;
  return 0;
}
`,
    virtualFiles: [],
    suggestedBreakpoints: [5],
    walkthrough: ['Inspect p before dereferencing.', 'Step into the runtime trap.'],
    challenge: 'Point p at a real local and compare the trace.',
    expectedStdout: '',
    expectedWarnings: ['null pointer'],
  },
  {
    id: 'word-count-capstone',
    title: 'Capstone: word-ish count',
    topic: 'Capstone',
    difficulty: 'Challenge',
    lessonGoals: ['Combine file I/O, loops, comparisons, and counters', 'Track several runtime concepts in one trace'],
    code: `#include <stdio.h>

int main() {
  FILE *fp = fopen("words.txt", "r");
  int spaces = 0;
  int ch = fgetc(fp);
  while (ch != -1) {
    if (ch == 32) {
      spaces = spaces + 1;
    }
    ch = fgetc(fp);
  }
  fclose(fp);
  printf("spaces=%d\\n", spaces);
  return spaces;
}
`,
    virtualFiles: [vf('words.txt', 'red green blue')],
    suggestedBreakpoints: [7, 13],
    walkthrough: ['Run through the first word.', 'Step over the if when a space is read.'],
    challenge: 'Count newlines as separators too.',
    expectedStdout: 'spaces=2\n',
    expectedWarnings: [],
  },
];

export const TOPICS = [...new Set(LESSONS.map(lesson => lesson.topic))];

export function getLesson(id) {
  return LESSONS.find(lesson => lesson.id === id) || LESSONS[0];
}

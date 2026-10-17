# C Machine Lab

C Machine Lab is a teaching workbench for seeing how small C programs execute on a deliberately simple educational machine. It is not x86, ARM, WebAssembly, or a production C runtime. The point is visibility: source, lowered assembly, registers, ALU flags, stack frames, heap blocks, virtual files, interrupts, and memory are shown together.

## Getting Started

Choose a lesson from the toolbar, then use **Step** to execute one teaching instruction at a time. **Run** advances continuously and **Reset** rebuilds the machine from the current source and virtual files.

Edit the source and press **Compile** or `Ctrl+Enter` in the editor. Valid programs produce teaching assembly. Unsupported C produces diagnostics in the editor and diagnostic strip.

## Source And Assembly

The source panel uses Ace in C/C++ mode. The current source line is highlighted while the VM executes.

The assembly panel shows compact teaching instructions such as `MOV`, `LOAD`, `STORE`, `ADD`, `CMP`, `CALL`, `RET`, `INT`, and `HALT`. Each instruction keeps a source-map link back to the C line that produced it.

## Registers, ALU, And Flags

The register panel exposes the teaching CPU registers: `PC`, `SP`, `FP`, `R0-R7`, and `IR`. Changed registers are highlighted after each step.

The ALU panel shows the last arithmetic or comparison operation, operands, result, and `Z`, `N`, `C`, and `V` flags.

## Stack, Pointers, And Heap

Function calls create visible stack frames with parameters, locals, saved frame pointer, return address, and address range. Returning pops the frame and restores control flow.

Pointer variables appear in the pointer inspector. Click a pointer, register, stack slot, heap block, or memory byte to inspect the address, segment, bytes, decoded integer, decoded string, and validity status.

`malloc` and `free` use the VM heap allocator through visible interrupts. Double frees, use-after-free writes, invalid frees, null pointer writes, and leaks at `HALT` are reported as teaching traps or warnings.

## Virtual Files And Interrupts

File I/O uses lesson-owned virtual files only. `fopen`, `fclose`, `fgetc`, `fputc`, `fread`, `fwrite`, `fprintf`, and `rewind` update the File I/O panel and emit interrupt events.

The interrupt panel shows the last runtime trap/syscall, its vector, arguments, affected registers or memory, and handler explanation.

## AI Actions

Configure a provider from the key/server buttons in the toolbar. **Generate** asks the selected model for a small C Machine Lab subset program. **Explain** sends structured machine facts from the current trace, not just the source text.

Generated code is compiled through the same teaching compiler, so unsupported syntax appears as normal diagnostics.

## Runtime Compare

**Compare** runs the current source with the optional browser C runtime adapter and shows VM stdout beside runtime stdout. Differences are useful lesson material because the teaching VM defines behavior for some cases where real C may be undefined.

## Config

The **Config** button opens a JSON editor for memory layout, run speed, trace limits, heap settings, timer interrupt settings, and pointer safety behavior. Saving rebuilds the VM.

## Supported C Subset

The current compiler supports a practical teaching subset: `int`, `char`, `void`, `FILE *`, pointers, one-dimensional arrays, string literals, local and global declarations, assignments, arithmetic, comparisons, logical operators, `if`/`else`, `while`, `for`, `break`, `continue`, functions with value parameters, returns, and the bundled runtime calls shown in the lessons.

Unsupported features such as macros, structs, typedefs, casts, multi-file includes, and C++ are reported as subset diagnostics.

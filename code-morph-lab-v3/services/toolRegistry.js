// Tool definitions + executor for the morph loop.
// Six tools: list_files, read_file, write_file, edit_file, delete_file, run_program.

export function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all files in the workspace.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the full content of a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'Name of the file to read.' },
          },
          required: ['filename'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create a new file or completely overwrite an existing one. Use for new files or small-file rewrites. Prefer edit_file for targeted changes.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string' },
            content: { type: 'string', description: 'Full file content.' },
          },
          required: ['filename', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace an exact occurrence of old_string with new_string inside a file. The old_string must match exactly once. Prefer this over write_file for targeted changes.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string' },
            old_string: { type: 'string', description: 'The exact string to replace. Must appear exactly once.' },
            new_string: { type: 'string', description: 'The replacement string.' },
          },
          required: ['filename', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the workspace.',
        parameters: {
          type: 'object',
          properties: { filename: { type: 'string' } },
          required: ['filename'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_program',
        description: 'Run the program from its entry file and return stdout, stderr, exit code, and timing. Always call this after making changes to verify.',
        parameters: {
          type: 'object',
          properties: {
            entry: { type: 'string', description: 'Name of the entry file to run.' },
          },
          required: ['entry'],
        },
      },
    },
  ];
}

/**
 * Execute a tool call.
 * @param {string} name
 * @param {object} args
 * @param {object} workspace - createWorkspace() instance
 * @param {function} runner - async (entryContent, allFiles) => runResult
 * @returns {Promise<{text: string, rawResult?: object}>}
 */
export async function executeTool(name, args, workspace, runner) {
  try {
    switch (name) {
      case 'list_files': {
        const files = workspace.listFiles();
        if (files.length === 0) return { text: '(workspace is empty)' };
        return { text: files.map(f => `- ${f}`).join('\n') };
      }

      case 'read_file': {
        if (!args.filename) return { text: 'Error: filename required' };
        if (!workspace.hasFile(args.filename)) return { text: `Error: file not found: ${args.filename}` };
        return { text: workspace.readFile(args.filename) };
      }

      case 'write_file': {
        if (!args.filename || typeof args.content !== 'string') {
          return { text: 'Error: filename and content required' };
        }
        if (/[\/\\]/.test(args.filename)) {
          return { text: 'Error: filename must not contain path separators' };
        }
        workspace.writeFile(args.filename, args.content);
        return { text: `ok: wrote ${args.filename} (${args.content.length} bytes)` };
      }

      case 'edit_file': {
        if (!args.filename || typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
          return { text: 'Error: filename, old_string, and new_string required' };
        }
        if (/[\/\\]/.test(args.filename)) {
          return { text: 'Error: filename must not contain path separators' };
        }
        try {
          workspace.editFile(args.filename, args.old_string, args.new_string);
          return { text: `ok: edited ${args.filename}` };
        } catch (e) {
          return { text: `Error: ${e.message}` };
        }
      }

      case 'delete_file': {
        if (!args.filename) return { text: 'Error: filename required' };
        if (/[\/\\]/.test(args.filename)) {
          return { text: 'Error: filename must not contain path separators' };
        }
        workspace.deleteFile(args.filename);
        return { text: `ok: deleted ${args.filename}` };
      }

      case 'run_program': {
        if (!args.entry) return { text: 'Error: entry required' };
        if (!workspace.hasFile(args.entry)) {
          return { text: `Error: entry file not found: ${args.entry}` };
        }
        const entryContent = workspace.readFile(args.entry);
        const rawResult = { ...(await runner(entryContent, workspace.toObject())), entryFile: args.entry };
        const text = [
          `exit ${rawResult.exitCode}`,
          `duration ${rawResult.duration}ms${rawResult.timedOut ? ' (timed out)' : ''}`,
          '',
          'stdout:',
          rawResult.stdout || '(empty)',
          '',
          'stderr:',
          rawResult.stderr || '(empty)',
        ].join('\n');
        return { text, rawResult };
      }

      default:
        return { text: `Error: unknown tool ${name}` };
    }
  } catch (e) {
    return { text: `Error executing ${name}: ${e.message}` };
  }
}

// PostToolUse hook: after Claude edits or writes a .ts/.tsx file, run `eslint --fix` on it.
// Problems ESLint cannot fix are sent back to Claude (exit code 2) so it fixes them.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const filePath = input.tool_input?.file_path;
if (typeof filePath !== 'string' || !/\.(ts|tsx)$/.test(filePath)) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const relative = path.relative(projectDir, filePath);
if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(filePath)) process.exit(0);

const eslintBin = path.join(projectDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!existsSync(eslintBin)) process.exit(0); // dependencies not installed yet

const result = spawnSync(process.execPath, [eslintBin, '--fix', '--no-warn-ignored', filePath], {
  cwd: projectDir,
  encoding: 'utf8',
});

if (result.status === 1) {
  process.stderr.write(`ESLint found problems it could not fix in ${relative}:\n${result.stdout}`);
  process.exit(2);
}
if (result.status !== 0) {
  process.stderr.write(`ESLint failed to run on ${relative}:\n${result.stderr || result.stdout}`);
}
process.exit(0);

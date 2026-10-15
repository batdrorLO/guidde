#!/usr/bin/env node
/**
 * Manage dashboard users in config/users.json (or AUTH_USERS_FILE).
 *
 *   npm run user -w backend -- list
 *   npm run user -w backend -- add jane@company.com "Jane Doe" cs     # prompts for the password
 *   npm run user -w backend -- remove jane@company.com
 *
 * Only roles listed in AUTH_ALLOWED_ROLES (default: cs, admin) can sign in.
 * Set USER_PASSWORD to pass the password non-interactively (e.g. in scripts).
 * The API picks up changes without a restart.
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.env.AUTH_USERS_FILE ? path.resolve(process.env.AUTH_USERS_FILE) : path.join(repoRoot, 'config', 'users.json');

const fail = (msg) => {
  console.error(`Error: ${msg}`);
  process.exit(1);
};
const readUsers = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
const writeUsers = (users) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(users, null, 2) + '\n');
};

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const users = readUsers();
  if (!users.length) console.log(`No users in ${file}`);
  for (const u of users) console.log(`${u.email.padEnd(32)} ${u.role.padEnd(8)} ${u.name}`);
} else if (cmd === 'add') {
  const [rawEmail, name, role] = args;
  if (!rawEmail || !name || !role) fail('usage: add <email> "<full name>" <role>');
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`"${rawEmail}" is not a valid email`);

  const password = process.env.USER_PASSWORD ?? (await promptHidden(`Password for ${email}: `));
  if (password.length < 12) fail('password must be at least 12 characters');

  const users = readUsers().filter((u) => u.email !== email);
  users.push({ email, name, role, passwordHash: bcrypt.hashSync(password, 12) });
  users.sort((a, b) => a.email.localeCompare(b.email));
  writeUsers(users);
  console.log(`Saved ${email} (${role}) to ${file}`);
} else if (cmd === 'remove') {
  const email = (args[0] ?? '').trim().toLowerCase();
  const users = readUsers();
  const next = users.filter((u) => u.email !== email);
  if (next.length === users.length) fail(`no user ${email}`);
  writeUsers(next);
  console.log(`Removed ${email}. Their open sessions stop working on the next request.`);
} else {
  fail('usage: list | add <email> "<full name>" <role> | remove <email>');
}

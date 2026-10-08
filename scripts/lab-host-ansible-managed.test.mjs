/**
 * `ansible_managed` belongs in templates only (2026-10-08).
 *
 * Since ansible-core 2.19, `ansible_managed` is defined only while the
 * template module renders a file. A `copy` task whose `content` named it
 * failed the lab host's bootstrap on its first run after LAB-5 merged
 * ("'ansible_managed' is undefined"), part-way through the play, after the
 * docker role had already moved Docker to its remapped data root and before
 * the coder role had recreated Coder there. ansible-lint does not render task
 * arguments, so nothing in CI saw it.
 *
 * So: no task, handler or vars file under lab-host/ansible names it; a
 * `.j2` template may. A copy task writes the same text out: "# Ansible
 * managed", which is what the templates render.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANSIBLE = join(REPO, 'lab-host', 'ansible');

/** Every file under `dir`, recursively, as a path relative to the repository. */
function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [relative(REPO, path).replace(/\\/g, '/')];
  });
}

/** Lines that use `ansible_managed` as a Jinja expression, as `file:line: text`. */
export function ansibleManagedUses(files, read) {
  const found = [];
  for (const file of files) {
    read(file)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/\{\{-?\s*ansible_managed\b/.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
  }
  return found;
}

const YAML = filesUnder(ANSIBLE).filter((file) => /\.ya?ml$/.test(file));

describe('ansible_managed is used in templates only', () => {
  it('reads the playbook, the roles and their tasks', () => {
    expect(YAML).toContain('lab-host/ansible/site.yml');
    expect(YAML).toContain('lab-host/ansible/roles/coder_sandbox/tasks/main.yml');
    expect(YAML).toContain('lab-host/ansible/roles/labs_agent/tasks/docker_proxy.yml');
  });

  it('is named in no task, handler or vars file', () => {
    const read = (file) => readFileSync(join(REPO, file), 'utf8');
    expect(ansibleManagedUses(YAML, read)).toEqual([]);
  });

  it('would catch the line that failed the run', () => {
    const files = { 'roles/x/tasks/main.yml': 'content: |\n  # {{ ansible_managed }}\n  [Service]\n' };
    expect(ansibleManagedUses(Object.keys(files), (file) => files[file])).toEqual([
      'roles/x/tasks/main.yml:2: # {{ ansible_managed }}',
    ]);
    // The literal text a copy task writes instead is not a use.
    expect(ansibleManagedUses(['a.yml'], () => '# Ansible managed\n')).toEqual([]);
  });

  it('is still what the templates render, so a copied file reads the same as a templated one', () => {
    const templates = filesUnder(ANSIBLE).filter((file) => file.endsWith('.j2'));
    expect(templates.length).toBeGreaterThan(0);
    const read = (file) => readFileSync(join(REPO, file), 'utf8');
    expect(ansibleManagedUses(templates, read).length).toBeGreaterThan(0);
  });
});

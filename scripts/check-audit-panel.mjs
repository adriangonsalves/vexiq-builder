/**
 * Node check for src/components/AuditPanel.jsx: renders the panel to HTML and looks at it. Which row is
 * lit follows the selection, the panel stays in the page when closed (so it can slide), and Attempt Fix
 * shows only on findings that have a part to fix from.
 * Run: node scripts/check-audit-panel.mjs   (exits 1 on failure)
 */
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditIssues, problemCount } from '../src/utils/auditIssues.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Bundle the component (JSX) into a temporary module that resolves react from this project
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-panel-')), 'panel.mjs');
await build({
  entryPoints: [new URL('../src/components/AuditPanel.jsx', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'transform',
  external: ['react', 'react-dom', 'lucide-react'],
  outfile: out,
  logLevel: 'error'
});
fs.copyFileSync(out, new URL('./.audit-panel-check.mjs', import.meta.url).pathname);
const { default: AuditPanel } = await import(pathToFileURL(new URL('./.audit-panel-check.mjs', import.meta.url).pathname).href);
fs.unlinkSync(new URL('./.audit-panel-check.mjs', import.meta.url).pathname);

const audit = {
  isMechanicallySound: false,
  collisionCount: 1, floatingFastenerCount: 0, halfSeatedFastenerCount: 1, unsecuredPartCount: 0,
  underSecuredHeavyPartCount: 0, disconnectedIslandCount: 0, protrudingShaftCount: 0,
  kinematics: { motorCount: 1, meshedGearPairCount: 2, drivenWheelCount: 2, totalWheelCount: 4 },
  collisions: [{ instanceId: 'a', label: 'Beam', collidingWith: ['Plate'] }],
  halfSeatedFasteners: [{ instanceId: 'h', label: 'Pin 3', seatedIn: [{ part: 'Beam', instanceId: 'a' }], nearMiss: [] }],
  singlePinPivotParts: [{ instanceId: 'p', label: 'Stop' }]
};
const issues = auditIssues(audit);
const render = (props) =>
  renderToStaticMarkup(
    React.createElement(AuditPanel, { open: true, audit, issues, problems: problemCount(issues), busy: false, note: null, selectedIds: [], onSelect() {}, onFix() {}, onRefresh() {}, onClose() {}, ...props })
  );

let html = render({});
check('header counts the warnings', html.includes('▲ 2 warnings'), html.slice(0, 200));
check('a row per finding (2 warnings and a note)', (html.match(/class="audit-issue /g) || []).length === 3);
check('nothing selected: no row is lit', !html.includes('audit-issue problem active') && !html.includes('audit-issue note active'));
check('Attempt Fix on the overlap and the half-seated pin, not the note', (html.match(/Attempt Fix/g) || []).length === 2);

html = render({ selectedIds: ['h'] });
const rows = html.split('<li ').slice(1);
const lit = rows.filter((r) => /^class="audit-issue [a-z ]*active"/.test(r));
check('selecting the pin lights its row only', lit.length === 1 && lit[0].includes('Pin 3'), `${lit.length} lit`);
html = render({ selectedIds: ['h', 'a'] });
check('a selection of other parts lights nothing', !html.includes(' active"'));

html = render({ open: false });
check('closed: still in the page (so it can slide), marked hidden and inert', html.includes('class="audit-panel "') && html.includes('aria-hidden="true"') && html.includes('inert'), html.slice(0, 160));
html = render({ open: true });
check('open: marked open', html.includes('class="audit-panel open"'));

html = render({ audit: null, issues: [] });
check('before the first result: says it is running', html.includes('Running the audit'));
html = render({ audit: { ...audit, isMechanicallySound: true }, issues: [] });
check('sound and empty: says so', html.includes('Mechanically sound') && html.includes('Nothing to report'));
html = render({ note: { title: 'Pin 3 holds only one part', text: 'Lined up 4 pins', isError: false } });
check('the last Attempt Fix result is shown', html.includes('Lined up 4 pins'));

console.log(failures === 0 ? '\nAll audit panel checks passed.' : `\n${failures} audit panel check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

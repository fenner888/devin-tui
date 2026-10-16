import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseMouse, selectModifier} from '../src/mouse.js';
import {
	DEFAULT_SETTINGS,
	effectiveSettings,
	loadSettingsFile,
	saveSettingsFile,
} from '../src/settings.js';

// theme tables only resolve to hex under a truecolor terminal — set it
// before any theme module loads
process.env.COLORTERM = 'truecolor';
const theme = await import('../src/theme.js');
const themes = await import('../src/themes.js');
const {resolveTheme, BUILTIN_THEMES, loadCustomThemes, osc11Luminance} = themes;
const {screenBg, setBackground, setTheme, segStyle} = theme;

const HEX = /^#[0-9a-fA-F]{6}$/;

// (a) devin resolved tables must deep-equal the original literal tables
const COLOR_LIT: Record<string, object> = {
	plain: {},
	text: {fg: '#d4d4d4'},
	bright: {fg: '#ffffff'},
	muted: {fg: '#7a7a7a'},
	faint: {fg: '#4a4a4a'},
	rule: {fg: '#2a2a2a'},
	accent: {fg: '#ffffff', bold: true},
	title: {fg: '#ffffff', bold: true},
	strong: {fg: '#ffffff', bold: true},
	sel: {fg: '#0a0a0a', bg: 'sel'},
	code: {fg: '#ffffff', bg: 'raised'},
	err: {fg: '#e06c6c'},
	ok: {fg: '#3ddc84'},
	cmdFlag: {fg: '#6cb6ff'},
	cmdString: {fg: '#e5a07a'},
	thought: {fg: '#7a7a7a', italic: true},
	ghost: {fg: '#4a4a4a'},
	caret: {fg: '#0a0a0a', bg: 'sel'},
	spin: {fg: '#7a7a7a'},
	pk: {fg: '#4db8ff'},
	pkBold: {fg: '#4db8ff', bold: true},
	pkDim: {fg: '#4db8ff', dim: true},
	pkOff: {fg: '#5f6b78'},
	pkGreen: {fg: '#3ddc84'},
	pkYellow: {fg: '#e6d17a'},
	pkOrange: {fg: '#e5a07a'},
	pkPurple: {fg: '#b48ead'},
	pkBadge: {fg: '#0a0a0a', bg: 'pkBlue'},
	bezelHi: {fg: '#6a6a6a'},
	bezelMid: {fg: '#4a4a4a'},
	bezelLo: {fg: '#2e2e2e'},
	shine1: {fg: '#ffffff'},
	shine2: {fg: '#cfcfcf'},
	shine3: {fg: '#9a9a9a'},
};
const BG_LIT: Record<string, string> = {
	bg: '#0a0a0a',
	panel: '#141414',
	overlay: '#1a1a1a',
	raised: '#202020',
	sel: '#e8e8e8',
	pkSel: '#1c2530',
	pkBlue: '#4db8ff',
	diffAdd: '#12261a',
	diffDel: '#2a1414',
};

test('devin theme resolves to the original literal tables', () => {
	const devin = BUILTIN_THEMES.find(t => t.id === 'devin')!;
	const r = resolveTheme(devin);
	for (const [tok, def] of Object.entries(COLOR_LIT)) {
		assert.deepEqual(
			r.colors[tok as keyof typeof r.colors],
			def,
			`token ${tok}`,
		);
	}
	assert.deepEqual(r.bgs, BG_LIT);
	// the two new pattern tokens derive from bg→bright
	assert.equal(r.colors.patternFar.fg, '#252525');
	assert.equal(r.colors.patternNear.fg, '#191919');
});

test('every built-in resolves every Token/Bg to valid hex', () => {
	for (const def of BUILTIN_THEMES) {
		const r = resolveTheme(def);
		for (const [tok, d] of Object.entries(r.colors)) {
			if (tok === 'plain') continue;
			assert.match(d.fg ?? '', HEX, `${def.id}.${tok} fg`);
		}
		for (const [bg, v] of Object.entries(r.bgs)) {
			assert.match(v, HEX, `${def.id}.${bg} bg`);
		}
	}
});

test('custom themes: extends, palette/token overrides, bad values, bad JSON', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-tui-themes-'));
	fs.writeFileSync(
		path.join(dir, 'mine.json'),
		JSON.stringify({
			name: 'Mine',
			extends: 'nord',
			palette: {bg: '#101010', ok: 'not-a-hex', bogus: '#ffffff'},
			tokens: {accent: '#ff0000'},
		}),
	);
	fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
	const {themes: custom, errors} = loadCustomThemes(dir);
	assert.equal(errors.length, 1);
	assert.equal(errors[0].file, 'broken.json');
	const mine = custom.find(t => t.id === 'mine')!;
	assert.equal(mine.name, 'Mine');
	assert.equal(mine.palette.bg, '#101010'); // palette override applied
	assert.equal(mine.palette.ok, '#a3be8c'); // bad hex ignored → nord base
	assert.equal(
		(mine.palette as unknown as Record<string, unknown>).bogus,
		undefined,
	);
	assert.equal(mine.tokens?.accent, '#ff0000');
	// resolved: accent override wins over derivation
	const r = resolveTheme(mine);
	assert.equal(r.colors.accent.fg, '#ff0000');
	assert.equal(r.bgs.bg, '#101010');
});

test('settings: missing file → defaults; per-field fallback; round trip', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-tui-cfg-'));
	process.env.XDG_CONFIG_HOME = dir;
	const file = path.join(dir, 'devin-tui', 'config.json');
	// missing file → defaults
	assert.deepEqual(loadSettingsFile(file), DEFAULT_SETTINGS);
	// per-field fallback: one bad field never resets the others
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(
		file,
		JSON.stringify({theme: 42, background: 'solid', extra: 'x'}),
	);
	const s = loadSettingsFile(file);
	assert.equal(s.theme, 'auto'); // bad → default
	assert.equal(s.background, 'solid'); // good → kept
	// unparseable JSON → all defaults
	fs.writeFileSync(file, '{{{');
	assert.deepEqual(loadSettingsFile(file), DEFAULT_SETTINGS);
	// save → load round trip (atomic tmp+rename)
	const next = {
		...DEFAULT_SETTINGS,
		theme: 'nord',
		width: 'wide' as const,
		alerts: 'off' as const,
	};
	saveSettingsFile(next, file);
	assert.deepEqual(loadSettingsFile(file), next);
	assert.equal(fs.existsSync(file), true);
	// effectiveSettings picks the same file through XDG_CONFIG_HOME
	assert.equal(effectiveSettings().theme, 'nord');
	delete process.env.XDG_CONFIG_HOME;
});

test('parseMouse: wheel, left press/release, other buttons, motion, non-mouse', () => {
	assert.deepEqual(parseMouse('\x1b[<64;5;10M'), {kind: 'wheel', dir: 'up'});
	assert.deepEqual(parseMouse('\x1b[<65;5;10M'), {kind: 'wheel', dir: 'down'});
	// ESC-stripped form too
	assert.deepEqual(parseMouse('[<64;5;10M'), {kind: 'wheel', dir: 'up'});
	// click: SGR button-0 press → 0-based coords
	assert.deepEqual(parseMouse('\x1b[<0;12;8M'), {kind: 'click', x: 11, y: 7});
	assert.deepEqual(parseMouse('\x1b[<0;12;8m'), {kind: 'release', x: 11, y: 7});
	// other-button releases and motion → null
	assert.equal(parseMouse('\x1b[<2;12;8m'), null);
	assert.equal(parseMouse('\x1b[<32;5;5M'), null);
	assert.equal(parseMouse('\x1b[<32;5;5m'), null);
	assert.equal(parseMouse('\x1b[<2;5;5M'), null);
	// non-mouse input → undefined
	assert.equal(parseMouse('x'), undefined);
	assert.equal(parseMouse('\x1b[A'), undefined);
});

test('selectModifier maps terminal programs to drag-selection keys', () => {
	assert.equal(selectModifier('iTerm.app'), 'option');
	assert.equal(selectModifier('Apple_Terminal'), 'fn');
	assert.equal(selectModifier('WezTerm'), 'shift');
});

test('screenBg: lifted top, exact bg below 60%, monotonic, transparent', () => {
	setTheme(BUILTIN_THEMES.find(t => t.id === 'devin')!);
	setBackground('gradient');
	const rows = 20;
	const bg = '#0a0a0a';
	assert.notEqual(screenBg(0, rows), bg); // row 0 lifted
	let prev = Infinity;
	for (let r = 0; r < rows; r++) {
		const v = parseInt(screenBg(r, rows)!.slice(1), 16);
		assert.ok(v <= prev, `row ${r} not monotonic`);
		prev = v;
	}
	for (let r = 12; r < rows; r++) assert.equal(screenBg(r, rows), bg); // ≥60%
	assert.equal(screenBg(11, rows), bg); // smoothstep already at 0
	setBackground('solid');
	assert.equal(screenBg(0, rows), bg);
	assert.equal(screenBg(19, rows), bg);
	setBackground('transparent');
	assert.equal(screenBg(0, rows), undefined);
	assert.equal(screenBg(19, rows), undefined);
	setBackground('pattern');
	// segStyle uses the row color wherever the resolved bg is 'bg'
	assert.equal(
		segStyle('text', 'bg', undefined, '#123456').backgroundColor,
		'#123456',
	);
	setBackground('solid');
});

test('transcriptLayout: item spans map rows; separators/perms unmapped', async () => {
	const {transcriptLayout} = await import('../src/ui/transcript.js');
	const {initialState} = await import('../src/state/store.js');
	const s = initialState('/tmp/x', undefined, '');
	s.status = 'idle';
	s.items = [
		{kind: 'user', id: 'u1', text: 'hello'},
		{
			kind: 'tool',
			id: 't1',
			toolCallId: 'tc1',
			toolKind: 'execute',
			title: 'Ran ls',
			status: 'completed',
			rawInput: {command: 'ls'},
		},
		{kind: 'agent', id: 'a1', text: 'done', streaming: false},
	];
	s.permission = {
		toolCallId: 'tc1',
		title: 'Run ls',
		toolKind: 'execute',
		options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once'}],
	};
	const w = 80;
	const {lines, spans} = transcriptLayout(s, w, 0, 0);
	// item rows are covered exactly once, in order
	const covered = new Array<string | undefined>(lines.length);
	for (const sp of spans) {
		for (let i = sp.start; i < sp.end; i++) covered[i] = sp.id;
	}
	assert.deepEqual(
		spans.map(sp => sp.id),
		['u1', 't1', 'a1'],
	);
	// the blank separator rows between items are unmapped
	assert.equal(covered[spans[0].end], undefined);
	assert.equal(covered[spans[1].end], undefined);
	// the inline permission rows after the tool item are unmapped
	const permRow = lines.findIndex(l =>
		l.some(sg => sg.t.includes('↑↓ select')),
	);
	assert.notEqual(permRow, -1);
	assert.equal(covered[permRow], undefined);
	assert.equal(covered[permRow] === 't1', false);
	// every mapped row id matches its item
	for (let i = 0; i < lines.length; i++) {
		if (covered[i]) {
			const sp = spans.find(sp => i >= sp.start && i < sp.end)!;
			assert.equal(covered[i], sp.id);
		}
	}
});

test('OSC 11 reply parser: 2/4-digit, BEL/ST, light vs dark', () => {
	// 4-digit + BEL
	assert.ok(osc11Luminance('\x1b]11;rgb:ffff/ffff/ffff\x07')! > 0.5);
	assert.ok(osc11Luminance('\x1b]11;rgb:0000/0000/0000\x07')! < 0.5);
	// 2-digit + ST
	assert.ok(osc11Luminance('\x1b]11;rgb:ff/ff/ff\x1b\\')! > 0.5);
	assert.ok(osc11Luminance('\x1b]11;rgb:11/22/33\x1b\\')! < 0.5);
	// dark gray is still "dark" under linearized luminance
	assert.ok(osc11Luminance('\x1b]11;rgb:8080/8080/8080\x07')! < 0.5);
	// reply embedded in other output
	assert.ok(
		osc11Luminance('junk\x1b]11;rgb:eeee/eeee/eeee\x07more')! > 0.5,
	);
	assert.equal(osc11Luminance('no reply here'), null);
	assert.equal(osc11Luminance('\x1b]11;?\x07'), null);
});

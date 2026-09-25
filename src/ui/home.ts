import {
	type Seg,
	seg,
	padSegs,
	blankLine,
	strWidth,
	truncSegs,
} from './lines.js';
import {
	LOGO_2X,
	SPINNER,
	TIPS,
	VERSION,
	type Token,
} from '../theme.js';
import {inputPanel, hintsLine, shortCwd} from './panel.js';
import {
	fusionData,
	fusionLines,
	pickerLines,
	resumeLines,
	type FusionView,
	type PickerView,
	type ResumeView,
} from './picker.js';
import {
	handoffBlock,
	slashMenuBlock,
	type HandoffInfo,
} from './overlays.js';
import {
	displayMode,
	displayModel,
	findConfigOption,
	type State,
} from '../state/store.js';
import type {CatalogState} from '../catalog.js';

export interface HomeUI {
	value: string;
	cursor: number;
	tick: number;
	authSel: number;
	picker?: PickerView;
	fusion?: FusionView;
	resume?: ResumeView;
	paletteSel: number;
	slashItems: {name: string; description?: string}[];
	slashOpen: boolean;
	mentionItems: {name: string}[];
	mentionOpen: boolean;
	mentionSel: number;
	chips: {icon: string; label: string}[];
	handoff?: HandoffInfo; // /handoff confirmation, above the composer
	catalog: CatalogState; // model pricing catalog (pickers)
}

/** The needsAuth sign-in menu — replaces the input panel on the home screen. */
function authMenu(s: State, sel: number, w: number): Seg[][] {
	const rows: Seg[][] = [
		padSegs([seg('  Sign in to Devin', 'title', 'panel')], w, 'panel'),
	];
	if (s.authError) {
		rows.push(
			padSegs(
				[
					seg('  ✗ ', 'err', 'panel'),
					seg(s.authError, 'err', 'panel'),
				],
				w,
				'panel',
			),
		);
	}
	rows.push(padSegs([], w, 'panel'));
	const items = [
		...s.authMethods.map(m => ({
			label: m.name ?? m.id,
			desc: m.description ?? '',
		})),
		{label: 'Quit', desc: 'exit devin-tui'},
	];
	items.forEach((it, i) => {
		const selected = i === sel;
		const row: Seg[] = [
			seg('  ', 'plain', 'panel'),
			seg(it.label, 'bright', 'panel'),
			...(it.desc
				? [seg('  ', 'plain', 'panel'), seg(it.desc, 'muted', 'panel')]
				: []),
		];
		rows.push(
			padSegs(
				selected
					? row.map(sg => ({...sg, k: 'sel' as const, bg: 'sel' as const}))
					: row,
				w,
				selected ? 'sel' : 'panel',
			),
		);
	});
	rows.push(padSegs([], w, 'panel'));
	rows.push(
		padSegs(
			[
				seg('  ↑↓', 'bright', 'panel'),
				seg(' select · ', 'muted', 'panel'),
				seg('↵', 'bright', 'panel'),
				seg(' confirm', 'muted', 'panel'),
			],
			w,
			'panel',
		),
	);
	return rows;
}

/**
 * Token for a logo char at column `x`: a bright band sweeping left→right over
 * the muted mark, continuously and without pauses (static only on error).
 */
function logoToken(
	s: State,
	tick: number,
	x: number,
	width: number,
): Token {
	if (s.status === 'error') return 'muted';
	const band = 6;
	const pos = (tick % (width + band * 2)) - band;
	return x >= pos && x < pos + band ? 'bright' : 'muted';
}

/** Centered home screen shown until the first prompt is sent. */
export function homeLines(
	s: State,
	ui: HomeUI,
	cols: number,
	rows: number,
): Seg[][] {
	const w = Math.min(78, cols - 8);
	const x = Math.max(0, Math.floor((cols - w) / 2));
	const logoW = strWidth(LOGO_2X[0] ?? '');
	const input = inputPanel(w, ui.value, ui.cursor, ui.tick, {
		ready: !!s.sessionId,
		mode: displayMode(s),
		modeId: s.mode,
		model: displayModel(s),
		cwd: shortCwd(s.cwd),
		working: s.status === 'working',
	}, ui.chips);
	// the picker sheds detail rows to fit between the logo zone and the
	// composer (see session.ts for the same budgeting); the budget also
	// reserves the 3 bottom rows (corner row + 2 blanks)
	const pkBudget = Math.max(6, rows - input.length - 12);
	const pkRows = (() => {
		if ((!ui.picker && !ui.fusion && !ui.resume) || s.status === 'needsAuth')
			return [] as Seg[][];
		if (ui.resume) return resumeLines(ui.resume, s.sessionId, s.cwd, w);
		const mo = findConfigOption(s, 'model');
		if (!mo) return [] as Seg[][];
		if (ui.fusion) {
			return fusionLines(
				fusionData(mo),
				mo.currentValue,
				ui.fusion,
				w,
				ui.catalog,
				pkBudget,
			);
		}
		return pickerLines(
			mo,
			findConfigOption(s, 'thought_level'),
			ui.picker!,
			w,
			ui.catalog,
			pkBudget,
		);
	})();
	const slashRows =
		ui.slashOpen && s.status !== 'needsAuth'
			? slashMenuBlock(ui.slashItems, ui.paletteSel, w)
			: ui.mentionOpen && s.status !== 'needsAuth'
				? slashMenuBlock(ui.mentionItems, ui.mentionSel, w, '@')
				: [];
	const handoffRows =
		ui.handoff && s.status !== 'needsAuth'
			? handoffBlock(ui.handoff, w)
			: [];
	const logoX = x + Math.max(0, Math.floor((w - logoW) / 2));

	const at = (col: number, segs: Seg[]): Seg[] =>
		padSegs([seg(' '.repeat(Math.max(0, col))), ...segs], cols);

	// ---- status zone (boot steps / auth / error / tip) -------------------------
	const zone: Seg[][] = [];
	if (s.status === 'error') {
		zone.push(
			at(x, [
				seg('✗ ', 'err'),
				seg(s.error ?? 'unknown error', 'err'),
			]),
		);
		if (s.logFile) zone.push(at(x, [seg(`  log: ${s.logFile}`, 'muted')]));
		zone.push(at(x, [seg('press q to quit', 'muted')]));
	} else if (s.status !== 'needsAuth') {
		for (const st of s.boot) {
			const icon =
				st.state === 'active'
					? seg(`${SPINNER[ui.tick % SPINNER.length]} `, 'spin')
					: st.state === 'done'
						? seg('✓ ', 'ok')
						: st.state === 'failed'
							? seg('✗ ', 'err')
							: seg('· ', 'faint');
			zone.push(
				at(x, [
					icon,
					seg(st.label, st.state === 'failed' ? 'err' : 'text'),
					...(st.detail ? [seg('  '), seg(st.detail, 'muted')] : []),
				]),
			);
		}
		if (s.status === 'auth') {
			zone.push(at(x, [seg('  q to quit', 'faint')]));
		}
	}
	if (s.status === 'idle') {
		const tip = TIPS[Math.floor(ui.tick / 125) % TIPS.length];
		zone.length = 0;
		zone.push(
			at(x, [
				seg('● Tip  ', 'bright'),
				seg(tip.key, 'bright'),
				seg(` ${tip.text}`, 'muted'),
			]),
		);
	}

	const block: Seg[][] = [
		...LOGO_2X.map(row =>
			at(
				logoX,
				[...row].map((ch, i) => seg(ch, logoToken(s, ui.tick, i, logoW))),
			),
		),
		blankLine(cols),
		at(
			x + Math.max(0, Math.floor((w - strWidth('Devin TUI')) / 2)),
			[seg('Devin', 'title'), seg(' TUI', 'muted')],
		),
		at(
			x +
				Math.max(
					0,
					Math.floor(
						(w - strWidth(`${VERSION} · ${s.agentTitle ?? ''}`.trim())) / 2,
					),
				),
			[
				seg(
					s.agentTitle ? `${VERSION} · ${s.agentTitle}` : VERSION,
					'muted',
				),
			],
		),
		blankLine(cols),
		...(s.status === 'needsAuth'
			? authMenu(s, ui.authSel, w).map(row => at(x, row))
			: [
					...pkRows.map(row => at(x, row)),
					...slashRows.map(row => at(x, row)),
					...handoffRows.map(row => at(x, row)),
					...input.map(row => at(x, row)),
					at(
						x,
						hintsLine(w, [
							['shift+tab', 'mode'],
							['ctrl+p', 'commands'],
							['alt+enter', 'newline'],
							['@', 'file'],
							['▣', 'drop image'],
						]),
					),
				]),
		blankLine(cols),
		...zone,
	];

	// vertically center the block above the corner zone (corner row at
	// rows-3 + 2 blank rows); if it overflows (e.g. an open slash dropdown
	// on a short screen) let the top rows (logo/title) slide off so the
	// composer stays fully visible
	const top = Math.floor((rows - 3 - block.length) / 2);
	const lines: Seg[][] = [];
	for (let i = 0; i < rows; i++) {
		const bi = i - top;
		lines.push(
			bi >= 0 && bi < block.length && i < rows - 3
				? block[bi]
				: blankLine(cols),
		);
	}

	// corners — same bottom placement as the session status bar: 2-col
	// inset each side, two blank rows below
	const cwdLabel = `  ${shortCwd(s.cwd)}`;
	const branchLabel = s.gitBranch ? ` (${s.gitBranch})` : '';
	const ver = `${VERSION}  `;
	const cornerRow = padSegs(
		[
			seg(cwdLabel, 'muted'),
			seg(branchLabel, 'faint'),
			seg(
				' '.repeat(
					Math.max(
						0,
						cols -
							strWidth(cwdLabel) -
							strWidth(branchLabel) -
							strWidth(ver),
					),
				),
			),
			seg(ver, 'faint'),
		],
		cols,
	);
	if (rows >= 3) lines[rows - 3] = truncSegs(cornerRow, cols);
	return lines;
}

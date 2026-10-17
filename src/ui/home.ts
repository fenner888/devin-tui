import {
	type Seg,
	seg,
	padSegs,
	blankLine,
	segsWidth,
	strWidth,
	truncSegs,
} from './lines.js';
import {
	LOGO_2X,
	SPINNER,
	TIPS,
	TRUECOLOR,
	VERSION,
	type Token,
} from '../theme.js';
import {inputPanel, hintsLine, shortCwd} from './panel.js';
import {
	fusionData,
	fusionLines,
	pickerLines,
	cloudPickerLines,
	relTime,
	resumeLines,
	type CloudPickerView,
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
	flash?: string;
	picker?: PickerView;
	fusion?: FusionView;
	resume?: ResumeView;
	cloudPicker?: CloudPickerView;
	recent?: {title?: string | null; updatedAt?: string | null};
	paletteSel: number;
	slashItems: {name: string; description?: string}[];
	slashTop: number; // dropdown window top (scrolls to keep sel visible)
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

/** Staggered `·` dot field for the 'pattern' background — home screen
 *  only, never behind text: space cells on bg become dots on a staggered
 *  grid (`row % 2 === 0`, `(col + ((row/2) % 2) * 3) % 6 === 0`), skipping
 *  the block rows ±1 × block cols ±4 and the corner row + the 2 below it.
 *  Dots in the outer half of the remaining distance from the block are
 *  `patternFar`, the inner half `patternNear`. */
function dotField(
	lines: Seg[][],
	zone: {top: number; h: number; x: number; w: number},
	cols: number,
	rows: number,
): Seg[][] {
	const rTop = zone.top - 1;
	const rBot = zone.top + zone.h;
	const cL = zone.x - 4;
	const cR = zone.x + zone.w + 4;
	const maxD = Math.max(cL, cols - 1 - cR, rTop, rows - 1 - rBot, 1);
	return lines.map((line, r) => {
		if (r % 2 !== 0 || r >= rows - 3) return line;
		const stagger = ((r / 2) % 2) * 3;
		const out: Seg[] = [];
		let col = 0;
		for (const s of line) {
			const sw = strWidth(s.t);
			if ((s.bg ?? 'bg') !== 'bg' || s.t.trim() !== '') {
				out.push(s);
				col += sw;
				continue;
			}
			let buf = '';
			const flush = () => {
				if (buf) {
					out.push({t: buf, k: s.k, bg: s.bg});
					buf = '';
				}
			};
			for (const ch of s.t) {
				const inZone = r >= rTop && r <= rBot && col >= cL && col <= cR;
				const dot = !inZone && (col + stagger) % 6 === 0;
				if (!dot) {
					buf += ch;
					col++;
					continue;
				}
				flush();
				const dx = col < cL ? cL - col : col > cR ? col - cR : 0;
				const dy = r < rTop ? rTop - r : r > rBot ? r - rBot : 0;
				const d = Math.max(dx, dy);
				out.push(seg('·', d * 2 > maxD ? 'patternFar' : 'patternNear', 'bg'));
				col++;
			}
			flush();
		}
		return out;
	});
}

/** Centered home screen shown until the first prompt is sent.
 *  `pattern` draws the staggered dot field (truecolor + pattern bg only). */
export function homeLines(
	s: State,
	ui: HomeUI,
	cols: number,
	rows: number,
	pattern = false,
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
	const slashRows =
		ui.slashOpen && s.status !== 'needsAuth'
			? slashMenuBlock(ui.slashItems, ui.paletteSel, w, '/', ui.slashTop)
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
		const recent = ui.recent;
		zone.length = 0;
		if (ui.flash) {
			zone.push(
				at(x, [seg('● ', 'bright'), seg(ui.flash, 'bright')]),
			);
		} else if (recent) {
			const when = relTime(recent.updatedAt);
			const prefix = [seg('Recent  ', 'bright')];
			const suffix = [
				...(when ? [seg(` · ${when}`, 'faint')] : []),
				seg('   '),
				seg('ctrl+r', 'bright'),
				seg(' resume', 'muted'),
			];
			const titleRoom = Math.max(
				0,
				w - segsWidth([...prefix, ...suffix]),
			);
			zone.push(
				at(x, [
					...prefix,
					...truncSegs([seg(recent.title || 'Untitled')], titleRoom),
					...suffix,
				]),
			);
		} else {
			zone.push(
				at(x, [
					seg('● Tip  ', 'bright'),
					seg(tip.key, 'bright'),
					seg(` ${tip.text}`, 'muted'),
				]),
			);
		}
	}

	const homeHints: [string, string][] = [
		['shift+tab', 'mode'],
		['ctrl+p', 'commands'],
		['alt+enter', 'newline'],
		['@', 'file'],
		['▣', 'drop image'],
	];
	const resumeHints: [string, string][] = [...homeHints, ['ctrl+r', 'resume']];
	const shownHints =
		segsWidth(hintsLine(w, resumeHints)) <= w ? resumeHints : homeHints;

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
					...input.map(row => at(x, row)),
					at(
						x,
						hintsLine(w, shownHints),
					),
				]),
		blankLine(cols),
		...zone,
	];

	// vertically center the block above the corner zone (corner row at
	// rows-3 + 2 blank rows); if it overflows let the top rows (logo/title)
	// slide off so the composer stays fully visible. Popups (pickers,
	// dropdown, handoff) are NOT part of the block — they overlay the rows
	// directly above the composer afterwards, so the logo, title and
	// composer never move when a popup opens or narrows.
	const top = Math.floor((rows - 3 - block.length) / 2);
	const compTop = top + LOGO_2X.length + 4; // logo + blank + title + version + blank
	const popupSpace = Math.min(compTop, Math.max(0, rows - 3));
	// the picker sheds detail rows so the whole popup stack fits in the
	// space above the composer; whatever still overflows keeps its bottom
	// rows (nearest the composer)
	const pkBudget = Math.max(
		6,
		popupSpace - slashRows.length - handoffRows.length,
	);
	const pkRows = (() => {
		if (
			(!ui.picker && !ui.fusion && !ui.resume && !ui.cloudPicker) ||
			s.status === 'needsAuth'
		)
			return [] as Seg[][];
		if (ui.cloudPicker)
			return cloudPickerLines(ui.cloudPicker, w, pkBudget);
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
	const popupRows = [...pkRows, ...slashRows, ...handoffRows].map(row =>
		at(x, row),
	);
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
	const right: Seg[] = [
		seg(VERSION, 'faint'),
		...(s.updateAvailable
			? [
					seg(' · update ', 'muted'),
					seg(`v${s.updateAvailable}`, 'bright'),
					seg(' available — type /update', 'muted'),
				]
			: []),
		seg('  '),
	];
	const rightW = segsWidth(right);
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
							rightW,
					),
				),
			),
			...right,
		],
		cols,
	);
	if (rows >= 3) lines[rows - 3] = truncSegs(cornerRow, cols);
	const out =
		pattern && TRUECOLOR
			? dotField(lines, {top, h: block.length, x, w}, cols, rows)
			: lines;
	// popups overlay the rows directly above the composer — spliced after
	// the dot field so no dots draw over them; when the stack is taller
	// than the space, its bottom rows (nearest the composer) win
	const popup = popupRows.slice(Math.max(0, popupRows.length - popupSpace));
	for (let i = 0; i < popup.length; i++) {
		out[popupSpace - popup.length + i] = popup[i];
	}
	return out;
}

import {
	type Seg,
	seg,
	padSegs,
	blankLine,
	findMatches,
	highlightRow,
} from './lines.js';
import {
	transcriptLayout,
	planLines,
	moreMarker,
	statusBar,
} from './transcript.js';
import {findPanel, inputPanel, shortCwd} from './panel.js';
import {handoffBlock, slashMenuBlock, type HandoffInfo} from './overlays.js';
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
	displayMode,
	displayModel,
	findConfigOption,
	type State,
} from '../state/store.js';
import type {CatalogState} from '../catalog.js';
import {fmtSpend, sessionSpend} from '../spend.js';

export interface SessionUI {
	value: string;
	cursor: number;
	tick: number;
	scrollOffset: number;
	paletteSel: number;
	slashItems: {name: string; description?: string}[];
	slashTop: number; // dropdown window top (scrolls to keep sel visible)
	slashOpen: boolean;
	mentionItems: {name: string}[]; // @file dropdown rows
	mentionOpen: boolean;
	mentionSel: number;
	chips: {icon: string; label: string}[]; // attachment chips in the composer
	modelPicker?: PickerView; // /model picker state, above the input panel
	fusion?: FusionView; // /fusion picker state, above the input panel
	resume?: ResumeView; // /resume picker state, above the input panel
	permSel: number; // selected option in the inline permission prompt
	handoff?: HandoffInfo; // /handoff confirmation, above the input panel
	find?: {query: string; cursor: number; selected: number; end: number};
	catalog: CatalogState; // model pricing catalog (pickers)
}

/** Reading width by zoom setting: compact keeps transcripts narrow,
 *  comfortable is the default cap, wide uses the full screen. */
export function contentWidth(
	cols: number,
	width: 'compact' | 'comfortable' | 'wide' = 'comfortable',
): number {
	if (width === 'compact') return Math.min(88, cols - 4);
	if (width === 'wide') return cols - 4;
	return Math.min(110, cols - 4);
}

/** The session screen: transcript + plan + dropdown + input + status bar.
 *  `rowItem` maps every screen row to the transcript item id occupying it
 *  (undefined for blanks/aux/status) — the App keeps it for click hit-tests. */
export function sessionLines(
	s: State,
	ui: SessionUI,
	cols: number,
	rows: number,
	width: 'compact' | 'comfortable' | 'wide' = 'comfortable',
): {
	lines: Seg[][];
	rowItem: (string | undefined)[];
	transcriptHeight: number;
} {
	const w = contentWidth(cols, width);
	const x = Math.max(0, Math.floor((cols - w) / 2));
	const frame = (line: Seg[]): Seg[] =>
		padSegs([seg(' '.repeat(x)), ...line], cols);

	// bottom-fixed blocks (nearest input last); the dropdown stays flush on
	// the input panel while the plan gets a blank-row gap on both sides
	const plan = s.sidebar ? planLines(s, w, ui.tick) : [];
	const layout = transcriptLayout(s, w, ui.tick, ui.permSel);
	const all = layout.lines;
	const matches = ui.find ? findMatches(all, ui.find.query) : [];
	const selected = ui.find
		? matches[Math.min(ui.find.selected, matches.length - 1)]
		: undefined;
	const effectiveEnd = ui.find
		? Math.min(all.length, Math.max(0, ui.find.end))
		: Math.max(0, all.length - ui.scrollOffset);
	const effectiveOffset = Math.max(0, all.length - effectiveEnd);
	const dropdown = ui.slashOpen
		? slashMenuBlock(ui.slashItems, ui.paletteSel, w, '/', ui.slashTop)
		: ui.mentionOpen
			? slashMenuBlock(ui.mentionItems, ui.mentionSel, w, '@')
			: [];
	const marker =
		effectiveOffset > 0 ? [moreMarker(effectiveOffset, w)] : [];
	const meta = {
		ready: !!s.sessionId,
		mode: displayMode(s),
		modeId: s.mode,
		model: displayModel(s),
		cwd: shortCwd(s.cwd),
		working: s.status === 'working',
	};
	const input = ui.find
		? findPanel(
				w,
				ui.find.query,
				ui.find.cursor,
				ui.tick,
				meta,
				selected ? ui.find.selected + 1 : 0,
				matches.length,
			)
		: inputPanel(w, ui.value, ui.cursor, ui.tick, meta, ui.chips);
	// pickers, the dropdown and the handoff confirm are POPUPS: they
	// overlay the bottom of the transcript area (spliced in below) rather
	// than shrinking it, so the transcript doesn't scroll when they open
	// or filter. Only the plan block and the scroll marker take layout.
	const handoffRows = ui.handoff ? handoffBlock(ui.handoff, w) : [];
	const resumeRows = ui.resume
		? resumeLines(ui.resume, s.sessionId, s.cwd, w)
		: [];
	const aux = [
		...plan,
		...(plan.length > 0 ? [blankLine(w)] : []),
		...marker,
	];
	const transH = Math.max(1, rows - input.length - 1 - aux.length - 1 - 3);
	// the picker sheds detail rows so the whole popup stack fits in the
	// transcript area; whatever still overflows keeps its bottom rows
	const pkMax = Math.max(
		6,
		transH - dropdown.length - handoffRows.length - resumeRows.length,
	);
	const modelOpt =
		ui.modelPicker || ui.fusion ? findConfigOption(s, 'model') : undefined;
	const modelPk =
		ui.modelPicker && modelOpt
			? pickerLines(
					modelOpt,
					findConfigOption(s, 'thought_level'),
					ui.modelPicker,
					w,
					ui.catalog,
					pkMax,
				)
			: [];
	const fusionRows =
		ui.fusion && modelOpt
			? fusionLines(
					fusionData(modelOpt),
					modelOpt.currentValue,
					ui.fusion,
					w,
					ui.catalog,
					pkMax,
				)
			: [];
	const popup = [
		...modelPk,
		...fusionRows,
		...resumeRows,
		...dropdown,
		...handoffRows,
	];

	const end = effectiveEnd;
	const start = Math.max(0, end - transH);
	const view = all.slice(start, end).map((line, i) => {
		if (!ui.find) return line;
		const row = start + i;
		const ranges = matches.filter(match => match.row === row);
		const current = selected?.row === row ? selected : undefined;
		return highlightRow(line, ranges, current);
	});
	const fillTop = transH - view.length;

	// transcript row index → item id (separators/permission rows unmapped)
	const itemAt = new Array<string | undefined>(all.length);
	for (const sp of layout.spans) {
		for (let i = sp.start; i < sp.end; i++) itemAt[i] = sp.id;
	}

	const lines: Seg[][] = [];
	const rowItem: (string | undefined)[] = [];
	for (let i = 0; i < fillTop; i++) {
		lines.push(blankLine(cols));
		rowItem.push(undefined);
	}
	for (let i = 0; i < view.length; i++) {
		lines.push(frame(view[i]));
		rowItem.push(itemAt[start + i]);
	}
	lines.push(blankLine(cols));
	rowItem.push(undefined);
	for (const l of aux) {
		lines.push(frame(l));
		rowItem.push(undefined);
	}
	for (const l of input) {
		lines.push(frame(l));
		rowItem.push(undefined);
	}

	// breathing room: one blank row between the composer and the status
	// bar, and two below the status bar so it doesn't sit near the last row
	lines.push(blankLine(cols));
	rowItem.push(undefined);
	const elapsed = s.turnStartedAt ? Date.now() - s.turnStartedAt : 0;
	const spend =
		s.turnStats.length > 0 || s.reportedCost
			? fmtSpend(sessionSpend(s.turnStats, ui.catalog, s.reportedCost))
			: undefined;
	lines.push(statusBar(s, cols, ui.tick, elapsed, spend));
	rowItem.push(undefined);
	lines.push(blankLine(cols));
	rowItem.push(undefined);
	lines.push(blankLine(cols));
	rowItem.push(undefined);

	// overlay the popup stack on the transcript's bottom rows, directly
	// above the blank row over the aux/input blocks; overflow keeps the
	// bottom rows. Covered rows lose their item id so clicks there don't
	// open focus.
	const pop = popup.slice(Math.max(0, popup.length - transH));
	for (let i = 0; i < pop.length; i++) {
		const r = transH - pop.length + i;
		lines[r] = frame(pop[i]);
		rowItem[r] = undefined;
	}

	while (lines.length < rows) {
		lines.unshift(blankLine(cols));
		rowItem.unshift(undefined);
	}
	if (lines.length > rows) {
		lines.length = rows;
		rowItem.length = rows;
	}
	return {lines, rowItem, transcriptHeight: transH};
}

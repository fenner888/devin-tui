import {
	type Seg,
	seg,
	padSegs,
	blankLine,
} from './lines.js';
import {
	transcriptLines,
	planLines,
	moreMarker,
	statusBar,
} from './transcript.js';
import {inputPanel, shortCwd} from './panel.js';
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

export interface SessionUI {
	value: string;
	cursor: number;
	tick: number;
	scrollOffset: number;
	paletteSel: number;
	slashItems: {name: string; description?: string}[];
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
	catalog: CatalogState; // model pricing catalog (pickers)
}

export function contentWidth(cols: number): number {
	return Math.min(110, cols - 4);
}

/** The session screen: transcript + plan + dropdown + input + status bar. */
export function sessionLines(
	s: State,
	ui: SessionUI,
	cols: number,
	rows: number,
): Seg[][] {
	const w = contentWidth(cols);
	const x = Math.max(0, Math.floor((cols - w) / 2));
	const frame = (line: Seg[]): Seg[] =>
		padSegs([seg(' '.repeat(x)), ...line], cols);

	// bottom-fixed blocks (nearest input last); the dropdown stays flush on
	// the input panel while the plan gets a blank-row gap on both sides
	const plan = s.sidebar ? planLines(s, w, ui.tick) : [];
	const dropdown = ui.slashOpen
		? slashMenuBlock(ui.slashItems, ui.paletteSel, w)
		: ui.mentionOpen
			? slashMenuBlock(ui.mentionItems, ui.mentionSel, w, '@')
			: [];
	const marker =
		ui.scrollOffset > 0 ? [moreMarker(ui.scrollOffset, w)] : [];
	const input = inputPanel(w, ui.value, ui.cursor, ui.tick, {
		ready: !!s.sessionId,
		mode: displayMode(s),
		modeId: s.mode,
		model: displayModel(s),
		cwd: shortCwd(s.cwd),
		working: s.status === 'working',
	}, ui.chips);
	// picker blocks budget what's left after the composer, the status bar
	// and its blank rows, the transcript/blank gap and any other aux rows —
	// the picker sheds its detail rows to fit at small heights
	const otherAux =
		plan.length +
		(plan.length > 0 ? 1 : 0) +
		marker.length +
		dropdown.length +
		(ui.handoff ? handoffBlock(ui.handoff, w).length : 0);
	const pkMax = Math.max(6, rows - input.length - 6 - otherAux);
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
	const resumeRows = ui.resume
		? resumeLines(ui.resume, s.sessionId, s.cwd, w)
		: [];
	const handoffRows = ui.handoff ? handoffBlock(ui.handoff, w) : [];
	const aux = [
		...plan,
		...(plan.length > 0 ? [blankLine(w)] : []),
		...marker,
		...modelPk,
		...fusionRows,
		...resumeRows,
		...dropdown,
		...handoffRows,
	];

	const transH = Math.max(
		1,
		rows - input.length - 1 - aux.length - 1 - 2,
	);
	const all = transcriptLines(s, w, ui.tick, ui.permSel);
	const end = Math.max(0, all.length - ui.scrollOffset);
	const start = Math.max(0, end - transH);
	const view = all.slice(start, end);
	const fillTop = transH - view.length;

	const lines: Seg[][] = [];
	for (let i = 0; i < fillTop; i++) lines.push(blankLine(cols));
	for (const l of view) lines.push(frame(l));
	lines.push(blankLine(cols));
	for (const l of aux) lines.push(frame(l));
	for (const l of input) lines.push(frame(l));

	// breathing room: one blank row between the composer and the status
	// bar, and one below the status bar so it doesn't sit on the last row
	lines.push(blankLine(cols));
	const elapsed = s.turnStartedAt ? Date.now() - s.turnStartedAt : 0;
	lines.push(statusBar(s, cols, ui.tick, elapsed));
	lines.push(blankLine(cols));

	while (lines.length < rows) lines.unshift(blankLine(cols));
	if (lines.length > rows) lines.length = rows;
	return lines;
}

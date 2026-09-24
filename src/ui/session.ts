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
	type FusionView,
	type PickerView,
} from './picker.js';
import {
	displayMode,
	displayModel,
	findConfigOption,
	type State,
} from '../state/store.js';

export interface SessionUI {
	value: string;
	cursor: number;
	tick: number;
	scrollOffset: number;
	paletteSel: number;
	slashItems: {name: string; description?: string}[];
	slashOpen: boolean;
	modelPicker?: PickerView; // /model picker state, above the input panel
	fusion?: FusionView; // /fusion picker state, above the input panel
	permSel: number; // selected option in the inline permission prompt
	handoff?: HandoffInfo; // /handoff confirmation, above the input panel
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
		: [];
	const marker =
		ui.scrollOffset > 0 ? [moreMarker(ui.scrollOffset, w)] : [];
	const modelOpt =
		ui.modelPicker || ui.fusion ? findConfigOption(s, 'model') : undefined;
	const modelPk =
		ui.modelPicker && modelOpt
			? pickerLines(
					modelOpt,
					findConfigOption(s, 'thought_level'),
					ui.modelPicker,
					w,
				)
			: [];
	const fusionRows =
		ui.fusion && modelOpt
			? fusionLines(
					fusionData(modelOpt),
					modelOpt.currentValue,
					ui.fusion,
					w,
				)
			: [];
	const handoffRows = ui.handoff ? handoffBlock(ui.handoff, w) : [];
	const aux = [
		...plan,
		...(plan.length > 0 ? [blankLine(w)] : []),
		...marker,
		...modelPk,
		...fusionRows,
		...dropdown,
		...handoffRows,
	];
	const input = inputPanel(w, ui.value, ui.cursor, ui.tick, {
		ready: !!s.sessionId,
		mode: displayMode(s),
		modeId: s.mode,
		model: displayModel(s),
		cwd: shortCwd(s.cwd),
		working: s.status === 'working',
	});

	const transH = Math.max(
		1,
		rows - input.length - 1 - aux.length - 1,
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

	const elapsed = s.turnStartedAt ? Date.now() - s.turnStartedAt : 0;
	lines.push(statusBar(s, cols, ui.tick, elapsed));

	while (lines.length < rows) lines.unshift(blankLine(cols));
	if (lines.length > rows) lines.length = rows;
	return lines;
}

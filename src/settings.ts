import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';

/** Persisted user settings — `~/.config/devin-tui/config.json`
 *  (`$XDG_CONFIG_HOME/devin-tui` when set). The file is only written once
 *  the user changes something; missing/bad fields fall back to defaults
 *  individually so a corrupted value never resets the rest. */
export interface Settings {
	/** 'auto' | a built-in theme id | a custom theme id */
	theme: string;
	background: 'pattern' | 'gradient' | 'solid' | 'transparent';
	width: 'compact' | 'comfortable' | 'wide';
	mouse: boolean;
	motion: boolean;
	alerts: 'bell' | 'notify' | 'off';
}

export const DEFAULT_SETTINGS: Settings = {
	theme: 'auto',
	background: 'pattern',
	width: 'comfortable',
	mouse: true,
	motion: true,
	alerts: 'bell',
};

export function configDir(): string {
	return path.join(
		process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
		'devin-tui',
	);
}

export function configPath(): string {
	return path.join(configDir(), 'config.json');
}

const FIELD: Record<keyof Settings, z.ZodType> = {
	theme: z.string().min(1),
	background: z.enum(['pattern', 'gradient', 'solid', 'transparent']),
	width: z.enum(['compact', 'comfortable', 'wide']),
	mouse: z.boolean(),
	motion: z.boolean(),
	alerts: z.enum(['bell', 'notify', 'off']),
};

/** File → settings. Missing keys and fields that fail their schema fall
 *  back to that field's default; unparseable JSON → all defaults. */
export function loadSettingsFile(file = configPath()): Settings {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return {...DEFAULT_SETTINGS};
	}
	if (typeof raw !== 'object' || raw === null) return {...DEFAULT_SETTINGS};
	const out = {...DEFAULT_SETTINGS};
	for (const k of Object.keys(FIELD) as (keyof Settings)[]) {
		const v = FIELD[k].safeParse((raw as Record<string, unknown>)[k]);
		if (v.success) (out as Record<string, unknown>)[k] = v.data;
	}
	return out;
}

/** Atomic write: tmp file + rename so a crash never halves the file. */
export function saveSettingsFile(
	s: Settings,
	file = configPath(),
): void {
	try {
		fs.mkdirSync(path.dirname(file), {recursive: true});
		const tmp = `${file}.tmp-${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify(s, null, '\t') + '\n');
		fs.renameSync(tmp, file);
	} catch {
		// settings persistence is best-effort — never crash the UI over it
	}
}

/** Env overrides win over the file and are never written back:
 *  `DEVIN_TUI_THEME=<id>`, `DEVIN_TUI_REDUCED_MOTION=1`,
 *  `DEVIN_TUI_NO_MOUSE=1`. */
export function effectiveSettings(file = configPath()): Settings {
	const s = loadSettingsFile(file);
	const t = process.env.DEVIN_TUI_THEME;
	if (t) s.theme = t;
	if (process.env.DEVIN_TUI_REDUCED_MOTION === '1') s.motion = false;
	if (process.env.DEVIN_TUI_NO_MOUSE === '1') s.mouse = false;
	return s;
}

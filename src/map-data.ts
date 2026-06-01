export interface MapInstance {
	id: string;
	assetPath: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	hidden?: true;
	locked?: boolean;
	label?: string;
}

export type MeasureDiagonal = 'exact' | 'one-to-one' | 'alternating' | 'no-diagonal';

export interface MapData {
	version: number;
	settings: {
		cellSize: number;
		panSpeed: number;
		gridColor: string;
		showGrid: boolean;
		measureUnits: number;
		measureUnitLabel: string;
		measureDiagonal: MeasureDiagonal;
	};
	camera: {
		panX: number;
		panY: number;
		zoom: number;
	};
	layers: {
		backgrounds: MapInstance[];
		prefabs: MapInstance[];
		objects: MapInstance[];
		tokens: MapInstance[];
	};
}

export const DEFAULT_MAP_DATA: MapData = {
	version: 1,
	settings: {
		cellSize: 100,
		panSpeed: 400,
		gridColor: '#7882a0',
		showGrid: true,
		measureUnits: 5,
		measureUnitLabel: 'ft',
		measureDiagonal: 'exact',
	},
	camera: {
		panX: 0,
		panY: 0,
		zoom: 1,
	},
	layers: {
		backgrounds: [],
		prefabs: [],
		objects: [],
		tokens: [],
	},
};

export interface ParseDefaults {
	measureUnits?: number;
	measureUnitLabel?: string;
	measureDiagonal?: MeasureDiagonal;
}

/** Parse untrusted JSON into a valid MapData, falling back to defaults for missing/invalid fields. */
export function parseMapData(content: string, defaults?: ParseDefaults): MapData {
	try {
		const raw = JSON.parse(content) as Record<string, unknown>;
		const s = raw['settings'] as Record<string, unknown> | undefined;
		const c = raw['camera']   as Record<string, unknown> | undefined;
		const l = raw['layers']   as Record<string, unknown> | undefined;

		return {
			version: asNumber(raw['version'], 1),
			settings: {
				cellSize:        asNumber(s?.['cellSize'], DEFAULT_MAP_DATA.settings.cellSize),
				panSpeed:        asNumber(s?.['panSpeed'], DEFAULT_MAP_DATA.settings.panSpeed),
				gridColor:       asHexColor(s?.['gridColor'], DEFAULT_MAP_DATA.settings.gridColor),
				showGrid:        asBoolean(s?.['showGrid'], DEFAULT_MAP_DATA.settings.showGrid),
				measureUnits:     Math.max(1, asNumber(s?.['measureUnits'], defaults?.measureUnits ?? DEFAULT_MAP_DATA.settings.measureUnits)),
				measureUnitLabel: asString(s?.['measureUnitLabel'], defaults?.measureUnitLabel ?? DEFAULT_MAP_DATA.settings.measureUnitLabel),
				measureDiagonal:  asMeasureDiagonal(s?.['measureDiagonal'], defaults?.measureDiagonal ?? DEFAULT_MAP_DATA.settings.measureDiagonal),
			},
			camera: {
				panX: asNumber(c?.['panX'], 0),
				panY: asNumber(c?.['panY'], 0),
				zoom: asNumber(c?.['zoom'], 1),
			},
			layers: {
				backgrounds: asInstances(l?.['backgrounds']),
				prefabs:     asInstances(l?.['prefabs']),
				objects:     asInstances(l?.['objects']),
				tokens:      asInstances(l?.['tokens']),
			},
		};
	} catch {
		return structuredClone(DEFAULT_MAP_DATA);
	}
}

function asMeasureDiagonal(val: unknown, fallback: MeasureDiagonal): MeasureDiagonal {
	if (val === 'exact' || val === 'one-to-one' || val === 'alternating' || val === 'no-diagonal') return val;
	return fallback;
}

function asString(val: unknown, fallback: string): string {
	return typeof val === 'string' && val.length > 0 ? val : fallback;
}

function asNumber(val: unknown, fallback: number): number {
	return typeof val === 'number' && isFinite(val) ? val : fallback;
}

function asBoolean(val: unknown, fallback: boolean): boolean {
	return typeof val === 'boolean' ? val : fallback;
}

function asHexColor(val: unknown, fallback: string): string {
	return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback;
}

function asInstance(val: unknown): MapInstance | null {
	if (typeof val !== 'object' || val === null) return null;
	const obj = val as Record<string, unknown>;
	const assetPath = typeof obj['assetPath'] === 'string' ? obj['assetPath'] : '';
	if (!assetPath) return null;
	return {
		id:       typeof obj['id'] === 'string' && obj['id'] ? obj['id'] : crypto.randomUUID(),
		assetPath,
		x:        asNumber(obj['x'], 0),
		y:        asNumber(obj['y'], 0),
		width:    asNumber(obj['width'], 100),
		height:   asNumber(obj['height'], 100),
		rotation: asNumber(obj['rotation'], 0),
		...(obj['hidden'] === true ? { hidden: true as const } : {}),
		...(typeof obj['locked'] === 'boolean' ? { locked: obj['locked'] } : {}),
		...(typeof obj['label'] === 'string' && obj['label'] ? { label: obj['label'] } : {}),
	};
}

function asInstances(val: unknown): MapInstance[] {
	if (!Array.isArray(val)) return [];
	return val.map(asInstance).filter((i): i is MapInstance => i !== null);
}

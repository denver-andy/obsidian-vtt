import { setIcon } from 'obsidian';
import type { MeasureDiagonal } from './map-data';

export interface LeftMenuOptions {
	initialCellSize: number;
	initialPanSpeed: number;
	initialGridColor: string;
	initialShowGrid: boolean;
	initialMeasureUnits: number;
	initialMeasureUnitLabel: string;
	initialMeasureDiagonal: MeasureDiagonal;
	onReset: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onCellSizeChange: (val: number) => void;
	onPanSpeedChange: (val: number) => void;
	onGridColorChange: (val: string) => void;
	onShowGridChange: (val: boolean) => void;
	onMeasureUnitsChange: (val: number) => void;
	onMeasureUnitLabelChange: (val: string) => void;
	onMeasureDiagonalChange: (val: MeasureDiagonal) => void;
	onMeasureToolToggle: (active: boolean) => void;
	onActorsToggle: () => void;
}

export class LeftMenu {
	private readonly el: HTMLElement;
	private cellSizeInput!: HTMLInputElement;
	private panSpeedInput!: HTMLInputElement;
	private gridColorSwatch!: HTMLInputElement;
	private gridColorHex!: HTMLInputElement;
	private setShowGrid!: (checked: boolean) => void;
	private measureUnitsInput!: HTMLInputElement;
	private measureUnitLabelInput!: HTMLInputElement;
	private measureDiagonalSelect!: HTMLSelectElement;
	private measureBtn!: HTMLElement;
	private measureToolActive = false;

	constructor(container: HTMLElement, options: LeftMenuOptions) {
		const group = container.createEl('div', { cls: 'vtt-toolbar-group' });
		const toolbar = group.createEl('div', { cls: 'vtt-toolbar' });

		this.addToolbarBtn(toolbar, 'home',     'Reset view', options.onReset);
		this.addToolbarBtn(toolbar, 'zoom-out', 'Zoom out',   options.onZoomOut);
		this.addToolbarBtn(toolbar, 'zoom-in',  'Zoom in',    options.onZoomIn);

		let actorsActive = false;
		const actorsBtn = this.addToolbarBtn(toolbar, 'users', 'Actors', () => {
			actorsActive = !actorsActive;
			actorsBtn.toggleClass('is-active', actorsActive);
			if (actorsActive) {
				// Only one sub-menu may be open at a time.
				settingsPanel.removeClass('is-open');
				settingsBtn.removeClass('is-active');
			}
			options.onActorsToggle();
		});

		this.measureBtn = this.addToolbarBtn(toolbar, 'ruler', 'Measure', () => {
			this.measureToolActive = !this.measureToolActive;
			this.measureBtn.toggleClass('is-active', this.measureToolActive);
			options.onMeasureToolToggle(this.measureToolActive);
		});

		const settingsPanel = this.buildSettingsPanel(group, options);
		const settingsBtn = this.addToolbarBtn(toolbar, 'settings', 'Map settings', () => {
			const open = !settingsPanel.hasClass('is-open');
			settingsPanel.toggleClass('is-open', open);
			settingsBtn.toggleClass('is-active', open);
			if (open && actorsActive) {
				// Only one sub-menu may be open at a time.
				actorsActive = false;
				actorsBtn.removeClass('is-active');
				options.onActorsToggle();
			}
		});

		this.el = group;
	}

	destroy() {
		this.el.remove();
	}

	deactivateMeasureTool() {
		if (!this.measureToolActive) return;
		this.measureToolActive = false;
		this.measureBtn.removeClass('is-active');
	}

	/** Sync inputs when a new file is loaded. */
	applySettings(cellSize: number, panSpeed: number, gridColor: string, showGrid: boolean, measureUnits: number, measureUnitLabel: string, measureDiagonal: MeasureDiagonal) {
		this.cellSizeInput.value = String(cellSize);
		this.panSpeedInput.value = String(panSpeed);
		this.gridColorSwatch.value = gridColor;
		this.gridColorHex.value = gridColor;
		this.setShowGrid(showGrid);
		this.measureDiagonalSelect.value = measureDiagonal;
		this.measureUnitsInput.value = String(measureUnits);
		this.measureUnitLabelInput.value = measureUnitLabel;
		if (this.measureToolActive) {
			this.measureToolActive = false;
			this.measureBtn.removeClass('is-active');
		}
	}

	private buildSettingsPanel(parent: HTMLElement, options: LeftMenuOptions): HTMLElement {
		const panel = parent.createEl('div', { cls: 'vtt-map-settings' });

		this.cellSizeInput = this.addSettingRow(
			panel, 'Cell size (px)', options.initialCellSize, 20, 500, options.onCellSizeChange,
		);
		this.panSpeedInput = this.addSettingRow(
			panel, 'Pan speed (px/s)', options.initialPanSpeed, 50, 2000, options.onPanSpeedChange,
		);
		this.addColorRow(panel, 'Grid color', options.initialGridColor, options.onGridColorChange);
		this.setShowGrid = this.addToggleRow(panel, 'Show grid', options.initialShowGrid, options.onShowGridChange);
		this.measureDiagonalSelect = this.addSelectRow<MeasureDiagonal>(
			panel, 'Diagonal', options.initialMeasureDiagonal,
			[
				{ value: 'exact',       label: 'Exact' },
				{ value: 'one-to-one',  label: '1-for-1' },
				{ value: 'alternating', label: 'Alternating' },
				{ value: 'no-diagonal', label: 'No diagonal' },
			],
			options.onMeasureDiagonalChange,
		);
		this.measureUnitsInput = this.addSettingRow(
			panel, 'Units/square', options.initialMeasureUnits, 1, 9999, options.onMeasureUnitsChange,
		);
		this.measureUnitLabelInput = this.addTextRow(
			panel, 'Unit label', options.initialMeasureUnitLabel, 12, options.onMeasureUnitLabelChange,
		);

		return panel;
	}

	private addColorRow(
		parent: HTMLElement,
		label: string,
		initialValue: string,
		onChange: (val: string) => void,
	) {
		const row = parent.createEl('div', { cls: 'vtt-settings-row' });
		row.createEl('span', { text: label, cls: 'vtt-settings-label' });

		const controls = row.createEl('div', { cls: 'vtt-color-controls' });

		this.gridColorSwatch = controls.createEl('input', {
			attr: { type: 'color', value: initialValue },
		});
		this.gridColorHex = controls.createEl('input', {
			attr: { type: 'text', value: initialValue, maxlength: '7', spellcheck: 'false' },
			cls: 'vtt-hex-input',
		});

		this.gridColorSwatch.addEventListener('input', () => {
			this.gridColorHex.value = this.gridColorSwatch.value;
			onChange(this.gridColorSwatch.value);
		});

		this.gridColorHex.addEventListener('change', () => {
			const val = this.gridColorHex.value.trim();
			if (/^#[0-9a-fA-F]{6}$/.test(val)) {
				this.gridColorSwatch.value = val;
				onChange(val);
			} else {
				this.gridColorHex.value = this.gridColorSwatch.value;
			}
		});
	}

	private addSettingRow(
		parent: HTMLElement,
		label: string,
		initialValue: number,
		min: number,
		max: number,
		onChange: (val: number) => void,
	): HTMLInputElement {
		const row = parent.createEl('div', { cls: 'vtt-settings-row' });
		row.createEl('span', { text: label, cls: 'vtt-settings-label' });
		const input = row.createEl('input', {
			attr: { type: 'number', min: String(min), max: String(max), value: String(initialValue), step: '1' },
		});
		input.addEventListener('change', () => {
			const parsed = Number(input.value);
			const val = Math.max(min, Math.min(max, isNaN(parsed) ? initialValue : Math.round(parsed)));
			input.value = String(val);
			onChange(val);
		});
		return input;
	}

	private addToggleRow(
		parent: HTMLElement,
		label: string,
		initialValue: boolean,
		onChange: (val: boolean) => void,
	): (checked: boolean) => void {
		const row = parent.createEl('div', { cls: 'vtt-settings-row' });
		row.createEl('span', { text: label, cls: 'vtt-settings-label' });
		const track = row.createEl('div', {
			cls: 'vtt-toggle',
			attr: { role: 'switch', 'aria-checked': String(initialValue), tabindex: '0' },
		});
		if (initialValue) track.addClass('is-checked');
		track.createEl('div', { cls: 'vtt-toggle-thumb' });

		let current = initialValue;
		const apply = (val: boolean) => {
			current = val;
			track.toggleClass('is-checked', val);
			track.setAttribute('aria-checked', String(val));
		};

		track.addEventListener('click', () => { apply(!current); onChange(current); });
		track.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				apply(!current);
				onChange(current);
			}
		});

		return apply;
	}

	private addTextRow(
		parent: HTMLElement,
		label: string,
		initialValue: string,
		maxLength: number,
		onChange: (val: string) => void,
	): HTMLInputElement {
		const row = parent.createEl('div', { cls: 'vtt-settings-row' });
		row.createEl('span', { text: label, cls: 'vtt-settings-label' });
		const input = row.createEl('input', {
			attr: { type: 'text', value: initialValue, maxlength: String(maxLength), spellcheck: 'false' },
		});
		input.addEventListener('change', () => {
			const val = input.value.trim();
			if (val) { onChange(val); }
			else { input.value = initialValue; }
		});
		return input;
	}

	private addSelectRow<T extends string>(
		parent: HTMLElement,
		label: string,
		initialValue: T,
		options: { value: T; label: string }[],
		onChange: (val: T) => void,
	): HTMLSelectElement {
		const row = parent.createEl('div', { cls: 'vtt-settings-row' });
		row.createEl('span', { text: label, cls: 'vtt-settings-label' });
		const select = row.createEl('select', { cls: 'vtt-select' });
		for (const opt of options) {
			const el = select.createEl('option', { text: opt.label, attr: { value: opt.value } });
			if (opt.value === initialValue) el.selected = true;
		}
		select.addEventListener('change', () => onChange(select.value as T));
		return select;
	}

	private addToolbarBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const btn = parent.createEl('button', { cls: 'vtt-toolbar-btn', attr: { 'aria-label': label } });
		setIcon(btn, icon);
		btn.addEventListener('mousedown', e => e.preventDefault());
		btn.addEventListener('click', onClick);
		return btn;
	}
}

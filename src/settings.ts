import { App, PluginSettingTab, Setting } from 'obsidian';
import VTTPlugin from './main';
import type { MeasureDiagonal } from './map-data';

export interface VTTPluginSettings {
	cellSize: number;
	panSpeed: number;
	backgroundsFolder: string;
	prefabsFolder: string;
	objectsFolder: string;
	tokensFolder: string;
	defaultMeasureUnits: number;
	defaultMeasureUnitLabel: string;
	defaultMeasureDiagonal: MeasureDiagonal;
}

export const DEFAULT_SETTINGS: VTTPluginSettings = {
	cellSize: 100,
	panSpeed: 400,
	backgroundsFolder: '',
	prefabsFolder: '',
	objectsFolder: '',
	tokensFolder: '',
	defaultMeasureUnits: 5,
	defaultMeasureUnitLabel: 'ft',
	defaultMeasureDiagonal: 'exact',
};

type FolderKey = 'backgroundsFolder' | 'prefabsFolder' | 'objectsFolder' | 'tokensFolder';

export class VTTSettingTab extends PluginSettingTab {
	plugin: VTTPlugin;

	constructor(app: App, plugin: VTTPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h3', { text: 'Custom asset folders' });
		containerEl.createEl('p', { text: 'Vault-relative paths to folders containing your own assets. Leave blank to disable.', cls: 'setting-item-description' });

		this.addFolderSetting(containerEl, 'Backgrounds folder', 'backgroundsFolder');
		this.addFolderSetting(containerEl, 'Prefabs folder',     'prefabsFolder');
		this.addFolderSetting(containerEl, 'Objects folder',     'objectsFolder');
		this.addFolderSetting(containerEl, 'Tokens folder',      'tokensFolder');

		containerEl.createEl('h3', { text: 'Measurement defaults' });
		containerEl.createEl('p', { text: 'Default values for new maps. Per-map settings in the left menu override these.', cls: 'setting-item-description' });

		new Setting(containerEl)
			.setName('Units per square')
			.setDesc('Distance represented by one grid square (e.g. 5 for 5 feet).')
			.addText(text => text
				.setPlaceholder('5')
				.setValue(String(this.plugin.settings.defaultMeasureUnits))
				.onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 1) {
						this.plugin.settings.defaultMeasureUnits = parsed;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Unit label')
			.setDesc('Label for the unit of measure (e.g. "ft" or "m").')
			.addText(text => text
				.setPlaceholder('ft')
				.setValue(this.plugin.settings.defaultMeasureUnitLabel)
				.onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed) {
						this.plugin.settings.defaultMeasureUnitLabel = trimmed;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Diagonal movement')
			.setDesc('Rule used to calculate diagonal distances.')
			.addDropdown(drop => drop
				.addOption('exact',       'Exact (Euclidean)')
				.addOption('one-to-one',  '1-for-1 (Chebyshev)')
				.addOption('alternating', 'Alternating (3.5e / PF1)')
				.addOption('no-diagonal', 'No diagonal (Manhattan)')
				.setValue(this.plugin.settings.defaultMeasureDiagonal)
				.onChange(async (value) => {
					this.plugin.settings.defaultMeasureDiagonal = value as MeasureDiagonal;
					await this.plugin.saveSettings();
				}));
	}

	private addFolderSetting(containerEl: HTMLElement, name: string, key: FolderKey) {
		new Setting(containerEl)
			.setName(name)
			.setDesc('e.g. "VTT/My Backgrounds"')
			.addText(text => text
				.setPlaceholder('Vault path…')
				.setValue(this.plugin.settings[key])
				.onChange(async (value) => {
					this.plugin.settings[key] = value.trim();
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged();
				}));
	}
}

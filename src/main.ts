import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, VTTPluginSettings, VTTSettingTab } from './settings';
import { VTT_VIEW_TYPE, VttView } from './vtt-view';
import { DEFAULT_MAP_DATA } from './map-data';

export default class VTTPlugin extends Plugin {
	settings!: VTTPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VTT_VIEW_TYPE, (leaf) => new VttView(leaf, this));
		this.registerExtensions(['vttmap'], VTT_VIEW_TYPE);

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.addRibbonIcon('map', 'New VTT map', () => { void this.createAndOpenMap(); });

		this.addSettingTab(new VTTSettingTab(this.app, this));
	}

	onunload() {}

	private async createAndOpenMap() {
		let name = 'Untitled Map.vttmap';
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(name) !== null) {
			name = `Untitled Map ${counter}.vttmap`;
			counter++;
		}

		const mapData = structuredClone(DEFAULT_MAP_DATA);
		mapData.settings.cellSize         = this.settings.cellSize;
		mapData.settings.panSpeed         = this.settings.panSpeed;
		mapData.settings.measureUnits     = this.settings.defaultMeasureUnits;
		mapData.settings.measureUnitLabel = this.settings.defaultMeasureUnitLabel;
		mapData.settings.measureDiagonal  = this.settings.defaultMeasureDiagonal;
		const content = JSON.stringify(mapData, null, 2);
		const file = await this.app.vault.create(name, content);

		const leaf: WorkspaceLeaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}

	notifySettingsChanged() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof VttView) {
				leaf.view.applySettings();
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VTTPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

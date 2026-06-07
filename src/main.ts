import { addIcon, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, VTTPluginSettings, VTTSettingTab } from './settings';
import { VTT_VIEW_TYPE, VttView } from './vtt-view';
import { DEFAULT_MAP_DATA } from './map-data';
import { CharacterModal, CHARACTER_TYPE_CONFIGS, VttCharacterType } from './character-modal';

export default class VTTPlugin extends Plugin {
	settings!: VTTPluginSettings;

	async onload() {
		// Obsidian wraps addIcon content in viewBox="0 0 100 100"; Lucide paths are
		// 24x24, so scale(4.167) maps them into the 100x100 space. Stroke attributes
		// must be explicit because the custom-icon SVG wrapper has no defaults.
		addIcon('mirror-rectangular',
			'<g transform="scale(4.167)" fill="none" stroke="currentColor"' +
			' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
			'<rect x="4" y="2" width="16" height="20" rx="2"/>' +
			'<path d="M11 6 8 9"/>' +
			'<path d="m16 7-8 8"/>' +
			'</g>',
		);

		await this.loadSettings();

		this.registerView(VTT_VIEW_TYPE, (leaf) => new VttView(leaf, this));
		this.registerExtensions(['vttmap'], VTT_VIEW_TYPE);

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.addRibbonIcon('map', 'New VTT map', () => { void this.createAndOpenMap(); });

		this.addSettingTab(new VTTSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on('file-menu', (menu, abstractFile) => {
			if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') return;
			const file = abstractFile;

			menu.addItem(item => {
				// setSubmenu() exists at runtime but is not yet in the installed type definitions.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const submenu = (item.setTitle('VTT').setIcon('map') as any).setSubmenu();

				for (const type of ['pc', 'npc', 'beast'] as VttCharacterType[]) {
					const config = CHARACTER_TYPE_CONFIGS[type];
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					submenu.addItem((sub: any) =>
						sub.setTitle(config.label).setIcon(config.icon).onClick(() => {
							new CharacterModal(this.app, file, type, {
								pluginDir: this.manifest.dir ?? '',
								adapter: this.app.vault.adapter,
								customTokensFolder: this.settings.tokensFolder,
							}).open();
						}),
					);
				}
			});
		}));
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

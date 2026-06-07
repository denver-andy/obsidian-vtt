import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import { MapRenderer, type AssetDropData } from './map-renderer';
import { ContentBrowser, type CustomAssetFolders } from './content-browser';
import { LeftMenu } from './left-menu';
import { SceneHierarchy, DeleteConfirmModal } from './scene-hierarchy';
import { AssetActionMenu } from './asset-action-menu';
import { DiceTray } from './dice-tray';
import { ActorsPanel } from './actors-panel';
import type { VTTPluginSettings } from './settings';
import { DEFAULT_MAP_DATA, parseMapData, type MapData, type MapInstance } from './map-data';

export const VTT_VIEW_TYPE = 'vtt-map';

interface PluginRef {
	settings: VTTPluginSettings;
	saveSettings(): Promise<void>;
	manifest: { dir?: string };
}

export class VttView extends FileView {
	private readonly plugin: PluginRef;
	private renderer: MapRenderer | null = null;
	private leftMenu: LeftMenu | null = null;
	private browser: ContentBrowser | null = null;
	private hierarchy: SceneHierarchy | null = null;
	private actionMenu: AssetActionMenu | null = null;
	private diceTray: DiceTray | null = null;
	private actorsPanel: ActorsPanel | null = null;
	private mapData: MapData = structuredClone(DEFAULT_MAP_DATA);
	private autosaveId: number | null = null;
	private lastSaved = '';
	private clipboard: { instance: MapInstance; layerId: keyof MapData['layers'] } | null = null;
	private currentSelection = new Set<string>();

	constructor(leaf: WorkspaceLeaf, plugin: PluginRef) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VTT_VIEW_TYPE; }
	getDisplayText(): string { return this.file?.basename ?? 'VTT Map'; }
	getIcon(): string { return 'map'; }

	canAcceptExtension(extension: string): boolean {
		return extension === 'vttmap';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('vtt-map-container');

		this.renderer = new MapRenderer(this.contentEl, {
			cellSize:  this.mapData.settings.cellSize,
			panSpeed:  this.mapData.settings.panSpeed,
			gridColor: this.mapData.settings.gridColor,
			showGrid:  this.mapData.settings.showGrid,
			getResourcePath: (path) => this.app.vault.adapter.getResourcePath(path),
			onAssetDrop: (data) => { void this.handleAssetDrop(data); },
			onSelect: (instanceId) => {
				const newSel = instanceId ? new Set([instanceId]) : new Set<string>();
				this.currentSelection = newSel;
				this.renderer?.setSelectedIds(newSel);
				this.hierarchy?.setSelection(newSel);
			},
			onMultiToggle: (instanceId) => {
				const newSel = new Set(this.currentSelection);
				if (newSel.has(instanceId)) newSel.delete(instanceId);
				else newSel.add(instanceId);
				this.currentSelection = newSel;
				this.renderer?.setSelectedIds(newSel);
				this.hierarchy?.setSelection(newSel);
			},
			onMeasureDeactivate: () => {
				this.leftMenu?.deactivateMeasureTool();
			},
			onCopySelection: (instanceId, layerId) => {
				const inst = this.mapData.layers[layerId].find(i => i.id === instanceId);
				if (inst) this.clipboard = { instance: structuredClone(inst), layerId };
			},
			onPasteRequest: (worldX, worldY) => {
				if (!this.clipboard || !this.renderer) return;
				const { instance, layerId } = this.clipboard;
				const newInst: MapInstance = { ...structuredClone(instance), id: crypto.randomUUID(), x: worldX, y: worldY };
				this.mapData.layers[layerId].push(newInst);
				const newSel = new Set([newInst.id]);
				this.currentSelection = newSel;
				this.renderer.setLayers(this.mapData.layers);
				this.renderer.setSelectedIds(newSel);
				this.hierarchy?.setLayers(this.mapData.layers);
			},
			onAfterDraw: (bounds) => {
				if (!this.actionMenu) return;
				const onModeChange = (mode: 'move' | 'rotate' | 'resize') => this.renderer?.setActiveMode(mode);
				if (!bounds) { this.actionMenu.update(null, false, onModeChange); return; }
				let isLocked: boolean;
				if (bounds.isMulti) {
					isLocked = [...this.currentSelection].every(id => {
						for (const lid of ['backgrounds', 'tiles', 'prefabs', 'objects', 'tokens', 'actors'] as const) {
							const inst = this.mapData.layers[lid].find(i => i.id === id);
							if (inst) return inst.locked ?? (lid === 'backgrounds' || lid === 'prefabs');
						}
						return false;
					});
				} else {
					const inst = this.mapData.layers[bounds.layerId].find(i => i.id === bounds.instanceId);
					const defaultLocked = bounds.layerId === 'backgrounds' || bounds.layerId === 'prefabs';
					isLocked = inst?.locked ?? defaultLocked;
				}
				this.actionMenu.update(bounds, isLocked, onModeChange);
			},
		});

		this.actorsPanel = new ActorsPanel(this.contentEl, {
			app: this.app,
			getResourcePath: (path) => this.app.vault.adapter.getResourcePath(path),
		});

		this.leftMenu = new LeftMenu(this.contentEl, {
			initialCellSize:       this.mapData.settings.cellSize,
			initialPanSpeed:       this.mapData.settings.panSpeed,
			initialGridColor:      this.mapData.settings.gridColor,
			initialShowGrid:       this.mapData.settings.showGrid,
			initialMeasureUnits:     this.mapData.settings.measureUnits,
			initialMeasureUnitLabel: this.mapData.settings.measureUnitLabel,
			initialMeasureDiagonal:  this.mapData.settings.measureDiagonal,
			onReset:   () => this.renderer?.resetCamera(),
			onZoomIn:  () => this.renderer?.zoomIn(),
			onZoomOut: () => this.renderer?.zoomOut(),
			onActorsToggle: () => this.actorsPanel?.toggle(),
			onCellSizeChange: val => {
				this.mapData.settings.cellSize = val;
				this.plugin.settings.cellSize = val;
				void this.plugin.saveSettings();
				this.renderer?.setCellSize(val);
			},
			onPanSpeedChange: val => {
				this.mapData.settings.panSpeed = val;
				this.plugin.settings.panSpeed = val;
				void this.plugin.saveSettings();
				this.renderer?.setPanSpeed(val);
			},
			onGridColorChange: val => {
				this.mapData.settings.gridColor = val;
				this.renderer?.setGridColor(val);
			},
			onShowGridChange: val => {
				this.mapData.settings.showGrid = val;
				this.renderer?.setShowGrid(val);
			},
			onMeasureUnitsChange: val => {
				this.mapData.settings.measureUnits = val;
				this.renderer?.setMeasureConfig(val, this.mapData.settings.measureUnitLabel, this.mapData.settings.measureDiagonal);
			},
			onMeasureUnitLabelChange: val => {
				this.mapData.settings.measureUnitLabel = val;
				this.renderer?.setMeasureConfig(this.mapData.settings.measureUnits, val, this.mapData.settings.measureDiagonal);
			},
			onMeasureDiagonalChange: val => {
				this.mapData.settings.measureDiagonal = val;
				this.renderer?.setMeasureConfig(this.mapData.settings.measureUnits, this.mapData.settings.measureUnitLabel, val);
			},
			onMeasureToolToggle: active => {
				this.renderer?.setMeasureToolActive(active);
			},
		});

		this.browser = new ContentBrowser(
			this.contentEl,
			this.plugin.manifest.dir ?? '',
			this.app.vault.adapter,
			this.customFolders(),
		);

		this.hierarchy = new SceneHierarchy(this.contentEl, {
			app: this.app,
			onSelectionChange: (selectedIds) => {
				this.currentSelection = new Set(selectedIds);
				this.renderer?.setSelectedIds(selectedIds);
			},
			onToggleLocked: (layerId, instanceId) => {
				this.toggleLocked(layerId, instanceId);
			},
			onToggleVisibility: (layerId, instanceId) => {
				const layer = this.mapData.layers[layerId];
				const inst = layer.find(i => i.id === instanceId);
				if (!inst) return;
				inst.hidden = inst.hidden ? undefined : true;
				this.renderer?.setLayers(this.mapData.layers);
				this.hierarchy?.setLayers(this.mapData.layers);
			},
			onDelete: (layerId, instanceId) => {
				const layer = this.mapData.layers[layerId];
				const idx = layer.findIndex(i => i.id === instanceId);
				if (idx === -1) return;
				layer.splice(idx, 1);
				this.renderer?.setLayers(this.mapData.layers);
				this.hierarchy?.setLayers(this.mapData.layers);
			},
			onRename: (layerId, instanceId, newLabel) => {
				const inst = this.mapData.layers[layerId].find(i => i.id === instanceId);
				if (!inst) return;
				if (newLabel !== undefined) {
					inst.label = newLabel;
				} else {
					delete inst.label;
				}
				this.hierarchy?.setLayers(this.mapData.layers);
			},
		});

		this.actionMenu = new AssetActionMenu(this.contentEl, {
			onLockToggle: () => {
				for (const id of this.currentSelection) {
					for (const lid of ['backgrounds', 'tiles', 'prefabs', 'objects', 'tokens', 'actors'] as const) {
						if (this.mapData.layers[lid].some(i => i.id === id)) {
							this.toggleLocked(lid, id);
							break;
						}
					}
				}
			},
			onModeChange: (mode) => {
				this.renderer?.setActiveMode(mode);
			},
			onDelete: () => {
				const ids = [...this.currentSelection];
				if (ids.length === 0) return;
				const label = ids.length > 1 ? `${ids.length} assets` : 'this asset';
				new DeleteConfirmModal(this.app, label, () => {
					for (const id of ids) {
						for (const lid of ['backgrounds', 'tiles', 'prefabs', 'objects', 'tokens', 'actors'] as const) {
							const idx = this.mapData.layers[lid].findIndex(i => i.id === id);
							if (idx !== -1) { this.mapData.layers[lid].splice(idx, 1); break; }
						}
					}
					this.renderer?.setLayers(this.mapData.layers);
					this.hierarchy?.setLayers(this.mapData.layers);
				}).open();
			},
		});

		this.diceTray = new DiceTray(this.contentEl);

		this.autosaveId = window.setInterval(() => { void this.saveToFile(); }, 1000);
	}

	async onClose(): Promise<void> {
		if (this.autosaveId !== null) {
			window.clearInterval(this.autosaveId);
			this.autosaveId = null;
		}
		this.renderer?.destroy();
		this.renderer = null;
		this.leftMenu?.destroy();
		this.leftMenu = null;
		this.browser?.destroy();
		this.browser = null;
		this.hierarchy?.destroy();
		this.hierarchy = null;
		this.actionMenu?.destroy();
		this.actionMenu = null;
		this.diceTray?.destroy();
		this.diceTray = null;
		this.actorsPanel?.destroy();
		this.actorsPanel = null;
	}

	async onLoadFile(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		this.mapData = parseMapData(content, {
			measureUnits:     this.plugin.settings.defaultMeasureUnits,
			measureUnitLabel: this.plugin.settings.defaultMeasureUnitLabel,
			measureDiagonal:  this.plugin.settings.defaultMeasureDiagonal,
		});
		this.lastSaved = JSON.stringify(this.mapData);
		this.applyMapData();
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		await this.saveToFile();
	}

	/** Called by the plugin when folder settings change so the browser reflects the new paths. */
	applySettings() {
		this.browser?.updateCustomFolders(this.customFolders());
	}

	private applyMapData() {
		const { cellSize, panSpeed, gridColor, showGrid, measureUnits, measureUnitLabel, measureDiagonal } = this.mapData.settings;
		this.renderer?.setCellSize(cellSize);
		this.renderer?.setPanSpeed(panSpeed);
		this.renderer?.setGridColor(gridColor);
		this.renderer?.setShowGrid(showGrid);
		this.renderer?.setCameraState(this.mapData.camera);
		this.renderer?.setLayers(this.mapData.layers);
		this.renderer?.setMeasureToolActive(false);
		this.renderer?.setMeasureConfig(measureUnits, measureUnitLabel, measureDiagonal);
		this.hierarchy?.setLayers(this.mapData.layers);
		this.leftMenu?.applySettings(cellSize, panSpeed, gridColor, showGrid, measureUnits, measureUnitLabel, measureDiagonal);
	}

	private async handleAssetDrop(data: AssetDropData) {
		const img = new Image();
		await new Promise<void>((resolve) => {
			// Register handlers BEFORE setting src so cached images don't fire
			// the load event before the handler is attached.
			img.onload  = () => resolve();
			img.onerror = () => resolve();
			img.src = data.resourceUrl;
			// If the browser already has the image decoded (e.g. from the thumbnail),
			// complete is true immediately and onload will never fire.
			if (img.complete) resolve();
		});

		if (!this.renderer) return; // view closed while image was loading

		const cellSize = this.mapData.settings.cellSize;
		const instance: MapInstance = {
			id: crypto.randomUUID(),
			assetPath: data.assetPath,
			x: data.worldX,
			y: data.worldY,
			width:  img.naturalWidth  || cellSize,
			height: img.naturalHeight || cellSize,
			rotation: 0,
			...(data.category === 'backgrounds' || data.category === 'prefabs' ? { locked: true } : {}),
			...(data.actorNotePath ? { actorNotePath: data.actorNotePath } : {}),
			...(data.actorType     ? { actorType:     data.actorType }     : {}),
			...(data.actorName     ? { label:         data.actorName }     : {}),
		};

		const layer = data.category as keyof typeof this.mapData.layers;
		if (layer in this.mapData.layers) {
			this.mapData.layers[layer].push(instance);
			this.renderer.setLayers(this.mapData.layers);
			this.hierarchy?.setLayers(this.mapData.layers);
		}
	}

	private async saveToFile() {
		if (!this.file) return;
		if (this.renderer) {
			this.mapData.camera = this.renderer.getCameraState();
		}
		const content = JSON.stringify(this.mapData, null, 2);
		if (content === this.lastSaved) return;
		this.lastSaved = content;
		await this.app.vault.modify(this.file, content);
	}

	private toggleLocked(layerId: keyof MapData['layers'], instanceId: string) {
		const inst = this.mapData.layers[layerId].find(i => i.id === instanceId);
		if (!inst) return;
		const defaultLocked = layerId === 'backgrounds' || layerId === 'prefabs';
		const effectiveLocked = inst.locked ?? defaultLocked;
		const newValue = !effectiveLocked;
		if (newValue === defaultLocked) {
			delete inst.locked;
		} else {
			inst.locked = newValue;
		}
		this.renderer?.setLayers(this.mapData.layers);
		this.hierarchy?.setLayers(this.mapData.layers);
	}

	private customFolders(): CustomAssetFolders {
		const s = this.plugin.settings;
		return {
			backgrounds: s.backgroundsFolder,
			tiles:       s.tilesFolder,
			prefabs:     s.prefabsFolder,
			objects:     s.objectsFolder,
			tokens:      s.tokensFolder,
		};
	}
}

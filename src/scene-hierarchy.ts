import { App, Modal, setIcon } from 'obsidian';
import type { MapLayers } from './map-renderer';

export type LayerId = 'backgrounds' | 'tiles' | 'prefabs' | 'objects' | 'tokens' | 'actors';

interface LayerConfig {
	id: LayerId;
	label: string;
	icon: string;
}

const LAYER_CONFIGS: LayerConfig[] = [
	{ id: 'backgrounds', label: 'Backgrounds', icon: 'image' },
	{ id: 'tiles',       label: 'Tiles',       icon: 'mirror-rectangular' },
	{ id: 'prefabs',     label: 'Prefabs',     icon: 'layout-template' },
	{ id: 'objects',     label: 'Objects',     icon: 'box' },
	{ id: 'tokens',      label: 'Tokens',      icon: 'user' },
	{ id: 'actors',      label: 'Actors',      icon: 'users' },
];

interface SectionEls {
	chevron: HTMLElement;
	countEl: HTMLElement;
	list: HTMLElement;
}

interface TargetItem {
	id: string;
	layerId: LayerId;
}

export interface SceneHierarchyOptions {
	app: App;
	onToggleVisibility: (layerId: LayerId, instanceId: string) => void;
	onToggleLocked: (layerId: LayerId, instanceId: string) => void;
	onDelete: (layerId: LayerId, instanceId: string) => void;
	onRename: (layerId: LayerId, instanceId: string, newLabel: string | undefined) => void;
	onSelectionChange?: (selectedIds: Set<string>) => void;
}

function baseName(assetPath: string): string {
	const file = assetPath.slice(assetPath.lastIndexOf('/') + 1);
	const dot = file.lastIndexOf('.');
	return dot > 0 ? file.slice(0, dot) : file;
}

export class SceneHierarchy {
	private readonly el: HTMLElement;
	private readonly sections = new Map<LayerId, SectionEls>();
	private readonly collapsed = new Set<LayerId>();
	private readonly options: SceneHierarchyOptions;

	private readonly selected = new Set<string>();
	private anchor: { layerId: LayerId; instanceId: string } | null = null;
	private readonly itemEls = new Map<string, HTMLElement>();
	private currentLayers: MapLayers | null = null;

	constructor(container: HTMLElement, options: SceneHierarchyOptions) {
		this.options = options;

		this.el = container.createEl('div', { cls: 'vtt-hierarchy' });
		this.el.createEl('div', { cls: 'vtt-hierarchy-header', text: 'Scene' });

		const body = this.el.createEl('div', { cls: 'vtt-hierarchy-body' });

		for (const config of LAYER_CONFIGS) {
			const section = body.createEl('div', { cls: 'vtt-hierarchy-section' });

			const header = section.createEl('div', { cls: 'vtt-hierarchy-section-header' });
			header.addEventListener('mousedown', e => e.preventDefault());

			const chevron = header.createEl('span', { cls: 'vtt-hierarchy-chevron' });
			setIcon(chevron, 'chevron-down');

			const iconEl = header.createEl('span', { cls: 'vtt-hierarchy-layer-icon' });
			setIcon(iconEl, config.icon);

			header.createEl('span', { cls: 'vtt-hierarchy-layer-label', text: config.label });
			const countEl = header.createEl('span', { cls: 'vtt-hierarchy-layer-count', text: '0' });

			const list = section.createEl('div', { cls: 'vtt-hierarchy-list' });

			header.addEventListener('click', () => {
				if (this.collapsed.has(config.id)) {
					this.collapsed.delete(config.id);
					list.style.display = '';
					chevron.removeClass('is-collapsed');
				} else {
					this.collapsed.add(config.id);
					list.style.display = 'none';
					chevron.addClass('is-collapsed');
				}
			});

			this.sections.set(config.id, { chevron, countEl, list });
		}
	}

	destroy() {
		this.el.remove();
	}

	setLayers(layers: MapLayers) {
		this.currentLayers = layers;
		this.itemEls.clear();

		// Prune selection to IDs that still exist
		const allIds = new Set<string>();
		for (const config of LAYER_CONFIGS) {
			for (const inst of layers[config.id]) allIds.add(inst.id);
		}
		for (const id of [...this.selected]) {
			if (!allIds.has(id)) this.selected.delete(id);
		}

		for (const config of LAYER_CONFIGS) {
			const els = this.sections.get(config.id);
			if (!els) continue;

			const instances = layers[config.id];
			els.countEl.textContent = String(instances.length);

			els.list.empty();
			const defaultLocked = config.id === 'backgrounds' || config.id === 'prefabs';
			for (const inst of instances) {
				const isHidden = inst.hidden === true;
				const isLocked = inst.locked ?? defaultLocked;
				const isSelected = this.selected.has(inst.id);
				const displayName = inst.label ?? baseName(inst.assetPath);

				const item = els.list.createEl('div', {
					cls: 'vtt-hierarchy-item',
					attr: { tabindex: '-1' },
				});
				if (isHidden) item.addClass('is-hidden');
				if (isSelected) item.addClass('is-selected');
				this.itemEls.set(inst.id, item);

				item.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('.vtt-hierarchy-item-actions')) return;
					this.handleItemClick(e, config.id, inst.id);
				});

				item.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && this.selected.size === 1 && this.selected.has(inst.id)) {
						e.preventDefault();
						this.startRename(inst.id);
					}
				});

				const iconEl = item.createEl('span', { cls: 'vtt-hierarchy-item-icon' });
				setIcon(iconEl, config.icon);

				item.createEl('span', {
					cls: 'vtt-hierarchy-item-name',
					text: displayName,
					attr: { title: inst.assetPath },
				});

				const actions = item.createEl('div', { cls: 'vtt-hierarchy-item-actions' });

				const visBtn = actions.createEl('button', {
					cls: 'vtt-hierarchy-item-btn',
					attr: { title: isHidden ? 'Show' : 'Hide', 'aria-label': isHidden ? 'Show' : 'Hide' },
				});
				setIcon(visBtn, isHidden ? 'eye-off' : 'eye');
				visBtn.addEventListener('mousedown', e => e.preventDefault());
				visBtn.addEventListener('click', () => {
					for (const t of this.targetsFor(inst.id, config.id)) {
						this.options.onToggleVisibility(t.layerId, t.id);
					}
				});

				const lockBtn = actions.createEl('button', {
					cls: 'vtt-hierarchy-item-btn',
					attr: { title: isLocked ? 'Unlock' : 'Lock', 'aria-label': isLocked ? 'Unlock' : 'Lock' },
				});
				setIcon(lockBtn, isLocked ? 'lock' : 'unlock');
				lockBtn.addEventListener('mousedown', e => e.preventDefault());
				lockBtn.addEventListener('click', () => {
					for (const t of this.targetsFor(inst.id, config.id)) {
						this.options.onToggleLocked(t.layerId, t.id);
					}
				});

				const delBtn = actions.createEl('button', {
					cls: 'vtt-hierarchy-item-btn vtt-hierarchy-item-btn--danger',
					attr: { title: 'Delete', 'aria-label': 'Delete' },
				});
				setIcon(delBtn, 'trash-2');
				delBtn.addEventListener('mousedown', e => e.preventDefault());
				delBtn.addEventListener('click', () => {
					const targets = this.targetsFor(inst.id, config.id);
					const label = targets.length > 1
						? `${targets.length} assets`
						: `"${displayName}"`;
					new DeleteConfirmModal(
						this.options.app,
						label,
						() => {
							for (const t of targets) this.options.onDelete(t.layerId, t.id);
							this.selected.clear();
						},
					).open();
				});
			}
		}
	}

	private startRename(instanceId: string) {
		const layerId = this.layerOfId(instanceId);
		if (!layerId) return;

		const item = this.itemEls.get(instanceId);
		if (!item) return;

		const nameSpan = item.querySelector<HTMLElement>('.vtt-hierarchy-item-name');
		if (!nameSpan) return;

		const currentName = nameSpan.textContent ?? '';
		nameSpan.style.display = 'none';

		const input = document.createElement('input');
		input.className = 'vtt-hierarchy-rename-input';
		input.type = 'text';
		input.value = currentName;
		input.spellcheck = false;

		const actionsEl = item.querySelector('.vtt-hierarchy-item-actions');
		item.insertBefore(input, actionsEl ?? null);

		input.focus();
		input.select();

		let committed = false;

		const commit = () => {
			if (committed) return;
			committed = true;
			const newName = input.value.trim();
			input.remove();
			nameSpan.style.display = '';
			// Empty string means "reset to filename"
			this.options.onRename(layerId, instanceId, newName || undefined);
		};

		const cancel = () => {
			if (committed) return;
			committed = true;
			input.remove();
			nameSpan.style.display = '';
			item.focus();
		};

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
			else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
		});

		input.addEventListener('blur', commit);
	}

	private handleItemClick(e: MouseEvent, layerId: LayerId, instanceId: string) {
		if (e.shiftKey && this.anchor) {
			if (this.anchor.layerId === layerId && this.currentLayers) {
				// Range select within the same layer
				const instances = this.currentLayers[layerId];
				const anchorIdx = instances.findIndex(i => i.id === this.anchor!.instanceId);
				const currentIdx = instances.findIndex(i => i.id === instanceId);
				if (anchorIdx !== -1 && currentIdx !== -1) {
					if (!e.ctrlKey && !e.metaKey) this.selected.clear();
					const [start, end] = [Math.min(anchorIdx, currentIdx), Math.max(anchorIdx, currentIdx)];
					for (let i = start; i <= end; i++) this.selected.add(instances[i]!.id);
				}
			} else {
				// Cross-layer shift-click: just add the clicked item
				if (!e.ctrlKey && !e.metaKey) this.selected.clear();
				this.selected.add(instanceId);
				this.anchor = { layerId, instanceId };
			}
		} else if (e.ctrlKey || e.metaKey) {
			if (this.selected.has(instanceId)) {
				this.selected.delete(instanceId);
			} else {
				this.selected.add(instanceId);
			}
			this.anchor = { layerId, instanceId };
		} else {
			this.selected.clear();
			this.selected.add(instanceId);
			this.anchor = { layerId, instanceId };
		}
		this.refreshSelection();
	}

	/** Called from renderer/external — updates DOM without firing the callback. */
	setSelection(ids: Set<string>) {
		this.selected.clear();
		for (const id of ids) this.selected.add(id);
		this.anchor = null;
		this.refreshSelectionDOM();
	}

	private refreshSelection() {
		this.refreshSelectionDOM();
		// Focus the item when exactly one is selected so Enter can trigger rename.
		// Only done on internal (click-driven) selection changes — not when the
		// canvas calls setSelection(), so the canvas keeps keyboard focus for
		// Ctrl+C / Ctrl+V and pan shortcuts.
		if (this.selected.size === 1) {
			const [id] = this.selected;
			this.itemEls.get(id!)?.focus();
		}
		this.options.onSelectionChange?.(new Set(this.selected));
	}

	private refreshSelectionDOM() {
		for (const [id, el] of this.itemEls) {
			el.toggleClass('is-selected', this.selected.has(id));
		}
	}

	/** Returns the targets an action should apply to. If the clicked item is
	 *  part of the current selection, returns all selected items; otherwise
	 *  returns only the clicked item. Layer assignments are resolved once,
	 *  before any mutations happen. */
	private targetsFor(instanceId: string, fallbackLayerId: LayerId): TargetItem[] {
		if (!this.selected.has(instanceId)) {
			return [{ id: instanceId, layerId: fallbackLayerId }];
		}
		return [...this.selected]
			.map(id => ({ id, layerId: this.layerOfId(id) }))
			.filter((t): t is TargetItem => t.layerId !== null);
	}

	private layerOfId(instanceId: string): LayerId | null {
		if (!this.currentLayers) return null;
		for (const config of LAYER_CONFIGS) {
			if (this.currentLayers[config.id].some(i => i.id === instanceId)) return config.id;
		}
		return null;
	}
}

export class DeleteConfirmModal extends Modal {
	constructor(app: App, label: string, onConfirm: () => void) {
		super(app);
		this.modalEl.addClass('vtt-confirm-modal');
		this.titleEl.setText('Remove from scene');
		this.contentEl.createEl('p', { text: `Remove ${label} from the scene?` });

		const btnRow = this.contentEl.createEl('div', { cls: 'vtt-modal-btn-row' });

		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = btnRow.createEl('button', { text: 'Remove', cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => { this.close(); onConfirm(); });
	}
}

import { DataAdapter, setIcon } from 'obsidian';

type ContentCategory = 'backgrounds' | 'tiles' | 'prefabs' | 'objects' | 'tokens';

export interface CustomAssetFolders {
	backgrounds: string;
	tiles: string;
	prefabs: string;
	objects: string;
	tokens: string;
}

interface CategoryConfig {
	id: ContentCategory;
	label: string;
	icon: string;
}

const CATEGORIES: CategoryConfig[] = [
	{ id: 'backgrounds', label: 'Backgrounds', icon: 'image' },
	{ id: 'tiles',       label: 'Tiles',       icon: 'mirror-rectangular' },
	{ id: 'prefabs',     label: 'Prefabs',     icon: 'layout-template' },
	{ id: 'objects',     label: 'Objects',     icon: 'box' },
	{ id: 'tokens',      label: 'Tokens',      icon: 'user' },
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

// Each item is padding(6+6) + thumb(48) = 60px box, plus margin(2+2) = 64px total in a flex column.
const ITEM_HEIGHT = 64;
const RENDER_BUFFER = 5;

interface AssetFile {
	name: string;
	path: string;
	source: 'builtin' | 'custom';
	folder: string; // relative folder path within category, '' for root
}

interface FolderNode {
	name: string;
	files: AssetFile[];
	subfolders: FolderNode[];
}

interface PanelState {
	el: HTMLElement;
	folderSelect: HTMLSelectElement | null;
	scrollEl: HTMLElement;
	containerEl: HTMLElement; // position:relative, height = total * ITEM_HEIGHT
	itemsEl: HTMLElement;     // position:absolute, top = startIdx * ITEM_HEIGHT
	category: ContentCategory;
	allFiles: AssetFile[];
	filteredFiles: AssetFile[];
	activeFolder: string;
	folders: string[]; // top-level folder names only
	appliedFilter: string; // filterText value last applied to filteredFiles
}

function flattenTree(node: FolderNode): AssetFile[] {
	const files: AssetFile[] = [...node.files];
	for (const sub of node.subfolders) files.push(...flattenTree(sub));
	return files;
}

function sortFolderNode(node: FolderNode): void {
	node.files.sort((a, b) => a.name.localeCompare(b.name));
	node.subfolders.sort((a, b) => a.name.localeCompare(b.name));
	for (const sub of node.subfolders) sortFolderNode(sub);
}

export class ContentBrowser {
	private readonly el: HTMLElement;
	private readonly tabEls = new Map<ContentCategory, HTMLElement>();
	private readonly searchEl: HTMLInputElement;
	private readonly contentEl: HTMLElement;
	private readonly pluginDir: string;
	private readonly adapter: DataAdapter;
	private customFolders: CustomAssetFolders;
	private activeCategory: ContentCategory = 'backgrounds';
	private filterText = '';

	private readonly fileCache = new Map<string, Promise<FolderNode>>();
	private readonly panelCache = new Map<ContentCategory, PanelState>();

	constructor(
		container: HTMLElement,
		pluginDir: string,
		adapter: DataAdapter,
		customFolders: CustomAssetFolders,
	) {
		this.pluginDir = pluginDir;
		this.adapter = adapter;
		this.customFolders = customFolders;

		this.el = container.createEl('div', { cls: 'vtt-content-browser' });

		this.el.createEl('div', { cls: 'vtt-hierarchy-header', text: 'Assets' });

		const tabs = this.el.createEl('div', { cls: 'vtt-browser-tabs' });

		const searchWrap = this.el.createEl('div', { cls: 'vtt-browser-search' });
		this.searchEl = searchWrap.createEl('input', {
			cls: 'vtt-browser-search-input',
			attr: { type: 'text', placeholder: 'Filter…', spellcheck: 'false' },
		}) as HTMLInputElement;
		this.searchEl.addEventListener('input', () => {
			this.filterText = this.searchEl.value.trim().toLowerCase();
			const panel = this.panelCache.get(this.activeCategory);
			if (panel) this.applyFilters(panel);
		});

		const clearBtn = searchWrap.createEl('button', {
			cls: 'vtt-browser-search-clear',
			attr: { title: 'Clear filter', 'aria-label': 'Clear filter' },
			text: '×',
		});
		clearBtn.addEventListener('mousedown', e => e.preventDefault());
		clearBtn.addEventListener('click', () => {
			this.searchEl.value = '';
			this.filterText = '';
			const panel = this.panelCache.get(this.activeCategory);
			if (panel) this.applyFilters(panel);
		});

		this.contentEl = this.el.createEl('div', { cls: 'vtt-browser-content' });

		for (const cat of CATEGORIES) {
			const tab = tabs.createEl('button', {
				cls: 'vtt-browser-tab',
				attr: { 'aria-label': cat.label, title: cat.label },
			});
			setIcon(tab, cat.icon);
			tab.addEventListener('mousedown', e => e.preventDefault());
			tab.addEventListener('click', () => this.selectCategory(cat.id));
			this.tabEls.set(cat.id, tab);
		}

		this.selectCategory('backgrounds');
	}

	destroy() {
		this.el.remove();
	}

	updateCustomFolders(folders: CustomAssetFolders) {
		this.customFolders = folders;
		this.fileCache.clear();
		for (const [, panel] of this.panelCache) {
			panel.el.remove();
		}
		this.panelCache.clear();
		void this.showPanel(this.activeCategory);
	}

	private selectCategory(id: ContentCategory) {
		this.activeCategory = id;
		for (const [catId, tabEl] of this.tabEls) {
			tabEl.toggleClass('is-active', catId === id);
		}
		void this.showPanel(id);
	}

	private async showPanel(id: ContentCategory) {
		if (!this.panelCache.has(id)) {
			const node = await this.getCachedFiles(id);
			if (this.activeCategory !== id) return; // tab switched during async walk
			if (!this.panelCache.has(id)) { // re-check: a concurrent call may have finished first
				const allFiles = flattenTree(node);
				this.createPanel(id, allFiles);
			}
		}

		if (this.activeCategory !== id) return;

		for (const [, state] of this.panelCache) {
			state.el.style.display = 'none';
		}

		const panel = this.panelCache.get(id)!;
		panel.el.style.display = '';

		// Re-apply text filter if it changed while this panel was hidden
		if (panel.appliedFilter !== this.filterText) {
			this.applyFilters(panel);
		}
	}

	private createPanel(category: ContentCategory, allFiles: AssetFile[]) {
		const el = this.contentEl.createEl('div', { cls: 'vtt-browser-panel' });
		el.style.display = 'none';

		const topFolderSet = new Set<string>();
		for (const f of allFiles) {
			if (f.folder) topFolderSet.add(f.folder.split('/')[0] ?? f.folder);
		}
		const folders = [...topFolderSet].sort();

		let folderSelect: HTMLSelectElement | null = null;
		if (folders.length > 0) {
			const filterBar = el.createEl('div', { cls: 'vtt-browser-filter-bar' });
			folderSelect = filterBar.createEl('select', {
				cls: 'vtt-browser-folder-select',
			}) as HTMLSelectElement;
			folderSelect.createEl('option', { text: 'All folders', attr: { value: '' } });
			for (const folder of folders) {
				folderSelect.createEl('option', { text: folder, attr: { value: folder } });
			}
		}

		const scrollEl = el.createEl('div', { cls: 'vtt-browser-panel-scroll' });
		const containerEl = scrollEl.createEl('div', { cls: 'vtt-virtual-container' });
		const itemsEl = containerEl.createEl('div', { cls: 'vtt-browser-items' });

		const state: PanelState = {
			el, folderSelect, scrollEl, containerEl, itemsEl,
			category, allFiles,
			filteredFiles: [...allFiles],
			activeFolder: '',
			folders,
			appliedFilter: '',
		};

		if (folderSelect) {
			folderSelect.addEventListener('change', () => {
				state.activeFolder = folderSelect!.value;
				this.applyFilters(state);
			});
		}

		containerEl.style.height = `${allFiles.length * ITEM_HEIGHT}px`;

		let rafPending = false;
		scrollEl.addEventListener('scroll', () => {
			if (rafPending) return;
			rafPending = true;
			requestAnimationFrame(() => {
				rafPending = false;
				this.updateVirtualWindow(state);
			});
		});

		this.updateVirtualWindow(state);
		this.panelCache.set(category, state);
	}

	private applyFilters(state: PanelState) {
		const text = this.filterText;
		const folder = state.activeFolder;

		state.filteredFiles = (text === '' && folder === '')
			? [...state.allFiles]
			: state.allFiles.filter(f => {
				// Prefix-match so selecting "gnomes" includes "gnomes/male", "gnomes/female", etc.
				const folderOk = folder === ''
					|| f.folder === folder
					|| f.folder.startsWith(folder + '/');
				const textOk = text === '' || f.name.toLowerCase().includes(text);
				return folderOk && textOk;
			});

		state.appliedFilter = text;
		// Set container height once here — never touched during scroll — so the scrollbar
		// stays stable and doesn't trigger a feedback loop of scroll events.
		state.containerEl.style.height = `${state.filteredFiles.length * ITEM_HEIGHT}px`;
		state.scrollEl.scrollTop = 0;
		this.updateVirtualWindow(state);
	}

	private updateVirtualWindow(state: PanelState) {
		const { scrollEl, containerEl, itemsEl, filteredFiles, category } = state;
		const total = filteredFiles.length;

		if (total === 0) {
			containerEl.style.height = '0px';
			itemsEl.empty();
			const config = CATEGORIES.find(c => c.id === category);
			const empty = itemsEl.createEl('div', { cls: 'vtt-browser-empty' });
			const msg = state.allFiles.length === 0
				? `No ${config?.label.toLowerCase() ?? category} yet`
				: 'No matches';
			empty.createEl('span', { text: msg });
			return;
		}

		const scrollTop = scrollEl.scrollTop;
		const viewHeight = scrollEl.clientHeight || 320;

		const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - RENDER_BUFFER);
		const endIdx = Math.min(total, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + RENDER_BUFFER);

		// Absolutely position the items window — the container height is already fixed,
		// so repositioning itemsEl never changes total scroll height.
		itemsEl.style.top = `${startIdx * ITEM_HEIGHT}px`;
		itemsEl.empty();
		for (let i = startIdx; i < endIdx; i++) {
			const file = filteredFiles[i];
			if (file) this.renderItem(itemsEl, file, category);
		}
	}

	private renderItem(container: HTMLElement, file: AssetFile, category: ContentCategory) {
		const item = container.createEl('div', {
			cls: 'vtt-browser-item',
			attr: {
				title: file.source === 'custom' ? `Custom: ${file.name}` : file.name,
				draggable: 'true',
			},
		});
		if (file.source === 'custom') {
			item.addClass('vtt-browser-item--custom');
		}

		const src = this.adapter.getResourcePath(file.path);
		const thumb = item.createEl('img', {
			cls: 'vtt-browser-item-thumb',
			attr: { draggable: 'false', loading: 'lazy' },
		});
		thumb.src = src;
		thumb.alt = file.name;
		thumb.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showImageModal(src, file.name);
		});

		item.createEl('span', { text: file.name, cls: 'vtt-browser-item-name' });

		item.addEventListener('dragstart', (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('application/vtt-asset', JSON.stringify({
				assetPath: file.path,
				resourceUrl: src,
				category,
			}));
		});
	}

	private showImageModal(src: string, name: string) {
		const overlay = document.body.createEl('div', { cls: 'vtt-image-modal-overlay' });
		const img = overlay.createEl('img', { cls: 'vtt-image-modal-img' });
		img.src = src;
		img.alt = name;

		const close = () => {
			overlay.remove();
			document.removeEventListener('keydown', onKey);
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

		overlay.addEventListener('click', close);
		document.addEventListener('keydown', onKey);
	}

	private getCachedFiles(category: ContentCategory): Promise<FolderNode> {
		const key = `${category}:${this.customFolders[category] ?? ''}`;
		if (!this.fileCache.has(key)) {
			this.fileCache.set(key, this.collectFiles(category));
		}
		return this.fileCache.get(key)!;
	}

	private async collectFiles(category: ContentCategory): Promise<FolderNode> {
		type RawEntry = { name: string; path: string; relParts: string[] };

		const builtinPath = `${this.pluginDir}/assets/${category}`;
		const builtinRaw = await this.walkFolder(builtinPath, []);

		const entries: Array<RawEntry & { source: 'builtin' | 'custom' }> = builtinRaw.map(f => ({ ...f, source: 'builtin' }));

		const customPath = this.customFolders[category];
		if (customPath) {
			const builtinKeys = new Set(builtinRaw.map(f => [...f.relParts, f.name].join('/')));
			const customRaw = await this.walkFolder(customPath, []);
			for (const f of customRaw) {
				if (!builtinKeys.has([...f.relParts, f.name].join('/'))) {
					entries.push({ ...f, source: 'custom' });
				}
			}
		}

		const root: FolderNode = { name: '/', files: [], subfolders: [] };
		const folderMap = new Map<string, FolderNode>([['', root]]);

		for (const entry of entries) {
			let currentKey = '';
			for (const part of entry.relParts) {
				const parentKey = currentKey;
				currentKey = currentKey ? `${currentKey}/${part}` : part;
				if (!folderMap.has(currentKey)) {
					const newNode: FolderNode = { name: part, files: [], subfolders: [] };
					folderMap.set(currentKey, newNode);
					folderMap.get(parentKey)!.subfolders.push(newNode);
				}
			}
			folderMap.get(currentKey)!.files.push({
				name: entry.name,
				path: entry.path,
				source: entry.source,
				folder: entry.relParts.join('/'),
			});
		}

		sortFolderNode(root);
		return root;
	}

	private async walkFolder(
		folderPath: string,
		relParts: string[],
	): Promise<Array<{ name: string; path: string; relParts: string[] }>> {
		try {
			const listed = await this.adapter.list(folderPath);
			const results: Array<{ name: string; path: string; relParts: string[] }> = [];

			for (const f of listed.files) {
				const dot = f.lastIndexOf('.');
				if (dot !== -1 && IMAGE_EXTENSIONS.has(f.slice(dot).toLowerCase())) {
					results.push({ name: f.slice(f.lastIndexOf('/') + 1), path: f, relParts });
				}
			}

			for (const dir of listed.folders) {
				const dirName = dir.slice(dir.lastIndexOf('/') + 1);
				const sub = await this.walkFolder(dir, [...relParts, dirName]);
				results.push(...sub);
			}

			return results;
		} catch {
			return [];
		}
	}
}

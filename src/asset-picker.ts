import { DataAdapter, setIcon } from 'obsidian';

export type ContentCategory = 'backgrounds' | 'tiles' | 'prefabs' | 'objects' | 'tokens';

export interface AssetFile {
	name: string;
	path: string;
	source: 'builtin' | 'custom';
	folder: string;
}

interface FolderNode {
	name: string;
	files: AssetFile[];
	subfolders: FolderNode[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
export const ITEM_HEIGHT = 64;
const RENDER_BUFFER = 5;

export interface AssetPickerOptions {
	adapter: DataAdapter;
	pluginDir: string;
	category: ContentCategory;
	customFolder: string;
	/** 'drag' — items are draggable onto the map. 'select' — items are clickable to pick. */
	mode: 'drag' | 'select';
	onSelect?: (file: AssetFile | null) => void;
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

function showImageModal(src: string, name: string) {
	const overlay = document.body.createEl('div', { cls: 'vtt-image-modal-overlay' });
	const img = overlay.createEl('img', { cls: 'vtt-image-modal-img' });
	img.src = src;
	img.alt = name;
	const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
	const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
	overlay.addEventListener('click', close);
	document.addEventListener('keydown', onKey);
}

export class AssetPicker {
	readonly el: HTMLElement;

	private readonly options: AssetPickerOptions;
	private customFolder: string;

	private folderSelect: HTMLSelectElement | null = null;
	private scrollEl: HTMLElement | null = null;
	private containerEl: HTMLElement | null = null;
	private itemsEl: HTMLElement | null = null;
	private innerBuilt = false;
	private rafPending = false;

	private allFiles: AssetFile[] = [];
	private filteredFiles: AssetFile[] = [];
	private activeFolder = '';
	private filterText = '';
	private selectedPath: string | null = null;

	private loadVersion = 0;
	private destroyed = false;

	constructor(container: HTMLElement, options: AssetPickerOptions) {
		this.options = options;
		this.customFolder = options.customFolder;

		this.el = container.createEl('div', { cls: 'vtt-browser-panel' });
		this.el.style.display = 'none';

		this.startLoad();
	}

	setFilter(text: string) {
		this.filterText = text;
		if (this.innerBuilt) this.applyFilters();
	}

	getSelectedFile(): AssetFile | null {
		if (!this.selectedPath) return null;
		return this.allFiles.find(f => f.path === this.selectedPath) ?? null;
	}

	clearSelection() {
		this.selectedPath = null;
		if (this.innerBuilt) this.updateVirtualWindow();
	}

	updateCustomFolder(folder: string) {
		if (folder === this.customFolder) return;
		this.customFolder = folder;
		this.innerBuilt = false;
		this.allFiles = [];
		this.filteredFiles = [];
		this.activeFolder = '';
		this.folderSelect = null;
		this.scrollEl = null;
		this.containerEl = null;
		this.itemsEl = null;
		this.el.empty();
		this.startLoad();
	}

	destroy() {
		this.destroyed = true;
		this.el.remove();
	}

	private startLoad() {
		const version = ++this.loadVersion;
		void this.collectFiles().then(node => {
			if (this.destroyed || this.loadVersion !== version) return;
			this.allFiles = flattenTree(node);
			this.buildInner();
			this.applyFilters();
		});
	}

	private buildInner() {
		const topFolderSet = new Set<string>();
		for (const f of this.allFiles) {
			if (f.folder) topFolderSet.add(f.folder.split('/')[0] ?? f.folder);
		}
		const folders = [...topFolderSet].sort();

		if (folders.length > 0) {
			const filterBar = this.el.createEl('div', { cls: 'vtt-browser-filter-bar' });
			this.folderSelect = filterBar.createEl('select', { cls: 'vtt-browser-folder-select' }) as HTMLSelectElement;
			this.folderSelect.createEl('option', { text: 'All folders', attr: { value: '' } });
			for (const folder of folders) {
				this.folderSelect.createEl('option', { text: folder, attr: { value: folder } });
			}
			this.folderSelect.addEventListener('change', () => {
				this.activeFolder = this.folderSelect!.value;
				this.applyFilters();
			});
		}

		const scrollEl = this.el.createEl('div', { cls: 'vtt-browser-panel-scroll' });
		this.scrollEl = scrollEl;
		this.containerEl = scrollEl.createEl('div', { cls: 'vtt-virtual-container' });
		this.itemsEl = this.containerEl.createEl('div', { cls: 'vtt-browser-items' });

		scrollEl.addEventListener('scroll', () => {
			if (this.rafPending) return;
			this.rafPending = true;
			requestAnimationFrame(() => {
				this.rafPending = false;
				this.updateVirtualWindow();
			});
		});

		this.innerBuilt = true;
	}

	private applyFilters() {
		const text = this.filterText;
		const folder = this.activeFolder;

		this.filteredFiles = (text === '' && folder === '')
			? [...this.allFiles]
			: this.allFiles.filter(f => {
				const folderOk = folder === '' || f.folder === folder || f.folder.startsWith(folder + '/');
				const textOk = text === '' || f.name.toLowerCase().includes(text);
				return folderOk && textOk;
			});

		if (this.containerEl) {
			this.containerEl.style.height = `${this.filteredFiles.length * ITEM_HEIGHT}px`;
		}
		if (this.scrollEl) this.scrollEl.scrollTop = 0;
		this.updateVirtualWindow();
	}

	private updateVirtualWindow() {
		if (!this.containerEl || !this.scrollEl || !this.itemsEl) return;

		const total = this.filteredFiles.length;

		if (total === 0) {
			this.containerEl.style.height = '0px';
			this.itemsEl.empty();
			const empty = this.itemsEl.createEl('div', { cls: 'vtt-browser-empty' });
			empty.createEl('span', { text: this.allFiles.length === 0 ? 'No assets found' : 'No matches' });
			return;
		}

		const scrollTop = this.scrollEl.scrollTop;
		const viewHeight = this.scrollEl.clientHeight || 320;
		const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - RENDER_BUFFER);
		const endIdx = Math.min(total, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + RENDER_BUFFER);

		this.itemsEl.style.top = `${startIdx * ITEM_HEIGHT}px`;
		this.itemsEl.empty();
		for (let i = startIdx; i < endIdx; i++) {
			const file = this.filteredFiles[i];
			if (file) this.renderItem(this.itemsEl, file);
		}
	}

	private renderItem(container: HTMLElement, file: AssetFile) {
		const { mode, adapter, category } = this.options;
		const src = adapter.getResourcePath(file.path);
		const isSelected = this.selectedPath === file.path;

		const item = container.createEl('div', {
			cls: [
				'vtt-browser-item',
				file.source === 'custom' ? 'vtt-browser-item--custom' : '',
				isSelected ? 'is-selected' : '',
			].filter(Boolean).join(' '),
			attr: {
				title: file.source === 'custom' ? `Custom: ${file.name}` : file.name,
				...(mode === 'drag' ? { draggable: 'true' } : {}),
			},
		});

		const thumb = item.createEl('img', {
			cls: 'vtt-browser-item-thumb',
			attr: { draggable: 'false', loading: 'lazy' },
		});
		thumb.src = src;
		thumb.alt = file.name;

		item.createEl('span', { text: file.name, cls: 'vtt-browser-item-name' });

		if (mode === 'drag') {
			thumb.addEventListener('contextmenu', e => {
				e.preventDefault();
				showImageModal(src, file.name);
			});
			item.addEventListener('dragstart', e => {
				if (!e.dataTransfer) return;
				e.dataTransfer.effectAllowed = 'copy';
				e.dataTransfer.setData('application/vtt-asset', JSON.stringify({
					assetPath: file.path,
					resourceUrl: src,
					category,
				}));
			});
		} else {
			item.addEventListener('click', () => {
				if (this.selectedPath === file.path) {
					this.selectedPath = null;
					this.options.onSelect?.(null);
				} else {
					this.selectedPath = file.path;
					this.options.onSelect?.(file);
				}
				this.updateVirtualWindow();
			});
		}
	}

	private async collectFiles(): Promise<FolderNode> {
		type RawEntry = { name: string; path: string; relParts: string[] };

		const { pluginDir, adapter, category } = this.options;
		const builtinRaw = await this.walkFolder(`${pluginDir}/assets/${category}`, []);
		const entries: Array<RawEntry & { source: 'builtin' | 'custom' }> =
			builtinRaw.map(f => ({ ...f, source: 'builtin' }));

		if (this.customFolder) {
			const builtinKeys = new Set(builtinRaw.map(f => [...f.relParts, f.name].join('/')));
			for (const f of await this.walkFolder(this.customFolder, [])) {
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
			const listed = await this.options.adapter.list(folderPath);
			const results: Array<{ name: string; path: string; relParts: string[] }> = [];

			for (const f of listed.files) {
				const dot = f.lastIndexOf('.');
				if (dot !== -1 && IMAGE_EXTENSIONS.has(f.slice(dot).toLowerCase())) {
					results.push({ name: f.slice(f.lastIndexOf('/') + 1), path: f, relParts });
				}
			}
			for (const dir of listed.folders) {
				const dirName = dir.slice(dir.lastIndexOf('/') + 1);
				results.push(...await this.walkFolder(dir, [...relParts, dirName]));
			}
			return results;
		} catch {
			return [];
		}
	}
}

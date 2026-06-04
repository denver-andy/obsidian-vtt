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

interface AssetFile {
	name: string;
	path: string;
	source: 'builtin' | 'custom';
}

interface FolderNode {
	name: string;
	files: AssetFile[];
	subfolders: FolderNode[];
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
	private readonly collapsedFolders = new Set<string>();

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
			this.contentEl.empty();
			void this.renderContent(this.activeCategory);
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
			this.contentEl.empty();
			void this.renderContent(this.activeCategory);
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

	/** Call after plugin settings change to re-render the visible category. */
	updateCustomFolders(folders: CustomAssetFolders) {
		this.customFolders = folders;
		this.contentEl.empty();
		void this.renderContent(this.activeCategory);
	}

	private selectCategory(id: ContentCategory) {
		this.activeCategory = id;

		for (const [catId, tabEl] of this.tabEls) {
			tabEl.toggleClass('is-active', catId === id);
		}

		this.contentEl.empty();
		void this.renderContent(id);
	}

	private async renderContent(category: ContentCategory) {
		const tree = await this.collectFiles(category);
		const allFiles = flattenTree(tree);

		this.contentEl.empty();

		if (this.filterText) {
			const filtered = allFiles.filter(f => f.name.toLowerCase().includes(this.filterText));

			if (filtered.length === 0) {
				const config = CATEGORIES.find(c => c.id === category);
				const label = config?.label ?? category;
				const empty = this.contentEl.createEl('div', { cls: 'vtt-browser-empty' });
				const msg = allFiles.length > 0
					? `No matches for "${this.searchEl.value.trim()}"`
					: `No ${label.toLowerCase()} yet`;
				empty.createEl('span', { text: msg });
				return;
			}

			for (const file of filtered) {
				this.renderItem(this.contentEl, file, category);
			}
			return;
		}

		if (allFiles.length === 0) {
			const config = CATEGORIES.find(c => c.id === category);
			const label = config?.label ?? category;
			const empty = this.contentEl.createEl('div', { cls: 'vtt-browser-empty' });
			empty.createEl('span', { text: `No ${label.toLowerCase()} yet` });
			return;
		}

		if (tree.files.length > 0) {
			this.renderFolder(this.contentEl, { name: '/', files: tree.files, subfolders: [] }, category, [], 0);
		}
		for (const sub of tree.subfolders) {
			this.renderFolder(this.contentEl, sub, category, [sub.name], 0);
		}
	}

	private renderFolder(
		container: HTMLElement,
		node: FolderNode,
		category: ContentCategory,
		relParts: string[],
		depth: number,
	) {
		const key = `${category}:${relParts.join('/')}`;
		let collapsed = this.collapsedFolders.has(key);

		const folderEl = container.createEl('div', { cls: 'vtt-browser-folder' });

		const header = folderEl.createEl('button', {
			cls: 'vtt-browser-folder-header',
			attr: { style: `padding-left: ${8 + depth * 10}px` },
		});

		const chevron = header.createEl('span', { cls: 'vtt-browser-folder-chevron' });
		setIcon(chevron, 'chevron-down');
		if (collapsed) chevron.addClass('is-collapsed');

		header.createEl('span', {
			cls: 'vtt-browser-folder-name',
			text: node.name,
		});

		const content = folderEl.createEl('div', { cls: 'vtt-browser-folder-content' });
		if (collapsed) content.addClass('is-hidden');

		header.addEventListener('mousedown', e => e.preventDefault());
		header.addEventListener('click', () => {
			collapsed = !collapsed;
			if (collapsed) {
				this.collapsedFolders.add(key);
			} else {
				this.collapsedFolders.delete(key);
			}
			chevron.toggleClass('is-collapsed', collapsed);
			content.toggleClass('is-hidden', collapsed);
		});

		for (const sub of node.subfolders) {
			this.renderFolder(content, sub, category, [...relParts, sub.name], depth + 1);
		}

		for (const file of node.files) {
			this.renderItem(content, file, category);
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
			attr: { draggable: 'false' },
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
			folderMap.get(currentKey)!.files.push({ name: entry.name, path: entry.path, source: entry.source });
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
